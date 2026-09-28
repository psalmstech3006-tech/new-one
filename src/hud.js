import { GRID, HALF, CELL, ROAD, WORLD_EDGE, roadCenter, PLACES } from './world.js';

const $ = (id) => document.getElementById(id);

// Weapon icons drawn as simple original silhouettes.
const ICONS = {
  fist: '<svg viewBox="0 0 64 32"><path d="M22 6h16a4 4 0 0 1 4 4v4h4a4 4 0 0 1 0 8H26l-6-4V10a4 4 0 0 1 2-4z" fill="#fff"/></svg>',
  pistol: '<svg viewBox="0 0 64 32"><path d="M6 8h46v8H26l-3 12h-8l3-12H6z" fill="#fff"/><rect x="52" y="9" width="6" height="4" fill="#fff"/></svg>',
  smg: '<svg viewBox="0 0 64 32"><path d="M2 8h50v8H38v12h-6V16h-8l-2 10h-7l2-10H2z" fill="#fff"/><rect x="52" y="10" width="10" height="3" fill="#fff"/><rect x="28" y="16" width="4" height="10" fill="#fff"/></svg>',
  shotgun: '<svg viewBox="0 0 64 32"><path d="M2 10h58v5H24l-4 3h-6l-2 8H4l3-10H2z" fill="#fff"/></svg>',
};

export class HUD {
  constructor() {
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.bigMap = $('bigmap');
    this.bigCtx = this.bigMap.getContext('2d');
    this.msgTimer = 0;
    this.subTimer = 0;
    this.lastMoney = -1;
    this.moneyDelta = 0;
    this.moneyTimer = 0;
    this.roadsCanvas = this.renderRoads(512);
  }

