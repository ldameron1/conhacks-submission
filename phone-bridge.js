/**
 * Phone Bridge Module — WebSocket relay for phone-as-controller
 *
 * Laptop (host) opens a WebSocket, gets a room code, and shows a QR/URL.
 * Phone (controller) opens the same room code and streams gyro + touch input.
 * Inputs are relayed to the laptop and forwarded into cesium-view steering.
 */

const WS_PROTOCOL = location.protocol === "https:" ? "wss" : "ws";
const WS_URL = `${WS_PROTOCOL}://${location.host}`;

let ws = null;
let roomCode = null;
let isHost = false;
let isConnected = false;
let onInputCallback = null;
let onStatusCallback = null;
let onHostDataCallback = null;
let reconnectTimer = null;

/* ═══════════════ Host (Laptop) ═══════════════ */

export function startHostRoom() {
  if (ws) ws.close();
  isHost = true;
  connect();
}

export function closeRoom() {
  if (ws) {
    ws.close();
    ws = null;
  }
  roomCode = null;
  isHost = false;
  isConnected = false;
  clearTimeout(reconnectTimer);
}

export function getRoomCode() {
  return roomCode;
}

export function isControllerConnected() {
  return isConnected;
}

/* ═══════════════ Controller (Phone) ═══════════════ */

export function joinRoom(code) {
  if (ws) ws.close();
  isHost = false;
  roomCode = code;
  connect();
}

/* ═══════════════ Shared WebSocket logic ═══════════════ */

function connect() {
  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      if (isHost) {
        ws.send(JSON.stringify({ type: "host_join" }));
      } else {
        ws.send(JSON.stringify({ type: "controller_join", roomCode }));
      }
    };

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      handleMessage(data);
    };

    ws.onclose = () => {
      isConnected = false;
      if (onStatusCallback) onStatusCallback("disconnected");
      // Auto-reconnect after 2s if not explicitly closed
      if (roomCode || isHost) {
        reconnectTimer = setTimeout(connect, 2000);
      }
    };

    ws.onerror = () => {
      if (onStatusCallback) onStatusCallback("error");
    };
  } catch (e) {
    console.error("[PhoneBridge] WebSocket error:", e);
    if (onStatusCallback) onStatusCallback("error");
  }
}

function handleMessage(data) {
  switch (data.type) {
    case "room_created":
      roomCode = data.roomCode;
      if (onStatusCallback) onStatusCallback("room_created", roomCode);
      break;
    case "joined":
      if (onStatusCallback) onStatusCallback("joined", data.roomCode);
      break;
    case "controller_connected":
      isConnected = true;
      if (onStatusCallback) onStatusCallback("controller_connected");
      break;
    case "controller_disconnected":
      isConnected = false;
      if (onStatusCallback) onStatusCallback("controller_disconnected");
      break;
    case "controller_input":
      if (onInputCallback) onInputCallback(data);
      break;
    case "host_data":
      if (onHostDataCallback) onHostDataCallback(data.payload);
      break;
    case "error":
      if (onStatusCallback) onStatusCallback("error", data.message);
      break;
  }
}

/* ═══════════════ Controller Input Senders ═══════════════ */

export function sendSteering(value) {
  // value: -1.0 (hard left) to +1.0 (hard right)
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "controller_input", steering: value, brake: false, gas: false }));
}

export function sendBrake(active) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "controller_input", steering: 0, brake: active, gas: false }));
}

export function sendGas(active) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "controller_input", steering: 0, brake: false, gas: active }));
}

export function sendSignal(left, right) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "controller_input", steering: 0, brake: false, gas: false, signalLeft: left, signalRight: right }));
}

/**
 * Send data from host to the connected controller (e.g., speedometer updates).
 */
export function sendToController(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "host_data", payload: data }));
}

/* ═══════════════ Callbacks ═══════════════ */

export function onInput(cb) {
  onInputCallback = cb;
}

export function onStatus(cb) {
  onStatusCallback = cb;
}

export function onHostData(cb) {
  onHostDataCallback = cb;
}
