/*
  ============================================================
  SAMTECH SMART HOME - Cloud Relay Server
  Deploy this on Railway.app
  - ESP32 connects here via WebSocket
  - Browser connects here via HTTP + WebSocket
  - Commands flow: Browser → Server → ESP32 → Server → Browser
  ============================================================
*/

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");

const app = express();
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const PORT = process.env.PORT || 3000;

// Track connected clients
let esp32Socket = null;       // The ESP32 connection
let browserSockets = [];      // All browser connections

// ─────────────────────────────────────────────────────────
//  Serve the Smart Home Interface (same design as before)
// ─────────────────────────────────────────────────────────
const loginPage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Home Login</title>
  <style>
    :root { --bg: #f4f7f6; --card: #ffffff; --primary: #2c3e50; --btn: #3498db; --btn-hover: #2980b9; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg); display: flex; flex-direction: column;
      justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 1rem;
    }
    .status-bar {
      background: #eaf4fb; border: 1px solid #aed6f1; border-radius: 10px;
      padding: 0.6rem 1.2rem; margin-bottom: 1rem; font-size: 0.85rem;
      color: #1a5276; text-align: center;
    }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
      background: #e74c3c; margin-right: 6px; vertical-align: middle; }
    .dot.online { background: #27ae60; }
    .login-card {
      background: var(--card); padding: 2.5rem; border-radius: 12px;
      box-shadow: 0 8px 16px rgba(0,0,0,0.08); width: 100%; max-width: 320px; text-align: center;
    }
    h1 { color: var(--primary); font-size: 1.5rem; margin-top: 0; margin-bottom: 1.5rem; font-weight: 600; }
    input[type='text'], input[type='password'] {
      width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ddd;
      border-radius: 8px; font-size: 1rem; transition: border-color 0.3s;
    }
    input:focus { border-color: var(--btn); outline: none; }
    input[type='submit'] {
      width: 100%; padding: 12px; background-color: var(--btn); color: white;
      border: none; border-radius: 8px; font-size: 1rem; font-weight: bold;
      cursor: pointer; transition: background-color 0.3s;
    }
    input[type='submit']:hover { background-color: var(--btn-hover); }
  </style>
</head>
<body>
  <div class="status-bar">
    <span class="dot" id="esp-dot"></span>
    <span id="esp-status">Checking ESP32 connection...</span>
  </div>
  <div class="login-card">
    <h1>Smart Home</h1>
    <form id="loginForm">
      <input type="text"     id="username" placeholder="Username" required>
      <input type="password" id="password" placeholder="Password" required>
      <input type="submit" value="Sign In">
    </form>
  </div>
  <script>
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'browser_hello' }));
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'esp_status') {
        const dot = document.getElementById('esp-dot');
        const txt = document.getElementById('esp-status');
        if (msg.online) {
          dot.classList.add('online');
          txt.textContent = 'ESP32 Online ✓';
        } else {
          dot.classList.remove('online');
          txt.textContent = 'ESP32 Offline — power it on';
        }
      }
    };
    document.getElementById('loginForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const u = document.getElementById('username').value;
      const p = document.getElementById('password').value;
      if (u === 'admin' && p === 'password') {
        localStorage.setItem('auth', 'ok');
        location.href = '/control';
      } else {
        alert('Invalid credentials');
      }
    });
  </script>
