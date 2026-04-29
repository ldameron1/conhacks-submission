/**
 * Route Rehearsal — Unified Server
 *
 * Serves static files (replacing python3 -m http.server) AND runs a
 * WebSocket relay so a phone can connect as a steering controller.
 *
 * Run:  node server.js
 * Or:   npm start
 *
 * The server listens on PORT (default 8080).
 * Static files are served from this directory.
 * WebSocket is mounted on the same port (upgrade path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const mimeTypes = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* ─────────────── HTTP Static Server ─────────────── */

const server = http.createServer((req, res) => {
  const requestPath = req.url.split("?")[0];

  if (requestPath === "/config.js") {
    const publicConfig = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
      GOOGLE_MAPS_KEY: process.env.GOOGLE_MAPS_KEY || "",
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
    };
    const js = `window.__ROUTE_REHEARSAL_CONFIG__ = ${JSON.stringify(publicConfig)};`;
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    res.end(js);
    return;
  }

  let relativePath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("403 Forbidden");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("500 Server Error");
      }
      return;
    }

    // CORS headers for local development
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    });
    res.end(content, "utf-8");
  });
});

/* ─────────────── WebSocket Relay ─────────────── */

const wss = new WebSocket.Server({ server });

// roomCode -> { host: WebSocket, controller: WebSocket|null, createdAt: number }
const rooms = new Map();

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const iface of entries) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      urls.push(`http://${iface.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function broadcast(room, message, exclude) {
  const payload = JSON.stringify(message);
  if (room.host && room.host !== exclude && room.host.readyState === WebSocket.OPEN) {
    room.host.send(payload);
  }
  if (room.controller && room.controller !== exclude && room.controller.readyState === WebSocket.OPEN) {
    room.controller.send(payload);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw);

      if (data.type === "host_join") {
        let code = generateRoomCode();
        // prevent collisions
        while (rooms.has(code)) code = generateRoomCode();
        rooms.set(code, { host: ws, controller: null, createdAt: Date.now() });
        ws._role = "host";
        ws._room = code;
        ws.send(JSON.stringify({ type: "room_created", roomCode: code }));
        console.log(`[WS] Host created room ${code}`);
      }

      else if (data.type === "controller_join") {
        const room = rooms.get(data.roomCode);
        if (!room) {
          ws.send(JSON.stringify({ type: "error", message: "Room not found. Check the code and try again." }));
          return;
        }
        room.controller = ws;
        ws._role = "controller";
        ws._room = data.roomCode;
        ws.send(JSON.stringify({ type: "joined", roomCode: data.roomCode }));
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({ type: "controller_connected" }));
        }
        console.log(`[WS] Controller joined room ${data.roomCode}`);
      }

      else if (data.type === "controller_input") {
        const room = rooms.get(ws._room);
        if (room && room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({
            type: "controller_input",
            steering: data.steering ?? 0,
            brake: data.brake ?? false,
            gas: data.gas ?? false,
            signalLeft: data.signalLeft ?? false,
            signalRight: data.signalRight ?? false,
          }));
        }
      }

      else if (data.type === "host_ping") {
        const room = rooms.get(ws._room);
        if (room && room.controller && room.controller.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "controller_connected" }));
        }
      }
    } catch (e) {
      console.error("[WS] Bad message:", e.message);
    }
  });

  ws.on("close", () => {
    const room = rooms.get(ws._room);
    if (!room) return;

    if (ws._role === "host") {
      // Host left — destroy room
      if (room.controller && room.controller.readyState === WebSocket.OPEN) {
        room.controller.send(JSON.stringify({ type: "host_disconnected" }));
      }
      rooms.delete(ws._room);
      console.log(`[WS] Room ${ws._room} closed (host left)`);
    } else if (ws._role === "controller") {
      room.controller = null;
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({ type: "controller_disconnected" }));
      }
      console.log(`[WS] Controller left room ${ws._room}`);
    }
  });
});

/* ─────────────── Cleanup stale rooms ─────────────── */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Remove rooms older than 30 min with no controller
    if (!room.controller && now - room.createdAt > 30 * 60 * 1000) {
      if (room.host) room.host.close();
      rooms.delete(code);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => {
  const localhostUrl = `http://localhost:${PORT}`;
  console.log(`Route Rehearsal server running on ${localhostUrl}`);
  console.log(`WebSocket ready on ws://localhost:${PORT}`);
  console.log(`Phone controller page (same device): ${localhostUrl}/controller.html`);

  const lanUrls = getLanUrls(PORT);
  if (lanUrls.length) {
    console.log("Phone controller page (same Wi-Fi):");
    for (const url of lanUrls) {
      console.log(`  - ${url}/controller.html`);
    }
  } else {
    console.log("No LAN IPv4 address detected. Use ngrok for remote phone pairing.");
  }

  console.log("For internet pairing, run: ngrok http 8080");
});
