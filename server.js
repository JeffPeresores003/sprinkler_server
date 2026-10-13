require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN || 'change-me-123';

app.use(cors());
app.use(express.json());

// --- State Cache ---
let deviceStatus = null;
let lastSeen = null;
let deviceConfig = {
  lowPct: 35,
  highPct: 60,
  maxCycles: 4,
  pulseSec: 60,
  soakSec: 300,
  maxRunSec: 900,
  cooldownMin: 30,
  w1s: 360,
  w1e: 540,
  w2s: 1020,
  w2e: 1110,
  maxLiters: 40.0,
  minFlow: 0.3,
  autoMode: true,
  rainSkip: false,
};
let commandQueue = [];
let historyBuffer = [];

// --- Auth Middleware ---
function auth(req, res, next) {
  const token = req.headers['x-token'];
  if (!token || token !== API_TOKEN) {
    return res.status(401).json({ err: 'unauthorized' });
  }
  next();
}

// --- Health / Root ---
app.get('/', (req, res) => {
  const isOnline = lastSeen && (Date.now() - lastSeen < 15000);
  res.json({
    service: 'AutoSprinkler Cloud Relay Server',
    status: 'running',
    deviceOnline: Boolean(isOnline),
    lastSeen: lastSeen ? new Date(lastSeen).toISOString() : null,
    queuedCommands: commandQueue.length,
  });
});

app.get('/health', (req, res) => res.json({ ok: true }));

// =============================================================================
// ESP32 DEVICE ENDPOINTS
// =============================================================================

/**
 * ESP32 posts its telemetry every 2-5 seconds.
 * The server replies with any pending commands queued by the mobile app.
 */
app.post('/api/device/telemetry', auth, (req, res) => {
  const body = req.body;
  if (!body) return res.status(400).json({ err: 'empty payload' });

  lastSeen = Date.now();
  deviceStatus = {
    ...body,
    serverTime: new Date().toISOString(),
  };

  // If status includes config, update local cache
  if (body.config) {
    deviceConfig = { ...deviceConfig, ...body.config };
  }

  // If status includes recent moisture sample, add to history
  if (typeof body.avg === 'number') {
    historyBuffer.push({ t: Date.now(), avg: body.avg, wet: body.moist || [] });
    if (historyBuffer.length > 288) historyBuffer.shift();
  }

  // Return and flush pending commands
  const commandsToSend = [...commandQueue];
  commandQueue = [];

  res.json({
    ok: true,
    commands: commandsToSend,
  });
});

// =============================================================================
// MOBILE APP ENDPOINTS (Mirrors ESP32 REST API)
// =============================================================================

// GET /api/status - Returns telemetry to the mobile app
app.get('/api/status', auth, (req, res) => {
  const isOnline = lastSeen && (Date.now() - lastSeen < 15000);
  if (!deviceStatus) {
    return res.json({
      online: false,
      state: 'OFFLINE',
      avg: 0,
      moist: [0, 0, 0],
      flow: 0,
      session: 0,
      total: 0,
      pump: false,
      valve: false,
      auto: true,
      rainSkip: false,
      fault: 'NONE',
    });
  }

  res.json({
    ...deviceStatus,
    online: Boolean(isOnline),
  });
});

// GET /api/config - Returns runtime configuration
app.get('/api/config', auth, (req, res) => {
  res.json(deviceConfig);
});

// POST /api/config - Updates configuration and queues for ESP32
app.post('/api/config', auth, (req, res) => {
  deviceConfig = { ...deviceConfig, ...req.body };
  commandQueue.push({
    id: Date.now(),
    action: 'config',
    data: req.body,
  });
  res.json({ ok: true, queued: true });
});

// POST /api/manual - Queue manual irrigation pulse
app.post('/api/manual', auth, (req, res) => {
  const sec = Number(req.body.sec) || 120;
  commandQueue.push({
    id: Date.now(),
    action: 'manual',
    sec,
  });
  res.json({ ok: true, queued: true, sec });
});

// POST /api/stop - Queue immediate emergency stop
app.post('/api/stop', auth, (req, res) => {
  // Clear other manual watering commands
  commandQueue = commandQueue.filter(c => c.action !== 'manual');
  commandQueue.push({
    id: Date.now(),
    action: 'stop',
  });
  res.json({ ok: true, queued: true });
});

// POST /api/reset - Queue latched fault reset
app.post('/api/reset', auth, (req, res) => {
  commandQueue.push({
    id: Date.now(),
    action: 'reset',
  });
  res.json({ ok: true, queued: true });
});

// POST /api/time - Queue RTC time synchronization
app.post('/api/time', auth, (req, res) => {
  commandQueue.push({
    id: Date.now(),
    action: 'time',
    data: req.body,
  });
  res.json({ ok: true, queued: true });
});

// POST /api/calibrate - Queue 2-point sensor calibration
app.post('/api/calibrate', auth, (req, res) => {
  const kind = req.body.kind;
  if (kind !== 'dry' && kind !== 'wet') return res.status(400).json({ err: 'invalid kind' });
  commandQueue.push({
    id: Date.now(),
    action: 'calibrate',
    kind,
  });
  res.json({ ok: true, queued: true });
});

// GET /api/history - Return history sample buffer
app.get('/api/history', auth, (req, res) => {
  const v = historyBuffer.map(h => h.avg);
  const w = historyBuffer.map(h => h.wet);
  res.json({ step: 300, v, w });
});

// POST /api/wifi - Queue Wi-Fi credentials change for ESP32
app.post('/api/wifi', auth, (req, res) => {
  const { ssid, pass } = req.body || {};
  if (!ssid) return res.status(400).json({ err: 'SSID is required' });
  commandQueue.push({
    id: Date.now(),
    action: 'wifi',
    ssid,
    pass: pass || '',
  });
  res.json({ ok: true, queued: true, msg: 'Wi-Fi credentials queued for ESP32 sync.' });
});

// GET /api/wifi/scan - Wi-Fi scan handler for cloud relay
app.get('/api/wifi/scan', auth, (req, res) => {
  res.json({
    ok: true,
    networks: [],
    cloud: true,
    msg: 'Airwave scanning is only available when connected directly to ESP32 Local SoftAP (192.168.4.1). Enter SSID manually or connect to ESP32 hotspot.',
  });
});

// GET /api/cloud - Return current cloud server URL
app.get('/api/cloud', auth, (req, res) => {
  res.json({ ok: true, cloudUrl: process.env.CLOUD_URL || 'https://sprinkler-server.onrender.com' });
});

// POST /api/cloud - Update cloud URL
app.post('/api/cloud', auth, (req, res) => {
  res.json({ ok: true });
});


const server = app.listen(PORT, () => {
  console.log(`AutoSprinkler Cloud Relay Server active on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
