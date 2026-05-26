// WeAreHere — agent (runs on each laptop).
// Opens ONE websocket to the broker, reports in ("we are here"), heartbeats,
// and answers requests / obeys commands. It auto-reconnects forever.
//
// Configure per-machine via env vars:
//   NODE_ID     stable name for this laptop   (default: hostname)
//   BROKER_URL  where the hub is              (default: ws://127.0.0.1:8787)

import WebSocket from 'ws';
import os from 'node:os';
import si from 'systeminformation';
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

  ws.on('open', async () => {
    log('connected — announcing "we are here"');
    send(event(NODE_ID, MASTER, 'register', await sysInfo()));
    hbTimer = setInterval(async () => send(heartbeat(NODE_ID, await sysSnapshot())), HEARTBEAT_INTERVAL);
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
async function handleRequest(msg) {
  switch (msg.topic) {
    case 'sys.stats': return send(response(msg, NODE_ID, await sysSnapshot()));
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
async function sysInfo() {
  const base = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cores: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1073741824).toFixed(1),
  };
  try {
    const cpu = await si.cpu();
    base.cpuModel = `${cpu.manufacturer} ${cpu.brand}`.trim();
  } catch { /* cpu model is best-effort */ }
  return base;
}

// Live numbers — sent on every heartbeat. Real CPU%, memory, temperature, disk.
// tempC/diskUsedPct are null when the machine has no sensor / can't report.
async function sysSnapshot() {
  try {
    const [load, mem, temp, fs] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.cpuTemperature(),
      si.fsSize(),
    ]);
    const sysDisk = fs.find((d) => /^C:/i.test(d.mount)) || fs[0] || {};
    return {
      cpuPct: Math.round(load.currentLoad),
      memUsedPct: Math.round((mem.active / mem.total) * 100),
      tempC: temp.main > 0 ? Math.round(temp.main) : null,
      diskUsedPct: sysDisk.use != null ? Math.round(sysDisk.use) : null,
      upMin: Math.round(os.uptime() / 60),
    };
  } catch (e) {
    return { error: e.message, upMin: Math.round(os.uptime() / 60) };
  }
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
}

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), `[${NODE_ID}]`, ...a);
}

connect();
