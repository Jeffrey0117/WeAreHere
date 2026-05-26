// WeAreHere — one-shot controller, for testing routing & request/response.
// Connects as a temporary "controller", sends ONE request to a target node,
// prints the reply, exits.
//
//   node tools/ask.js <targetNodeId> [topic]
//   topic defaults to "sys.stats"  (other built-in: "ping")
//
// Examples:
//   node tools/ask.js laptop-1
//   node tools/ask.js laptop-1 ping
//   BROKER_URL=ws://192.168.0.10:8787 node tools/ask.js laptop-1

import WebSocket from 'ws';
import {
  Type, MASTER, decode, encode, event, request,
} from '../shared/protocol.js';

const target = process.argv[2];
const topic = process.argv[3] || 'sys.stats';
const BROKER_URL = process.env.BROKER_URL || 'ws://127.0.0.1:8787';
const ME = 'controller-' + Math.random().toString(36).slice(2, 6);

if (!target) {
  console.error('usage: node tools/ask.js <targetNodeId> [topic]');
  process.exit(1);
}

const ws = new WebSocket(BROKER_URL);

ws.on('open', () => {
  ws.send(encode(event(ME, MASTER, 'register', { role: 'controller' })));
  ws.send(encode(request(ME, target, topic, {})));
  console.log(`asked "${target}" [${topic}] — waiting for reply…`);
  setTimeout(() => { console.error('timeout: no reply in 5s'); process.exit(1); }, 5000);
});

ws.on('message', (raw) => {
  const msg = decode(raw);
  if (msg.type === Type.RESPONSE) {
    console.log(`reply from "${msg.from}":`, msg.payload);
    process.exit(0);
  }
  if (msg.type === Type.EVENT && msg.topic === 'error') {
    console.error('error:', msg.payload);
    process.exit(1);
  }
});

ws.on('error', (e) => { console.error('connection error:', e.message); process.exit(1); });
