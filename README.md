# WeAreHere

Internal-LAN control & communication backbone for a small cluster of laptops.

One **broker** runs on the host machine. Each laptop runs an **agent** that
keeps a single websocket open to the broker, reports in (*"we are here"*),
heartbeats, and obeys commands. Everything — monitoring, control, node-to-node
chatter — rides on top of one tiny message protocol.

```
            host machine = broker (hub)
                      │
   ┌────────┬─────────┼─────────┬────────┐
 laptop-1 laptop-2 laptop-3  laptop-4  laptop-5
  agent    agent    agent     agent     agent
```

Nodes never connect to each other directly. If laptop-1 wants to talk to
laptop-3, it sends through the broker, which forwards by the message's `to`
field. One connection per machine, one firewall port, full central visibility.

## The message envelope (the whole foundation)

Every message — no matter what it does — has this shape (`shared/protocol.js`):

```js
{
  id,      // message id; a response reuses its request's id to pair up
  from,    // sender node id
  to,      // "master" | "<nodeId>" | "*" (broadcast)
  type,    // event | command | request | response | heartbeat
  topic,   // what it's about — your features define these
  payload, // the content — your features fill this
  ts,      // epoch ms
}
```

Future features never touch the transport. They just add a new `topic` and
`payload`. The five `type`s cover everything:

| type        | meaning                                   |
| ----------- | ----------------------------------------- |
| `event`     | announcement, no reply (e.g. node.online) |
| `command`   | "go do this", no reply                     |
| `request`   | "answer me" (reply reuses the id)          |
| `response`  | the reply to a request                     |
| `heartbeat` | "still alive", sent to master on interval  |

## Run it (try on the host machine first)

```powershell
npm install

# terminal 1 — the hub (also serves the dashboard)
npm run broker

# terminal 2 — a fake node
$env:NODE_ID="laptop-1"; npm run agent

# terminal 3 — another fake node
$env:NODE_ID="laptop-2"; npm run agent

# terminal 4 — ask laptop-1 for its stats (proves request/response routing)
npm run ask laptop-1
npm run ask laptop-1 ping
```

Then open **http://localhost:8787** — the dashboard shows one live card per
node (CPU, memory, temperature, disk), updating every 1.5s, and greys a card out
~15s after its agent stops. You'll also see the broker log each node as it
reports in, the agents notice each other coming online, and `ask` get a live
reply back through the hub.

## Deploy to the 5 laptops

1. Give the host machine a **fixed LAN IP** (e.g. `192.168.0.10`).
2. On each laptop set the broker URL and a stable id, then run the agent:
   ```powershell
   $env:NODE_ID="laptop-3"
   $env:BROKER_URL="ws://192.168.0.10:8787"
   npm run agent
   ```
3. Allow the broker's port (`8787`) through the host's firewall.
4. Set each laptop's power options to **"do nothing" on lid close** so it stays
   connected, and run the agent on startup (Task Scheduler or a Windows service).

## Roadmap (everything rides on the same envelope — no new transport)

**Done**

- **Live dashboard** — `http://localhost:8787` renders one card per node from
  `node.online` / heartbeat data.
- **Real stats** — agents report real CPU%, memory, temperature, and disk via
  `systeminformation`.

**Next**

- **Command console** — a box on the dashboard to send a shell command to one /
  some / all nodes and stream their stdout back, side by side: SSH-for-the-fleet
  in a browser tab. (A `command` goes out; `event` chunks stream back.)
- **Task control** — `task.start` / `task.stop` topics to start, stop, and tail
  the logs of the py/node automation each laptop runs.
- **Node-to-node jobs** — a node splits a workload and dispatches chunks to its
  peers through the broker: a poor-man's distributed task queue.
- **Screen stream** *(maybe)* — a low-fps MJPEG topic for the rare time you need
  eyes on an actual GUI. For full visual takeover, just use RDP.

## Layout

```
shared/protocol.js   the message envelope + 4 primitives — shared by all sides
broker/index.js      the hub: registers nodes, tracks presence, routes by `to`,
                     and serves the dashboard + read-only /api/nodes
agent/index.js       runs on each laptop: reports in, heartbeats, obeys commands
dashboard/index.html the live web UI (polls /api/nodes)
tools/ask.js         one-shot CLI to test request/response routing
```
