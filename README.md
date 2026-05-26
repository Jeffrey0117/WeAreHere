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

# terminal 1 — the hub
npm run broker

# terminal 2 — a fake node
$env:NODE_ID="laptop-1"; npm run agent

# terminal 3 — another fake node
$env:NODE_ID="laptop-2"; npm run agent

# terminal 4 — ask laptop-1 for its stats (proves request/response routing)
npm run ask laptop-1
npm run ask laptop-1 ping
```

You should see the broker log each node as it reports in, the agents notice
each other coming online, and `ask` get a live reply back through the hub.

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

## Roadmap (rides on the same envelope)

- **Dashboard**: a web page on the host that subscribes to node.online /
  heartbeat and renders five live cards.
- **Real stats**: swap `os` for the `systeminformation` package (CPU%, temp,
  disk, per-process).
- **Task control**: `command` topics like `task.start` / `task.stop` to manage
  the py/node automation each laptop runs.
- **Screen stream**: an MJPEG topic when you want eyes on a screen.
