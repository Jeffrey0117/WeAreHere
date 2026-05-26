// WeAreHere — broker (the hub / host machine).
// Every node keeps ONE websocket open to here. The broker:
//   - registers nodes when they report in ("we are here")
//   - tracks presence via heartbeats, marks nodes offline on timeout
//   - routes every message by its `to` field (a node id, MASTER, or BROADCAST)
// It is deliberately dumb about payloads — it only reads the envelope.

import { WebSocketServer } from 'ws';
import {
  Type, MASTER, BROADCAST, decode, encode, event, response,
} from '../shared/protocol.js';

const PORT = Number(process.env.PORT) || 8787;
const HEARTBEAT_TIMEOUT = 15000; // mark offline if silent this long
const SWEEP_INTERVAL = 5000;

// id -> { ws, info, lastSeen, online }
const nodes = new Map();

const wss = new WebSocketServer({ port: PORT });
log(`broker listening on ws://0.0.0.0:${PORT}  — waiting for nodes to report in`);

wss.on('connection', (ws) => {
  ws._nodeId = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = decode(raw); } catch { return; } // ignore garbage
    handle(ws, msg);
  });
  ws.on('close', () => markOffline(ws._nodeId, 'disconnected'));
  ws.on('error', () => {});
});

function handle(ws, msg) {
  // --- registration: first thing a node sends ---
  if (msg.type === Type.EVENT && msg.topic === 'register') {
    const id = msg.from;
    ws._nodeId = id;
    nodes.set(id, { ws, info: msg.payload || {}, lastSeen: Date.now(), online: true });
    log(`✔ "${id}" is HERE   (${onlineIds().length} online)`);
    send(ws, event(MASTER, id, 'registered', { brokerTime: Date.now(), peers: onlineIds().filter((p) => p !== id) }));
    broadcast(event(MASTER, BROADCAST, 'node.online', { id, info: msg.payload }), id);
    return;
  }

  if (!ws._nodeId) return; // must register before anything else

  // --- heartbeat: refresh presence, fold in any live stats ---
  if (msg.type === Type.HEARTBEAT) {
    const n = nodes.get(ws._nodeId);
    if (n) { n.lastSeen = Date.now(); n.online = true; n.info = { ...n.info, ...msg.payload }; }
    return;
  }

  route(msg);
}

// The whole point of the broker: deliver by `to`.
function route(msg) {
  if (msg.to === MASTER) return onMasterMessage(msg);
  if (msg.to === BROADCAST) return broadcast(msg, msg.from);

  const target = nodes.get(msg.to);
  if (target && target.online) {
    send(target.ws, msg);
  } else {
    // tell the sender we couldn't deliver
    const sender = nodes.get(msg.from);
    if (sender) send(sender.ws, event(MASTER, msg.from, 'error', { reason: 'target-unreachable', to: msg.to, ref: msg.id }));
  }
}

// Messages addressed to the hub itself. The broker can answer a few built-ins;
// anything else is monitoring data the dashboard will consume later.
function onMasterMessage(msg) {
  if (msg.type === Type.REQUEST && msg.topic === 'nodes.list') {
    const sender = nodes.get(msg.from);
    if (sender) send(sender.ws, response(msg, MASTER, { nodes: snapshot() }));
    return;
  }
  log(`master <- ${msg.from}  [${msg.type}/${msg.topic}]  ${JSON.stringify(msg.payload)}`);
}

// --- presence sweep ---
setInterval(() => {
  const now = Date.now();
  for (const [id, n] of nodes) {
    if (n.online && now - n.lastSeen > HEARTBEAT_TIMEOUT) markOffline(id, 'heartbeat timeout');
  }
}, SWEEP_INTERVAL);

function markOffline(id, why) {
  if (!id) return;
  const n = nodes.get(id);
  if (!n || !n.online) return;
  n.online = false;
  log(`✖ "${id}" offline (${why})`);
  broadcast(event(MASTER, BROADCAST, 'node.offline', { id }), id);
}

// --- helpers ---
function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(encode(msg));
}

function broadcast(msg, exceptId) {
  for (const [id, n] of nodes) {
    if (id !== exceptId && n.online) send(n.ws, msg);
  }
}

const onlineIds = () => [...nodes].filter(([, n]) => n.online).map(([id]) => id);

const snapshot = () =>
  [...nodes].map(([id, n]) => ({ id, online: n.online, lastSeen: n.lastSeen, info: n.info }));

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), '[broker]', ...a);
}
