const express = require("express");
const mineflayer = require("mineflayer");
const fs = require("fs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 5000;

// =========================
// LOAD SETTINGS
// =========================

const config = JSON.parse(
  fs.readFileSync("./settings.json", "utf8")
);

let bot = null;
let botRunning = true;
let reconnectTimer = null;
let reconnectAttempts = 0;

const logs = [];

function addLog(message) {
  const time = new Date().toLocaleTimeString();

  const entry = `[${time}] ${message}`;

  console.log(entry);
  logs.push(entry);

  // Keep only the latest 200 logs
  if (logs.length > 200) {
    logs.shift();
  }
}

// =========================
// BOT STATUS
// =========================

const botState = {
  connected: false,
  username: config["bot-account"].username,
  version: null,
  lastConnected: null,
  lastDisconnect: null,
  lastError: null
};

// =========================
// CREATE BOT
// =========================

function createBot() {
  if (!botRunning) {
    addLog("[Bot] Bot is stopped.");
    return;
  }

  if (bot) {
    try {
      bot.quit();
    } catch (_) {}

    bot = null;
  }

  clearTimeout(reconnectTimer);

  addLog("[Bot] Starting connection...");

  const server = config.server;
  const account = config["bot-account"];

  const options = {
    username: account.username,
    auth: account.type || "offline",

    host: server.ip,
    port: Number(server.port),

    hideErrors: false,

    // Automatically detect server version
    version: server.version || false,

    // Give the connection plenty of time
    checkTimeoutInterval: 60000
  };

  // Only provide a password if one actually exists
  if (account.password) {
    options.password = account.password;
  }

  try {
    bot = mineflayer.createBot(options);
  } catch (error) {
    addLog(`[Bot] Failed to create bot: ${error.message}`);
    scheduleReconnect();
    return;
  }

  setupBotEvents(bot);
}

// =========================
// BOT EVENTS
// =========================

function setupBotEvents(currentBot) {

  currentBot.once("login", () => {
    addLog("[Bot] Login packet received.");
  });

  currentBot.once("spawn", () => {
    reconnectAttempts = 0;

    botState.connected = true;
    botState.version = currentBot.version;
    botState.lastConnected = new Date().toISOString();
    botState.lastError = null;

    addLog(
      `[Bot] Successfully spawned! Minecraft version: ${currentBot.version}`
    );

    addLog("[Bot] Bot is now connected.");
  });

  currentBot.on("chat", (username, message) => {
    if (username === currentBot.username) return;

    addLog(`[Chat] ${username}: ${message}`);
  });

  currentBot.on("message", (message) => {
    const text = message.toString();

    if (text.trim()) {
      addLog(`[Server] ${text}`);
    }
  });

  currentBot.on("kicked", (reason) => {
    let reasonText;

    try {
      reasonText =
        typeof reason === "string"
          ? reason
          : JSON.stringify(reason);
    } catch (_) {
      reasonText = String(reason);
    }

    addLog(`[Bot] Kicked: ${reasonText}`);
  });

  currentBot.on("error", (error) => {
    botState.lastError = error.message;

    addLog(`[Bot] Error: ${error.message}`);
  });

  currentBot.on("end", (reason) => {
    botState.connected = false;
    botState.lastDisconnect = new Date().toISOString();

    addLog(`[Bot] Disconnected: ${reason || "unknown reason"}`);

    if (botRunning) {
      scheduleReconnect();
    }
  });

  currentBot.on("death", () => {
    addLog("[Bot] Bot died.");
  });

  currentBot.on("health", () => {
    if (currentBot.health !== undefined) {
      addLog(
        `[Bot] Health: ${currentBot.health.toFixed(1)}`
      );
    }
  });
}

// =========================
// RECONNECT
// =========================

function scheduleReconnect() {
  if (!botRunning) return;

  if (reconnectTimer) {
    return;
  }

  reconnectAttempts++;

  // 5s → 10s → 20s → 40s → 60s maximum
  const delay = Math.min(
    5000 * Math.pow(2, reconnectAttempts - 1),
    60000
  );

  addLog(
    `[Bot] Reconnecting in ${Math.round(delay / 1000)}s (attempt #${reconnectAttempts})`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    if (botRunning) {
      createBot();
    }
  }, delay);
}

// =========================
// EXPRESS DASHBOARD
// =========================

app.get("/", (req, res) => {
  const status = botState.connected
    ? "CONNECTED"
    : "DISCONNECTED";

  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Slobos AFK Bot</title>

<style>
body {
  font-family: Arial, sans-serif;
  background: #111;
  color: white;
  max-width: 900px;
  margin: 40px auto;
  padding: 20px;
}

.card {
  background: #1d1d1d;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
}

.status {
  font-size: 28px;
  font-weight: bold;
}

pre {
  background: #080808;
  padding: 15px;
  border-radius: 8px;
  overflow-x: auto;
  white-space: pre-wrap;
}

button {
  padding: 10px 18px;
  margin-right: 8px;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
</style>
</head>

<body>

<h1>Slobos Minecraft Bot</h1>

<div class="card">

<div class="status">${status}</div>

<p>
Username: ${botState.username}
</p>

<p>
Version: ${botState.version || "Detecting..."}
</p>

<p>
Server: ${config.server.ip}:${config.server.port}
</p>

<p>
Last connected:
${botState.lastConnected || "Never"}
</p>

<p>
Last disconnect:
${botState.lastDisconnect || "Never"}
</p>

</div>

<div class="card">

<button onclick="startBot()">Start</button>
<button onclick="stopBot()">Stop</button>

</div>

<div class="card">

<h2>Logs</h2>

<pre>${logs.join("\n")}</pre>

</div>

<script>

async function startBot() {
  await fetch("/start", { method: "POST" });
  location.reload();
}

async function stopBot() {
  await fetch("/stop", { method: "POST" });
  location.reload();
}

</script>

</body>
</html>
`);
});

// =========================
// START
// =========================

app.post("/start", (req, res) => {

  if (botRunning) {
    return res.json({
      success: true,
      message: "Bot is already running."
    });
  }

  botRunning = true;

  addLog("[Dashboard] Starting bot...");

  createBot();

  res.json({
    success: true
  });
});

// =========================
// STOP
// =========================

app.post("/stop", (req, res) => {

  botRunning = false;

  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (bot) {
    try {
      bot.quit();
    } catch (_) {}

    bot = null;
  }

  botState.connected = false;

  addLog("[Dashboard] Bot stopped.");

  res.json({
    success: true
  });
});

// =========================
// HEALTH
// =========================

app.get("/health", (req, res) => {

  res.json({
    status: botState.connected
      ? "connected"
      : "disconnected",

    username: botState.username,

    version: botState.version,

    server: {
      ip: config.server.ip,
      port: config.server.port
    },

    botRunning,

    lastConnected: botState.lastConnected,

    lastDisconnect: botState.lastDisconnect,

    lastError: botState.lastError
  });
});

// =========================
// PING
// =========================

app.get("/ping", (req, res) => {
  res.send("pong");
});

// =========================
// LOGS API
// =========================

app.get("/logs", (req, res) => {
  res.json(logs);
});

// =========================
// SERVER
// =========================

app.listen(PORT, () => {

  addLog(
    `[Web] Dashboard running on port ${PORT}`
  );

  addLog(
    `[Config] Server: ${config.server.ip}:${config.server.port}`
  );

  addLog(
    `[Config] Bot username: ${config["bot-account"].username}`
  );

  createBot();
});
