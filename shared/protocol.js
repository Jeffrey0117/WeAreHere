// WeAreHere — shared message protocol.
// This file is the contract. Broker, agent, and dashboard ALL import it.
// The only thing fixed across the whole project is the message envelope below;
// every future feature is just a new `topic` + `payload`, never a new transport.

export const MASTER = 'master'; // the broker / host machine
export const BROADCAST = '*'; // "to everyone"

// The four control primitives. Everything you ever want to do is one of these.
export const Type = {
  EVENT: 'event', // fire-and-forget announcement ("I'm online", "task done")
  COMMAND: 'command', // "go do this" — no reply expected
  REQUEST: 'request', // "I'm asking, reply with the same id"
  RESPONSE: 'response', // the reply to a REQUEST (shares its id)
  HEARTBEAT: 'heartbeat', // "still alive" — sent to master on an interval
};

let _seq = 0;
export function newId() {
  return `${Date.now().toString(36)}-${(_seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The envelope. THIS is the foundation — never changes shape.
//   id      : message id; a RESPONSE reuses its REQUEST's id so they pair up
//   from/to : node ids. `to` can be a node id, MASTER, or BROADCAST
//   type    : one of Type.*
//   topic   : what this message is about — your project defines these freely
//   payload : the actual content — your project fills this freely
//   ts      : epoch ms when created
export function makeMessage({ from, to, type, topic, payload = {}, id = newId() }) {
  return { id, from, to, type, topic, payload, ts: Date.now() };
}

export const event = (from, to, topic, payload) =>
  makeMessage({ from, to, type: Type.EVENT, topic, payload });

export const command = (from, to, topic, payload) =>
  makeMessage({ from, to, type: Type.COMMAND, topic, payload });

export const request = (from, to, topic, payload) =>
  makeMessage({ from, to, type: Type.REQUEST, topic, payload });

// A response reuses the request's id and addresses it back to the asker.
export const response = (reqMsg, from, payload) =>
  makeMessage({ from, to: reqMsg.from, type: Type.RESPONSE, topic: reqMsg.topic, payload, id: reqMsg.id });

export const heartbeat = (from, payload = {}) =>
  makeMessage({ from, to: MASTER, type: Type.HEARTBEAT, topic: 'heartbeat', payload });

export const encode = (msg) => JSON.stringify(msg);
export const decode = (raw) => JSON.parse(raw);