  // Pre-render a top-down map of the city used by both maps.
  renderRoads(size) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    const s = size / (WORLD_EDGE * 2);
    const tx = (v) => (v + WORLD_EDGE) * s;
    g.fillStyle = '#2c5870'; g.fillRect(0, 0, size, size); // ocean
    g.fillStyle = '#c9b98a'; g.fillRect(tx(-WORLD_EDGE + 4), tx(-WORLD_EDGE + 4), (WORLD_EDGE * 2 - 8) * s, (WORLD_EDGE * 2 - 8) * s);
    g.fillStyle = '#5d7a4e'; g.fillRect(tx(-WORLD_EDGE + 10), tx(-WORLD_EDGE + 10), (WORLD_EDGE * 2 - 20) * s, (WORLD_EDGE * 2 - 20) * s);
    g.fillStyle = '#3d4247'; g.fillRect(tx(-HALF - ROAD / 2), tx(-HALF - ROAD / 2), (HALF * 2 + ROAD) * s, (HALF * 2 + ROAD) * s);
    g.fillStyle = '#9ea3a8';
    for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
      g.fillRect(tx(roadCenter(bx) + ROAD / 2), tx(roadCenter(bz) + ROAD / 2), (CELL - ROAD) * s, (CELL - ROAD) * s);
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
    for (let i = 0; i <= GRID; i++) { const p = tx(roadCenter(i)); g.beginPath(); g.moveTo(p, tx(-HALF)); g.lineTo(p, tx(HALF)); g.moveTo(tx(-HALF), p); g.lineTo(tx(HALF), p); g.stroke(); }
    this.mapScale = s;
    return c;
  }

  setVisible(v) { $('hud').classList.toggle('hidden', !v); }

  message(text, secs = 3) { const el = $('help'); el.innerHTML = text; el.classList.add('show'); this.msgTimer = secs; }
  subtitle(text, secs = 4) { const el = $('subtitle'); el.innerHTML = text; el.classList.add('show'); this.subTimer = secs; }
  bigText(title, sub = '', cls = '') {
    const el = $('bigtext'); el.className = 'show ' + cls;
    el.querySelector('h1').textContent = title; el.querySelector('p').textContent = sub;
  }
  hideBig() { $('bigtext').className = ''; }
  missionTimer(t) {
    const el = $('mtimer');
    if (t == null) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  }
  objective(text) { const el = $('objective'); el.innerHTML = text || ''; el.style.display = text ? 'block' : 'none'; }

  update(dt, g) {
    const p = g.player;
    if (this.msgTimer > 0 && (this.msgTimer -= dt) <= 0) $('help').classList.remove('show');
    if (this.subTimer > 0 && (this.subTimer -= dt) <= 0) $('subtitle').classList.remove('show');
    $('hp').style.width = Math.max(0, p.health) + '%';
    $('hp').classList.toggle('low', p.health < 25);
    $('armor').style.width = p.armor + '%';
    // cash with change indicator
    if (this.lastMoney !== g.money) {
      if (this.lastMoney >= 0) { this.moneyDelta += g.money - this.lastMoney; this.moneyTimer = 3; }
      this.lastMoney = g.money;
      $('money').textContent = '$' + g.money.toLocaleString();
    }
    const d = $('moneydelta');
    if (this.moneyTimer > 0) {
      this.moneyTimer -= dt;
      d.textContent = (this.moneyDelta >= 0 ? '+$' : '-$') + Math.abs(this.moneyDelta).toLocaleString();
      d.className = this.moneyDelta >= 0 ? 'show up' : 'show down';
    } else { d.className = ''; this.moneyDelta = 0; }
    // wanted stars (flash while evading)
    const stars = $('stars').children;
    const flash = g.police.evading && Math.floor(performance.now() / 300) % 2;
    for (let i = 0; i < 5; i++) {
      stars[i].className = i < g.police.level ? (flash ? 'star on dim' : 'star on') : 'star';
    }
    // weapon
    const w = p.weapon;
    if (this._weapon !== w.id) { this._weapon = w.id; $('wicon').innerHTML = ICONS[w.id]; $('wname').textContent = w.name; }
    $('ammo').textContent = w.id === 'fist' ? '' : `${w.mag}  |  ${w.reserve}`;
    // vehicle / speed
    const v = p.vehicle;
    $('vehicle').style.display = v ? 'block' : 'none';
    if (v) { $('speed').textContent = Math.round(Math.abs(v.speed) * 2.237); $('vname').textContent = v.spec.name; }
    // clock + area
    const h = Math.floor(g.time), m = Math.floor((g.time % 1) * 60);
    $('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    $('crosshair').style.display = !v && p.weapon.id !== 'fist' && !g.firstPerson ? 'block' : (g.firstPerson && !v ? 'block' : 'none');
    $('crosshair').classList.toggle('aim', p.aiming);
    this.drawMinimap(g);
  }

  drawMinimap(g) {
    const c = this.mmCtx, W = this.mm.width, H = this.mm.height;
    const pos = g.player.position, s = this.mapScale;
    const zoom = g.player.vehicle ? 1.6 + Math.min(1.4, Math.abs(g.player.vehicle.speed) / 25) : 2.2; // map px per canvas px
    const heading = g.cameraYaw;
    c.save();
    c.clearRect(0, 0, W, H);
    c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 3, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#2c5870'; c.fillRect(0, 0, W, H);
    c.translate(W / 2, H / 2);
    c.rotate(heading + Math.PI);
    const k = 1 / zoom * (W / 120);
    c.scale(k, k);
    c.translate(-(pos.x + WORLD_EDGE) * s, -(pos.z + WORLD_EDGE) * s);
    c.drawImage(this.roadsCanvas, 0, 0);
    const blip = (x, z, color, r = 3.5, shape = 'dot') => {
      const bx = (x + WORLD_EDGE) * s, bz = (z + WORLD_EDGE) * s;
      c.fillStyle = color; c.strokeStyle = '#000'; c.lineWidth = 0.8 / k * 2;
      c.beginPath();
      if (shape === 'sq') c.rect(bx - r, bz - r, r * 2, r * 2); else c.arc(bx, bz, r / k * 1.4, 0, Math.PI * 2);
      c.fill(); c.stroke();
    };
    for (const b of g.blips()) blip(b.x, b.z, b.color, b.r || 3.5);
    // GPS line to the objective
    if (g.gps) {
      c.strokeStyle = '#d4a017'; c.lineWidth = 3 / k * 2; c.beginPath();
      c.moveTo((pos.x + WORLD_EDGE) * s, (pos.z + WORLD_EDGE) * s);
      for (const p of g.gps) c.lineTo((p.x + WORLD_EDGE) * s, (p.z + WORLD_EDGE) * s);
      c.stroke();
    }
    c.restore();
    // police heat ring
    if (g.police.level > 0) {
      const t = performance.now() / 250;
      c.strokeStyle = Math.sin(t) > 0 ? 'rgba(255,40,40,0.8)' : 'rgba(40,90,255,0.8)';
      c.lineWidth = 5; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 5, 0, Math.PI * 2); c.stroke();
    }
    // player arrow (always points up; map rotates)
    const pa = g.player.facing - heading;
    c.save(); c.translate(W / 2, H / 2); c.rotate(-pa);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 3); c.lineTo(-6, 7); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // north marker
    c.save(); c.translate(W / 2, H / 2); c.rotate(heading + Math.PI);
    c.fillStyle = '#fff'; c.font = 'bold 12px Oswald, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', 0, -(W / 2 - 14));
    c.restore();
  }

  drawBigMap(g) {
    const c = this.bigCtx, W = this.bigMap.width = this.bigMap.clientWidth * devicePixelRatio, H = this.bigMap.height = this.bigMap.clientHeight * devicePixelRatio;
    const size = Math.min(W, H) * 0.95, ox = (W - size) / 2, oy = (H - size) / 2;
    c.fillStyle = '#1e3f52'; c.fillRect(0, 0, W, H);
    c.drawImage(this.roadsCanvas, ox, oy, size, size);
    const tx = (x) => ox + (x + WORLD_EDGE) / (WORLD_EDGE * 2) * size;
    const ty = (z) => oy + (z + WORLD_EDGE) / (WORLD_EDGE * 2) * size;
    const label = (x, z, t, color) => {
      c.fillStyle = color; c.beginPath(); c.arc(tx(x), ty(z), 7 * devicePixelRatio, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke();
      c.fillStyle = '#fff'; c.font = `${12 * devicePixelRatio}px Oswald, sans-serif`; c.fillText(t, tx(x) + 10 * devicePixelRatio, ty(z) + 4 * devicePixelRatio);
    };
    label(PLACES.hospital.x, PLACES.hospital.z, 'Hospital', '#e84d4d');
    label(PLACES.police.x, PLACES.police.z, 'Police', '#3d6bff');
    label(PLACES.garage.x, PLACES.garage.z, "Rusty's Garage", '#e08b2d');
    label(PLACES.home.x, PLACES.home.z, 'Safehouse', '#4fbf6a');
    for (const b of g.blips()) if (b.mission) label(b.x, b.z, b.label || '', b.color);
    const p = g.player.position;
    c.save(); c.translate(tx(p.x), ty(p.z)); c.rotate(-g.player.facing + Math.PI);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(0, 4); c.lineTo(-8, 9); c.closePath(); c.fill(); c.strokeStyle = '#000'; c.stroke();
    c.restore();
  }
}
