// Presence relay — a tiny in-memory WebSocket pub/sub for live cursors and
// "who's online". No database: state exists only while sockets are connected.
// Runs on the Mac mini under PM2 and is exposed publicly via Tailscale Funnel
// (https://minivlad.tail83ea3e.ts.net/presence → this port).
//
//   pm2 start presence-relay/server.mjs --name presence-relay
//
// Protocol (JSON messages):
//   connect: wss://host/presence?token=<PRESENCE_TOKEN>&room=<slug>&u=<username>
//   client → server: {type:"track", path}            update my current page
//                    {type:"cursor", x, y, path}     my cursor (viewport fractions)
//   server → client: {type:"sync", users:[{username, path}]}
//                    {type:"cursor", username, x, y, path}
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PRESENCE_PORT || 3940);
const TOKEN = process.env.PRESENCE_TOKEN || "";

/** room → Map<ws, {username, path}> */
const rooms = new Map();

function roster(room) {
  const peers = rooms.get(room);
  if (!peers) return [];
  // One entry per username (last tab wins), sorted for stable rendering.
  const byName = new Map();
  for (const meta of peers.values()) byName.set(meta.username, meta);
  return [...byName.values()].sort((a, b) => a.username.localeCompare(b.username));
}

function broadcast(room, msg, except) {
  const peers = rooms.get(room);
  if (!peers) return;
  const data = JSON.stringify(msg);
  for (const ws of peers.keys()) {
    if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
  }
}

const syncRoom = (room) => broadcast(room, { type: "sync", users: roster(room) });

const server = createServer((req, res) => {
  // Plain-HTTP probe endpoint (also what Funnel health checks hit).
  res.writeHead(200, { "content-type": "application/json" });
  const online = [...rooms.values()].reduce((n, peers) => n + peers.size, 0);
  res.end(JSON.stringify({ ok: true, service: "presence-relay", connections: online }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const room = (url.searchParams.get("room") || "").slice(0, 80);
  const username = (url.searchParams.get("u") || "").slice(0, 60);
  if (!room || !username || (TOKEN && url.searchParams.get("token") !== TOKEN)) {
    ws.close(4001, "unauthorized");
    return;
  }

  if (!rooms.has(room)) rooms.set(room, new Map());
  rooms.get(room).set(ws, { username, path: "/" });
  ws.isAlive = true;
  syncRoom(room);

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const peers = rooms.get(room);
    const meta = peers?.get(ws);
    if (!meta) return;
    if (msg.type === "track" && typeof msg.path === "string") {
      meta.path = msg.path.slice(0, 200);
      syncRoom(room);
    } else if (msg.type === "cursor" && typeof msg.x === "number" && typeof msg.y === "number") {
      broadcast(room, {
        type: "cursor",
        username: meta.username,
        x: msg.x,
        y: msg.y,
        path: typeof msg.path === "string" ? msg.path.slice(0, 200) : meta.path,
      }, ws);
    }
  });

  ws.on("close", () => {
    const peers = rooms.get(room);
    if (!peers) return;
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(room);
    else syncRoom(room);
  });
});

// Reap dead sockets (laptop lids, dropped wifi) so rosters don't go stale.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`presence-relay listening on 127.0.0.1:${PORT} (auth: ${TOKEN ? "token" : "OPEN"})`);
});
