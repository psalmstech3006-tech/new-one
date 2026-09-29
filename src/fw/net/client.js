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

export function serverURL() {
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q.startsWith('ws') ? q : `ws://${q}/ws`;
  if (location.protocol.startsWith('http') && location.port === '8787') return `ws://${location.host}/ws`;
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
        setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
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
    this.game.scene.remove(r.char.root);
    this.game.physics.world.removeRigidBody(r.char.body);
    if (r.vehicle) this.dropVehicle(r);
    this.remotes.delete(id);
  }

  dropVehicle(r) {
    const v = r.vehicle; r.vehicle = null;
    this.game.scene.remove(v.mesh); this.game.physics.world.removeRigidBody(v.body);
    v.dead = true;
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
    this.sendT -= dt;
    if (this.connected && this.sendT <= 0) { this.sendT = 1 / SEND_HZ; const s = this.getLocal(); if (s) this.send({ t: 'state', ...s }); }
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
        ch.body.setNextKinematicTranslation({ x, y: y + ch.halfH + ch.radius + ch.skin * 0.9, z });
        ch.facing = a.f + df * k; ch.speed = Math.abs(a.sp + (c.sp - a.sp) * k); ch.grounded = true;
        ch.sync(dt);
      }
      if (r.bubble && (r.bubbleT -= dt) <= 0) { ch.root.remove(r.bubble); r.bubble = null; }
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
