import * as THREE from 'three';
import { Character } from '../character.js';
import { Vehicle } from '../vehicle.js';
import { buildAvatar, defaultDNA } from '../people/avatar.js';

// ============================================================================
// Multiplayer client. Sends the local player's state at 15 Hz, renders other players
// from server snapshots with a 120 ms interpolation buffer, shows name tags, remote
// vehicles, proximity chat bubbles and emotes, and applies server-arbitrated shoves.
// ============================================================================

const SEND_HZ = 15, DELAY = 120;
const TOKEN = 'fw-token', NAME = 'fw-name';

// Where is the multiplayer backend? (the game never depends on it: null = single-player)
//   1. ?server=host:port | wss://host/ws | off
//   2. fw-config.json next to the page: { "server": "wss://backend.example.com/ws" }
//      (static hosting with a separate backend)
//   3. the page is served by the game server itself (same-origin /health says fw:true)
export async function resolveServer() {
  const q = new URLSearchParams(location.search).get('server');
  if (q === 'off') return null;
  if (q) return q.startsWith('ws') ? q : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${q}/ws`;
  if (!location.protocol.startsWith('http')) return null; // file:// offline build
  const get = async (u) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 2500); try { const r = await fetch(u, { signal: c.signal, cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } finally { clearTimeout(t); } };
  const cfg = await get('fw-config.json');
  if (cfg) window.__fwConfig = cfg; // e.g. { server, iceServers: [{urls, username, credential}] }
  if (cfg?.server) return cfg.server;
  const h = await get('health');
  if (h?.fw) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  return null;
}

function nameTag(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(128 - w / 2, 12, w, 40, 10); g.fill();
  g.fillStyle = '#fff'; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.2, 0.3, 1); s.renderOrder = 10;
  return s;
}

export class Net {
  constructor(url, { game, player, dna, getLocal, onChat, onShoved, onStatus, onHour }) {
    Object.assign(this, { url, game, player, dna, getLocal, onChat, onShoved, onStatus, onHour });
    this.remotes = new Map();
    this.sendT = 0; this.connected = false; this.id = null; this.rtt = null;
    this.offset = 0; // server clock - local clock
    this.connect();
  }

  connect() {
    this.onStatus?.('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: localStorage.getItem(TOKEN), name: localStorage.getItem(NAME), dna: this.dna }));
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      this.connected = false; this.onStatus?.('offline — retrying');
      for (const id of [...this.remotes.keys()]) this.remove(id);
      if (this.voice) for (const id of [...this.voice.peers.keys()]) this.voice.closePeer(id);
      setTimeout(() => this.connect(), 3000);
    };
    ws.onerror = () => {};
  }
  send(m) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.connected = true; this.id = m.id; this.name = m.name;
        localStorage.setItem(TOKEN, m.token);
        this.onStatus?.(`online as ${m.name}`); this.onHour?.(m.hour);
        if (this.voice?.stream) this.send({ t: 'voice', on: true, muted: this.voice.state === 'muted' }); // re-announce after reconnect
        clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
        break;
      case 'join': this.ensure(m.id, m.name, m.dna); break;
      case 'leave': this.remove(m.id); break;
      case 'look': { const r = this.remotes.get(m.id); if (r) { r.dna = m.dna; r.char.setModel(buildAvatar({ ...defaultDNA(), ...(m.dna || {}) })); } break; }
      case 'snap': {
        const now = performance.now();
        this.onHour?.(m.hour);
        for (const [id, x, y, z, f, sp, st, v, e] of m.p) {
          const r = this.remotes.get(id) || this.ensure(id, `Player ${id}`, null);
          r.buf.push({ t: now, x, y, z, f, sp, st, v, e });
          if (r.buf.length > 20) r.buf.shift();
          r.seen = now;
        }
        break;
      }
      case 'chat': this.onChat?.(m); this.bubble(m.id, m.text); break;
      case 'emote': { const r = this.remotes.get(m.id); if (r) r.emote = { e: m.e, t: 2.5 }; break; }
      case 'shoved': this.onShoved?.(m); break;
      case 'correct': this.player.body.setTranslation({ x: m.x, y: m.y + this.player.halfH + this.player.radius + 0.1, z: m.z }, true); break;
      case 'pong': this.rtt = performance.now() - m.c; break;
      case 'rtc': this.voice?.onSignal(m); break;
      case 'voicestate': this.voice?.onVoiceState(m); break;
    }
  }

  ensure(id, name, dna) {
    if (id === this.id) return null;
    let r = this.remotes.get(id);
    if (r) { if (name) { r.name = name; } return r; }
    const asset = buildAvatar({ ...defaultDNA(), ...(dna || {}) });
    const char = new Character(this.game, asset, new THREE.Vector3(0, -100, 0), {});
    char.remote = true;
    const tag = nameTag(name || `Player ${id}`); char.root.add(tag); tag.position.y = 2.05;
    r = { id, name, dna, char, tag, buf: [], seen: performance.now(), vehicle: null };
    this.remotes.set(id, r);
    return r;
  }

  remove(id) {
    const r = this.remotes.get(id); if (!r) return;
    if (r.vehicle) this.dropVehicle(r);
    this.voice?.closePeer(id); this.voice?.remoteVoice.delete(id);
    r.char.dispose();
    this.remotes.delete(id);
    this.onLeave?.(id);
  }

  dropVehicle(r) {
    const v = r.vehicle; r.vehicle = null;
    v.dispose();
  }

  bubble(id, text) {
    const r = id === this.id ? null : this.remotes.get(id);
    if (!r) return;
    if (r.bubble) r.char.root.remove(r.bubble);
    r.bubble = nameTag(text.length > 28 ? text.slice(0, 27) + '…' : text); r.bubble.position.y = 2.4; r.bubble.scale.set(1.8, 0.45, 1);
    r.char.root.add(r.bubble); r.bubbleT = 5;
  }

  // nearest remote player within reach (for shoves)
  nearestRemote(pos, reach = 1.8) {
    let best = null, bd = reach;
    for (const r of this.remotes.values()) { if (r.vehicle) continue; const d = r.char.position.distanceTo(pos); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  update(dt) {
    const now = performance.now();
    // ---- send local state
    // paced by wall-clock time: the server validates motion against real elapsed time
    if (this.connected && now - (this.lastSend || 0) >= 1000 / SEND_HZ) { this.lastSend = now; const s = this.getLocal(); if (s) this.send({ t: 'state', ...s }); }
    // ---- interpolate remotes
    const rt = now - DELAY;
    for (const r of this.remotes.values()) {
      if (now - r.seen > 5000) { r.char.root.visible = false; continue; }
      const b = r.buf; if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
      const k = c.t > a.t ? THREE.MathUtils.clamp((rt - a.t) / (c.t - a.t), 0, 1) : 1;
      const x = a.x + (c.x - a.x) * k, y = a.y + (c.y - a.y) * k, z = a.z + (c.z - a.z) * k;
      let df = c.f - a.f; df = Math.atan2(Math.sin(df), Math.cos(df));
      const ch = r.char;
      if (c.v) {
        // remote driver: kinematic ghost of the same vehicle type
        if (!r.vehicle || r.vehicle.type !== c.v.k) {
          if (r.vehicle) this.dropVehicle(r);
          try { r.vehicle = new Vehicle(this.game, c.v.k, new THREE.Vector3(x, y, z), 0, c.v.c || '#555'); r.vehicle.setRemote(); } catch { r.vehicle = null; }
        }
        if (r.vehicle) {
          const qa = new THREE.Quaternion(...(a.v?.q || c.v.q)), qc = new THREE.Quaternion(...c.v.q);
          qa.slerp(qc, k);
          r.vehicle.body.setNextKinematicTranslation({ x, y, z }); r.vehicle.body.setNextKinematicRotation(qa);
          r.vehicle.remoteSpeed = a.sp + (c.sp - a.sp) * k;
          r.vehicle.sync(dt);
        }
        ch.root.visible = false; ch.visible = false;
        ch.body.setNextKinematicTranslation({ x, y: y - 50, z });
      } else {
        if (r.vehicle) this.dropVehicle(r);
        ch.visible = true;
        // mirror knockdowns: the remote body ragdolls locally from the sender's motion
        if (c.st === 'ragdoll' && ch.state !== 'ragdoll') { const v = new THREE.Vector3(c.x - a.x, 0.4, c.z - a.z).multiplyScalar(c.t > a.t ? 1000 / (c.t - a.t) : 1); ch.goRagdoll(v.clampLength(0, 8)); }
        if (ch.state === 'ragdoll') { if (c.st !== 'ragdoll') { ch.getUp(); ch.state = 'loco'; } else { ch.sync(dt); continue; } }
        ch.body.setNextKinematicTranslation({ x, y: y + ch.halfH + ch.radius + ch.skin * 0.9, z });
        ch.facing = a.f + df * k; ch.speed = Math.abs(a.sp + (c.sp - a.sp) * k); ch.grounded = true;
        ch.sync(dt);
      }
      if (r.bubble && (r.bubbleT -= dt) <= 0) { ch.root.remove(r.bubble); r.bubble = null; }
      // speaking indicator: the name tag lights up green while this player's voice is heard
      const talking = !!this.voice?.peers.get(r.id)?.speaking;
      if (talking !== r.talking) { r.talking = talking; r.tag.material.color.set(talking ? '#7dffa0' : '#ffffff'); r.tag.scale.set(talking ? 1.35 : 1.2, talking ? 0.34 : 0.3, 1); }
      if (r.emote) { r.emote.t -= dt; this.animateEmote(ch, r.emote); if (r.emote.t <= 0) r.emote = null; }
    }
  }

  // simple procedural emotes on top of locomotion (wave / point / cheer)
  animateEmote(ch, em) {
    const arm = ch.bones.rightarm, fore = ch.bones.rightforearm, t = 2.5 - em.t;
    if (!arm || !fore) return;
    if (em.e === 'wave') { arm.rotation.set(0, 0, -2.4); fore.rotation.set(0, 0, -0.4 + Math.sin(t * 10) * 0.45); }
    else if (em.e === 'cheer') { arm.rotation.set(0, 0, -2.8); fore.rotation.set(0, 0, 0); const l = ch.bones.leftarm; if (l) l.rotation.set(0, 0, 2.8); }
    else if (em.e === 'point') { arm.rotation.set(-1.4, 0, -0.1); fore.rotation.set(0, 0, 0); }
  }
}
