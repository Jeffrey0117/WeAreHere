// WeAreHere — agent (runs on each laptop).
// Opens ONE websocket to the broker, reports in ("we are here"), heartbeats,
// and answers requests / obeys commands. It auto-reconnects forever.
//
// Configure per-machine via env vars:
//   NODE_ID     stable name for this laptop   (default: hostname)
//   BROKER_URL  where the hub is              (default: ws://127.0.0.1:8787)

import WebSocket from 'ws';
import os from 'node:os';
import {
  Type, MASTER, decode, encode, event, heartbeat, response,
} from '../shared/protocol.js';

const NODE_ID = process.env.NODE_ID || os.hostname();
const BROKER_URL = process.env.BROKER_URL || 'ws://127.0.0.1:8787';
const HEARTBEAT_INTERVAL = 5000;
const RECONNECT_DELAY = 3000;

let ws;
let hbTimer;

function connect() {
  log(`connecting to ${BROKER_URL} …`);
  ws = new WebSocket(BROKER_URL);

  ws.on('open', () => {
    log('connected — announcing "we are here"');
    send(event(NODE_ID, MASTER, 'register', sysInfo()));
    hbTimer = setInterval(() => send(heartbeat(NODE_ID, sysSnapshot())), HEARTBEAT_INTERVAL);
  });

  ws.on('message', (raw) => {
    let msg; try { msg = decode(raw); } catch { return; }
    onMessage(msg);
  });

  ws.on('close', () => {
    clearInterval(hbTimer);
    log(`disconnected — retrying in ${RECONNECT_DELAY / 1000}s`);
    setTimeout(connect, RECONNECT_DELAY);
  });

  ws.on('error', (e) => log('ws error:', e.message));
}

function onMessage(msg) {
  switch (msg.type) {
    case Type.EVENT:
      if (msg.topic === 'registered') log(`registered ✔  peers online: ${(msg.payload.peers || []).join(', ') || '(none)'}`);
      else if (msg.topic === 'node.online') log(`→ "${msg.payload.id}" came online`);
      else if (msg.topic === 'node.offline') log(`→ "${msg.payload.id}" went offline`);
      else if (msg.topic === 'error') log(`! broker error: ${JSON.stringify(msg.payload)}`);
      else log(`event [${msg.topic}] from ${msg.from}: ${JSON.stringify(msg.payload)}`);
      break;

    case Type.REQUEST:
      handleRequest(msg);
      break;

    case Type.COMMAND:
      handleCommand(msg);
      break;

    case Type.RESPONSE:
      log(`response [${msg.topic}] from ${msg.from}: ${JSON.stringify(msg.payload)}`);
      break;
  }
}

// Someone asked us something — reply with a RESPONSE (broker pairs it by id).
function handleRequest(msg) {
  switch (msg.topic) {
    case 'sys.stats': return send(response(msg, NODE_ID, sysSnapshot()));
    case 'ping': return send(response(msg, NODE_ID, { pong: true, at: Date.now() }));
    default: return send(response(msg, NODE_ID, { error: 'unknown-topic', topic: msg.topic }));
  }
}

// Someone told us to do something — no reply expected.
// This is where future projects plug in: exec, restart, task.start, etc.
function handleCommand(msg) {
  switch (msg.topic) {
    case 'say':
      log(`💬 from ${msg.from}: ${msg.payload.text}`);
      break;
    default:
      log(`command [${msg.topic}] from ${msg.from} (no handler yet): ${JSON.stringify(msg.payload)}`);
  }
}

// Static facts — sent once at register time.
function sysInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1048576),
  };
}

// Live numbers — sent on every heartbeat.
// NOTE: os.loadavg() is 0 on Windows. Swap in the `systeminformation`
// package later for real CPU%, temps, disk, per-process stats.
function sysSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    upMin: Math.round(os.uptime() / 60),
    memUsedPct: Math.round((1 - free / total) * 100),
    loadavg: os.loadavg(),
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
}

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), `[${NODE_ID}]`, ...a);
}

connect();
