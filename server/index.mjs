// Free World game server (Phase 2 multiplayer foundation).
//
//   node server/index.mjs            → http://localhost:8787 (serves dist/ + WebSocket at /ws)
//   PORT=9000 DATA_DIR=./data node server/index.mjs
//
// Authority model (brief Part 22): clients send intent/state at 15 Hz, the server validates
// every update (speed limits, teleports only through server-approved transitions), owns the
// world clock and accounts/characters, filters what each client receives by distance, and
// arbitrates player↔player interactions (shove range checks, chat range).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'server', 'data'));
const STATIC = path.join(ROOT, 'dist');
const TICK = 1000 / 15;                 // snapshot rate
const VIEW_R = 260;                     // interest radius (m)
const CHAT_R = 40, SHOUT_R = 90, SHOVE_R = 2.4;
const MAX_SPEED = { foot: 9.5, vehicle: 75 };  // m/s, generous: sprint 7.2, fast cars ~60
const DAY_SECONDS = 48 * 60;            // one game day = 48 real minutes (1 h = 2 min, as the client)

fs.mkdirSync(DATA, { recursive: true });
const DB_FILE = path.join(DATA, 'accounts.json');
const db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : { accounts: {} };
let dbDirty = false;
setInterval(() => { if (dbDirty) { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); dbDirty = false; } }, 3000);

const startedAt = Date.now(), clockAt0 = 17.25;
const worldHour = () => (clockAt0 + ((Date.now() - startedAt) / 1000) * (24 / DAY_SECONDS)) % 24;