</body>
</html>
`;

const controlPage = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Device Control</title>
  <style>
    :root { --bg: #f4f7f6; --card: #ffffff; --primary: #2c3e50; --active: #27ae60; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg); color: var(--primary);
      margin: 0; padding: 1.5rem 1rem; text-align: center;
    }
    h1 { font-size: 1.6rem; margin-bottom: 0.3rem; font-weight: 600; }
    .status-bar {
      background: #eaf4fb; border: 1px solid #aed6f1; border-radius: 10px;
      padding: 0.6rem 1.2rem; margin: 0.8rem auto 1.5rem; font-size: 0.85rem;
      color: #1a5276; max-width: 400px;
    }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
      background: #e74c3c; margin-right: 6px; vertical-align: middle; }
    .dot.online { background: #27ae60; }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1.2rem; max-width: 400px; margin: 0 auto;
    }
    .btn {
      background: var(--card); color: var(--primary); border: 2px solid transparent;
      border-radius: 12px; padding: 1.5rem 1rem; font-size: 1.1rem; font-weight: bold;
      cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.05);
      transition: all 0.2s ease; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 8px;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:active { transform: scale(0.95); }
    .btn.active { border-color: var(--active); color: var(--active); }
    .icon { font-size: 1.8rem; }
    .logout {
      margin-top: 2rem; color: #7f8c8d; font-size: 0.85rem;
      cursor: pointer; text-decoration: underline;
    }
    .toast {
      position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
      background: #2c3e50; color: white; padding: 0.6rem 1.4rem;
      border-radius: 20px; font-size: 0.9rem; opacity: 0;
      transition: opacity 0.3s; pointer-events: none;
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <h1>Control Panel</h1>
  <div class="status-bar">
    <span class="dot" id="esp-dot"></span>
    <span id="esp-status">Connecting...</span>
  </div>
  <div class="grid">
    <button class="btn" id="btn1" onclick="toggle(this,'relay1')"><span class="icon">💡</span> Port 1</button>
    <button class="btn" id="btn2" onclick="toggle(this,'relay2')"><span class="icon">🔌</span> Port 2</button>
    <button class="btn" id="btn3" onclick="toggle(this,'relay3')"><span class="icon">📺</span> Port 3</button>
    <button class="btn" id="btn4" onclick="toggle(this,'relay4')"><span class="icon">🔋</span> Port 4</button>
  </div>
  <div class="logout" onclick="logout()">Logout</div>
  <div class="toast" id="toast"></div>
  <script>
    if (localStorage.getItem('auth') !== 'ok') location.href = '/';

    const relayState = { relay1: false, relay2: false, relay3: false, relay4: false };
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);

    ws.onopen = () => ws.send(JSON.stringify({ type: 'browser_hello' }));

    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'esp_status') {
        const dot = document.getElementById('esp-dot');
        const txt = document.getElementById('esp-status');
        if (msg.online) {
          dot.classList.add('online');
          txt.textContent = 'ESP32 Online — Ready to control';
        } else {
          dot.classList.remove('online');
          txt.textContent = 'ESP32 Offline — Commands queued';
        }
      }
      if (msg.type === 'relay_state') {
        // Sync button states from ESP32 confirmation
        relayState[msg.relay] = msg.state;
        const btnMap = { relay1:'btn1', relay2:'btn2', relay3:'btn3', relay4:'btn4' };
        const btn = document.getElementById(btnMap[msg.relay]);
        if (btn) btn.classList.toggle('active', msg.state);
      }
    };

    function toggle(btn, relay) {
      relayState[relay] = !relayState[relay];
      btn.classList.toggle('active', relayState[relay]);
      ws.send(JSON.stringify({ type: 'command', relay: relay, state: relayState[relay] }));
      showToast((relayState[relay] ? '✅ ' : '⭕ ') + relay.replace('relay','Port ') + (relayState[relay] ? ' ON' : ' OFF'));
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg; t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }

    function logout() { localStorage.removeItem('auth'); location.href = '/'; }
  </script>
</body>
</html>
`;

// ─────────────────────────────────────────────────────────
//  HTTP Routes
// ─────────────────────────────────────────────────────────
app.get("/",        (req, res) => res.send(loginPage));
app.get("/control", (req, res) => res.send(controlPage));

// ─────────────────────────────────────────────────────────
//  WebSocket Handler
// ─────────────────────────────────────────────────────────
wss.on("connection", (ws) => {
  console.log("New WebSocket connection");

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── ESP32 identifies itself ──
    if (msg.type === "esp32_hello") {
      esp32Socket = ws;
      ws.role = "esp32";
      console.log("✅ ESP32 connected");
      // Tell all browsers ESP32 is online
      broadcastToBrowsers({ type: "esp_status", online: true });
    }

    // ── Browser identifies itself ──
    if (msg.type === "browser_hello") {
      ws.role = "browser";
      browserSockets.push(ws);
      console.log("🌐 Browser connected");
      // Tell this browser current ESP32 status
      ws.send(JSON.stringify({ type: "esp_status", online: esp32Socket !== null && esp32Socket.readyState === 1 }));
    }

    // ── Browser sends relay command → forward to ESP32 ──
    if (msg.type === "command" && ws.role === "browser") {
      console.log(`📡 Command: ${msg.relay} → ${msg.state ? "ON" : "OFF"}`);
      if (esp32Socket && esp32Socket.readyState === 1) {
        esp32Socket.send(JSON.stringify({ type: "command", relay: msg.relay, state: msg.state }));
      }
    }

    // ── ESP32 confirms relay state → forward to all browsers ──
    if (msg.type === "relay_state" && ws.role === "esp32") {
      broadcastToBrowsers({ type: "relay_state", relay: msg.relay, state: msg.state });
    }
  });

  ws.on("close", () => {
    if (ws.role === "esp32") {
      console.log("❌ ESP32 disconnected");
      esp32Socket = null;
      broadcastToBrowsers({ type: "esp_status", online: false });
    }
    if (ws.role === "browser") {
      browserSockets = browserSockets.filter(s => s !== ws);
      console.log("Browser disconnected");
    }
  });
});

function broadcastToBrowsers(msg) {
  const data = JSON.stringify(msg);
  browserSockets = browserSockets.filter(s => s.readyState === 1);
  browserSockets.forEach(s => s.send(data));
}

httpServer.listen(PORT, () => {
  console.log(`🚀 Smart Home relay server running on port ${PORT}`);
});
