# AutoSprinkler Cloud Relay Server

Lightweight cloud relay and bridge connecting the **FireBeetle ESP32** and the **Mobile App** via Render (`https://<your-service-name>.onrender.com`).

## Why This Server Exists
- **Eliminates Local IP Dependency:** Neither your phone nor your ESP32 needs to know or configure local IP addresses (`192.168.x.x`).
- **Access from Anywhere:** Control and monitor the irrigation system over mobile cellular data (4G/5G) from anywhere in the world.
- **NAT / Firewall Punching:** The ESP32 creates an outbound HTTP sync connection to this cloud server, bypassing router firewall and port-forwarding restrictions.

---

## Free Deployment to Render (Two Methods)

### Method A: One-Click Blueprint Deployment (Recommended)
This repository includes a [`render.yaml`](file:///c:/Users/JEFFREY%20PERESORES/Documents/GitHub/sprinkler_server/render.yaml) file that pre-configures everything:
1. Push this repository (`sprinkler_server`) to your GitHub account.
2. Log in to [Render.com](https://render.com).
3. Click **New +** ➔ **Blueprint**.
4. Connect this GitHub repository.
5. Render will automatically detect `render.yaml`, configure the Node environment, setup the health check, and deploy the service.

### Method B: Manual Web Service Setup
1. Push this repository (`sprinkler_server`) to your GitHub account.
2. Log in to [Render.com](https://render.com).
3. Click **New +** ➔ **Web Service**.
4. Select your GitHub repository: `sprinkler_server`.
5. Configure the deployment settings:
   - **Name:** `sprinkler-server` (or your preferred service name)
   - **Root Directory:** (leave empty — root of repo)
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
   - **Instance Type:** `Free`
6. Under **Environment Variables**, configure:
   - `API_TOKEN` = `change-me-123` *(Must match the API_TOKEN set in the ESP32 firmware and React Native mobile app)*
   - `NODE_VERSION` = `20`
7. Click **Create Web Service**.
8. Once deployed, Render will provide your public URL:
   `https://<your-service-name>.onrender.com` (e.g., `https://sprinkler-server.onrender.com`).

---

## Connecting Frontend to this Backend

Once your Render service is live:
1. Copy your live Render URL (e.g. `https://sprinkler-server.onrender.com`).
2. In the `Automated_SprinklerIOT/SprinklerApp` folder, open `.env`:
   ```env
   EXPO_PUBLIC_CLOUD_URL=https://<your-service-name>.onrender.com
   EXPO_PUBLIC_API_TOKEN=change-me-123
   ```
3. Start or restart Expo:
   ```bash
   npx expo start -c
   ```
4. Or in the mobile app UI under **Settings**, tap the **Cloud (Render)** button or enter your URL directly into the connection field.

---

## Local Development & Testing

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Run Server:**
   ```bash
   npm start
   ```
   The server will start on `http://localhost:3000`.

---

## API Endpoints Reference

All `/api/*` endpoints require the header `x-token: <API_TOKEN>`.

### Health & Status
- `GET /` — Service status, ESP32 online/offline indicator, command queue count.
- `GET /health` — Health check endpoint (`{"ok": true}`).

### Device Telemetry (ESP32)
- `POST /api/device/telemetry` — ESP32 pushes real-time telemetry (every 2–5s) and receives queued commands.

### Mobile App Operations
- `GET /api/status` — Current irrigation telemetry and online status.
- `GET /api/config` — Current irrigation configuration and schedule.
- `POST /api/config` — Update configuration (queued for ESP32).
- `POST /api/manual` — Queue manual watering pulse (`{"sec": 120}`).
- `POST /api/stop` — Queue emergency irrigation stop.
- `POST /api/reset` — Queue fault reset.
- `POST /api/time` — Queue RTC time synchronization.
- `POST /api/calibrate` — Queue sensor calibration (`{"kind": "dry" | "wet"}`).
- `GET /api/history` — 24-hour moisture sample history buffer.