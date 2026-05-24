const express = require("express");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

let state = {
  relay1: false,
  relay2: false,
  relay3: false,
  relay4: false
};

let esp32Online    = false;
let lastESP32Ping  = 0;
let pendingCommand = null;

app.get("/", (req, res) => {
  res.send(`
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
      color: #1a5276; text-align: center; width: 100%; max-width: 320px;
    }
    .dot {
      display: inline-block; width: 10px; height: 10px; border-radius: 50%;
      background: #e74c3c; margin-right: 6px; vertical-align: middle; transition: background 0.3s;
    }
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
    <span class="dot" id="dot"></span>
    <span id="esp-status">Checking ESP32...</span>
  </div>
  <div class="login-card">
    <h1>Smart Home</h1>
    <form id="loginForm">
      <input type="text" id="username" placeholder="Username" required autocomplete="off">
      <input type="password" id="password" placeholder="Password" required>
      <input type="submit" value="Sign In">
    </form>
  </div>
  <script>
    function checkStatus() {
      fetch('/status')
        .then(r => r.json())
        .then(data => {
          const dot = document.getElementById('dot');
          const txt = document.getElementById('esp-status');
          if (data.esp32Online) {
            dot.classList.add('online');
            txt.textContent = 'ESP32 Online';
          } else {
            dot.classList.remove('online');
            txt.textContent = 'ESP32 Offline';
          }
        }).catch(() => {});
    }
    checkStatus();
    setInterval(checkStatus, 3000);
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
  `);
});

app.get("/control", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Device Control</title>
  <style>
    :root { --bg: #f4f7f6; --card: #ffffff; --primary: #2c3e50; --active: #27ae60; --btn: #3498db; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg); color: var(--primary);
      margin: 0; padding: 1.5rem 1rem; text-align: center;
    }
    h1 { font-size: 1.6rem; margin-bottom: 0.3rem; font-weight: 600; }
    .status-bar {
      background: #eaf4fb; border: 1px solid #aed6f1; border-radius: 10px;
      padding: 0.6rem 1.2rem; margin: 0.8rem auto 1.5rem;
      font-size: 0.85rem; color: #1a5276; max-width: 400px;
    }
    .dot {
      display: inline-block; width: 10px; height: 10px; border-radius: 50%;
      background: #e74c3c; margin-right: 6px; vertical-align: middle; transition: background 0.3s;
    }
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
    .btn.active { border-color: var(--active); color: var(--active); background: #eafaf1; }
    .icon { font-size: 1.8rem; }
    .logout {
      margin-top: 2rem; color: #7f8c8d; font-size: 0.85rem;
      cursor: pointer; text-decoration: underline; display: inline-block;
    }
    .toast {
      position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
      background: #2c3e50; color: white; padding: 0.6rem 1.4rem;
      border-radius: 20px; font-size: 0.9rem; opacity: 0;
      transition: opacity 0.3s; pointer-events: none; white-space: nowrap;
    }
    .toast.show { opacity: 1; }
  </style>
</head>
<body>
  <h1>Control Panel</h1>
  <div class="status-bar">
    <span class="dot" id="dot"></span>
    <span id="esp-status">Connecting...</span>
  </div>
  <div class="grid">
    <button class="btn" id="btn-relay1" onclick="toggle('relay1')"><span class="icon">💡</span> Port 1</button>
    <button class="btn" id="btn-relay2" onclick="toggle('relay2')"><span class="icon">🔌</span> Port 2</button>
    <button class="btn" id="btn-relay3" onclick="toggle('relay3')"><span class="icon">📺</span> Port 3</button>
    <button class="btn" id="btn-relay4" onclick="toggle('relay4')"><span class="icon">🔋</span> Port 4</button>
  </div>
  <div class="logout" onclick="logout()">Logout</div>
  <div class="toast" id="toast"></div>
  <script>
    if (localStorage.getItem('auth') !== 'ok') location.href = '/';
    function pollStatus() {
      fetch('/status')
        .then(r => r.json())
        .then(data => {
          const dot = document.getElementById('dot');
          const txt = document.getElementById('esp-status');
          if (data.esp32Online) {
            dot.classList.add('online');
            txt.textContent = 'ESP32 Online — Ready to control';
          } else {
            dot.classList.remove('online');
            txt.textContent = 'ESP32 Offline';
          }
          ['relay1','relay2','relay3','relay4'].forEach(relay => {
            const btn = document.getElementById('btn-' + relay);
            btn.classList.toggle('active', data.state[relay]);
          });
        }).catch(() => {});
    }
    pollStatus();
    setInterval(pollStatus, 2000);
    function toggle(relay) {
      const btn = document.getElementById('btn-' + relay);
      const newState = !btn.classList.contains('active');
      btn.classList.toggle('active', newState);
      fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relay: relay, state: newState })
      }).then(() => {
        showToast((newState ? '✅ ' : '⭕ ') + relay.replace('relay','Port ') + (newState ? ' ON' : ' OFF'));
      }).catch(() => {
        btn.classList.toggle('active', !newState);
        showToast('❌ Connection error');
      });
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
  `);
});

app.get("/status", (req, res) => {
  if (Date.now() - lastESP32Ping > 10000) esp32Online = false;
  res.json({ esp32Online, state, pendingCommand });
});

app.post("/command", (req, res) => {
  const { relay, state: newState } = req.body;
  if (!relay || newState === undefined) return res.status(400).json({ error: "Missing relay or state" });
  pendingCommand = { relay, state: newState };
  state[relay] = newState;
  console.log("📡 Command stored: " + relay + " → " + (newState ? "ON" : "OFF"));
  res.json({ ok: true });
});

app.post("/esp32/poll", (req, res) => {
  esp32Online   = true;
  lastESP32Ping = Date.now();
  if (req.body && req.body.states) {
    const s = req.body.states;
    if (s.relay1 !== undefined) state.relay1 = s.relay1;
    if (s.relay2 !== undefined) state.relay2 = s.relay2;
    if (s.relay3 !== undefined) state.relay3 = s.relay3;
    if (s.relay4 !== undefined) state.relay4 = s.relay4;
  }
  const cmd = pendingCommand;
  pendingCommand = null;
  res.json({ command: cmd });
});

app.listen(PORT, () => {
  console.log("🚀 Smart Home relay server running on port " + PORT);
});