// ------------------------------------------------------------------ static files
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, fw: true, players: players.size, hour: worldHour() })); return; }
  let file = path.normalize(path.join(STATIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(STATIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ------------------------------------------------------------------ players
const players = new Map();   // id -> player
let nextId = 1;
const clean = (s, n) => String(s ?? '').replace(/[<>\u0000-\u001f]/g, '').slice(0, n);
const num = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function sanitizeDNA(d) {
  if (!d || typeof d !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (Object.keys(out).length > 24) break;
    if (typeof v === 'number') out[clean(k, 16)] = num(v, -10, 200);
    else if (typeof v === 'string') out[clean(k, 16)] = clean(v, 24);
    else if (Array.isArray(v)) out[clean(k, 16)] = v.slice(0, 8).map((x) => clean(x, 16));
  }
  return out;
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws, req) => {
  const p = { id: nextId++, ws, name: 'Guest', account: null, dna: null, s: null, lastT: 0, ok: false, rate: { n: 0, t: Date.now() }, teleportGrace: 0 };
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  p.send = send;
  ws.on('message', (raw) => {
    // flood protection: max 40 messages/second
    const now = Date.now();
    if (now - p.rate.t > 1000) { p.rate.t = now; p.rate.n = 0; }
    if (++p.rate.n > 40) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!p.ok && m.t !== 'hello') return;
    handlers[m.t]?.(p, m, now);
  });
  ws.on('close', () => { players.delete(p.id); broadcast({ t: 'leave', id: p.id }); });
});

const handlers = {
  // Account = random token kept by the client; the character (DNA + name) belongs to the account,
  // separate from any in-world life state (brief: account ≠ avatar ≠ life).
  hello(p, m) {
    let token = clean(m.token, 64), acc = token && db.accounts[token];
    if (!acc) { token = crypto.randomBytes(18).toString('hex'); acc = db.accounts[token] = { created: Date.now(), name: `Guest${1000 + Math.floor(Math.random() * 9000)}`, dna: null }; dbDirty = true; }
    if (m.name) acc.name = clean(m.name, 20) || acc.name;
    if (m.dna) acc.dna = sanitizeDNA(m.dna);
    dbDirty = true;
    Object.assign(p, { ok: true, account: token, name: acc.name, dna: acc.dna });
    players.set(p.id, p);
    p.send({ t: 'welcome', id: p.id, token, name: p.name, hour: worldHour(), dayLen: DAY_SECONDS });
    // introduce everyone to everyone
    for (const o of players.values()) if (o !== p) { p.send({ t: 'join', id: o.id, name: o.name, dna: o.dna }); o.send({ t: 'join', id: p.id, name: p.name, dna: p.dna }); }
  },
  dna(p, m) {
    p.dna = sanitizeDNA(m.dna);
    const acc = db.accounts[p.account]; if (acc) { acc.dna = p.dna; dbDirty = true; }
    broadcast({ t: 'look', id: p.id, dna: p.dna }, p);
  },
  // state: {x,y,z,f(facing),sp(speed),st(state),v?:{k(kind),c(color),q:[x,y,z,w]},tp?:1 (teleport request)}
  state(p, m, now) {
    const x = num(m.x, -3000, 3000), y = num(m.y, -50, 500), z = num(m.z, -3000, 3000);
    const mode = m.v ? 'vehicle' : 'foot';
    if (p.s) {
      const dt = Math.max(0.03, (now - p.lastT) / 1000), d = Math.hypot(x - p.s.x, z - p.s.z);
      const allowed = MAX_SPEED[mode] * dt * 1.6 + 1.5;
      if (d > allowed && !(m.tp && d < 40) && p.teleportGrace <= 0) {
        // reject: snap the client back to its last valid position
        p.send({ t: 'correct', x: p.s.x, y: p.s.y, z: p.s.z });
        p.flags = (p.flags || 0) + 1;
        return;
      }
      if (p.teleportGrace > 0) p.teleportGrace--;
    }
    p.lastT = now;
    p.s = { x, y, z, f: num(m.f, -10, 10), sp: num(m.sp, -80, 80), st: clean(m.st, 10), v: m.v ? { k: clean(m.v.k, 16), c: clean(m.v.c, 9), q: (m.v.q || []).slice(0, 4).map((q) => num(q, -1, 1)) } : null, e: clean(m.e, 12) };
  },
  // Respawn / spawn-point moves are server-approved (the next update may jump).
  respawn(p) { p.teleportGrace = 2; },
  chat(p, m) {
    const text = clean(m.text, 160).trim(); if (!text || !p.s) return;
    const r = m.shout ? SHOUT_R : CHAT_R;
    for (const o of players.values()) if (o.s && Math.hypot(o.s.x - p.s.x, o.s.z - p.s.z) < r) o.send({ t: 'chat', id: p.id, name: p.name, text, shout: !!m.shout });
  },
  emote(p, m) { const e = clean(m.e, 12); if (p.s) p.s.e = e; broadcast({ t: 'emote', id: p.id, e }, p, p.s, VIEW_R); },
  shove(p, m) {
    const o = players.get(m.id); if (!o || !o.s || !p.s) return;
    if (Math.hypot(o.s.x - p.s.x, o.s.z - p.s.z) > SHOVE_R || Math.abs(o.s.y - p.s.y) > 1.5) return; // out of reach: ignored
    const dx = o.s.x - p.s.x, dz = o.s.z - p.s.z, l = Math.hypot(dx, dz) || 1, k = m.hard ? 5 : 2.2;
    o.send({ t: 'shoved', by: p.id, vx: (dx / l) * k, vz: (dz / l) * k });
  },
  ping(p, m) { p.send({ t: 'pong', c: m.c }); },
};

function broadcast(msg, except, origin, radius) {
  const s = JSON.stringify(msg);
  for (const o of players.values()) {
    if (o === except || o.ws.readyState !== 1) continue;
    if (origin && radius && o.s && Math.hypot(o.s.x - origin.x, o.s.z - origin.z) > radius) continue;
    o.ws.send(s);
  }
}

// snapshots: each client receives the states of players within its interest radius
setInterval(() => {
  const hour = worldHour(), list = [...players.values()].filter((p) => p.s);
  for (const p of players.values()) {
    if (!p.ok) continue;
    const near = list.filter((o) => o !== p && (!p.s || Math.hypot(o.s.x - p.s.x, o.s.z - p.s.z) < VIEW_R)).map((o) => [o.id, +o.s.x.toFixed(2), +o.s.y.toFixed(2), +o.s.z.toFixed(2), +o.s.f.toFixed(3), +o.s.sp.toFixed(2), o.s.st, o.s.v, o.s.e]);
    p.send({ t: 'snap', ts: Date.now(), hour: +hour.toFixed(4), p: near });
  }
}, TICK);

server.listen(PORT, () => console.log(`Free World server on http://localhost:${PORT} (ws /ws), data in ${DATA}`));
