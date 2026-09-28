import * as THREE from 'three';
import { World, GRID, CELL, ROAD, HALF, LANE, roadCenter, resolveCircle, groundY, blockAt, nearbyColliders, colliders, PLACES, nearestRoadIndex, isOnRoad } from './world.js';
import { makeHumanoid, animateHumanoid } from './characters.js';
import { Vehicle, CIVILIAN_TYPES, collideVehicles } from './vehicles.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { Missions } from './missions.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const nodePos = (i, j) => V(roadCenter(i), 0, roadCenter(j));

export const WEAPONS = {
  fist:    { id: 'fist', name: 'Unarmed', dmg: 25, rate: 0.4, magSize: 0, range: 1.9, auto: false },
  pistol:  { id: 'pistol', name: 'Pistol', dmg: 34, rate: 0.22, magSize: 12, range: 120, spread: 0.01, auto: false },
  smg:     { id: 'smg', name: 'SMG', dmg: 20, rate: 0.085, magSize: 30, range: 100, spread: 0.035, auto: true },
  shotgun: { id: 'shotgun', name: 'Pump Shotgun', dmg: 14, pellets: 8, rate: 0.9, magSize: 6, range: 40, spread: 0.08, auto: false },
};
const newWeapon = (id, reserve = 0) => ({ ...WEAPONS[id], mag: WEAPONS[id].magSize, reserve });

// Heat score thresholds for 1..5 stars
const HEAT = [1, 5, 12, 22, 35];

class Ped {
  constructor(game, pos, look = {}, opts = {}) {
    this.game = game;
    this.mesh = makeHumanoid(look);
    this.pos = pos.clone();
    this.facing = Math.random() * Math.PI * 2;
    this.speed = 0;
    this.phase = Math.random() * 6;
    this.health = opts.health || 100;
    this.state = 'walk';
    this.cop = !!opts.cop;
    this.fleeT = 0;
    this.deadT = 0;
    this.shootT = 1 + Math.random();
    this.persistent = !!opts.persistent;
    this.anim = { speed: 0, phase: 0 };
    game.scene.add(this.mesh);
    this.pickWalkTarget();
  }
  get alive() { return this.state !== 'dead'; }

  pickWalkTarget() {
    let b = blockAt(this.pos.x, this.pos.z);
    if (!b) {
      // stepped onto a road: head for the nearest block corner
      const bx = Math.max(0, Math.min(GRID - 1, Math.floor((this.pos.x + HALF) / CELL)));
      const bz = Math.max(0, Math.min(GRID - 1, Math.floor((this.pos.z + HALF) / CELL)));
      const x0 = roadCenter(bx) + ROAD / 2, z0 = roadCenter(bz) + ROAD / 2;
      b = { bx, bz, x0, z0, x1: x0 + CELL - ROAD, z1: z0 + CELL - ROAD };
    }
    this.block = b;
    const c = this.corners(b);
    let best = 0, bd = Infinity;
    c.forEach((p, i) => { const d = p.distanceToSquared(this.pos); if (d < bd) { bd = d; best = i; } });
    this.corner = best;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.target = c[best];
  }
  corners(b) {
    const i = 1.6;
    return [V(b.x0 + i, 0, b.z0 + i), V(b.x1 - i, 0, b.z0 + i), V(b.x1 - i, 0, b.z1 - i), V(b.x0 + i, 0, b.z1 - i)];
  }
  nextCorner() {
    const b = this.block;
    // occasionally cross the street at a corner
    if (Math.random() < 0.25) {
      const k = this.corner;
      const cross = Math.random() < 0.5
        ? (k === 0 || k === 3 ? [b.bx - 1, b.bz, k === 0 ? 1 : 2] : [b.bx + 1, b.bz, k === 1 ? 0 : 3])
        : (k === 0 || k === 1 ? [b.bx, b.bz - 1, k === 0 ? 3 : 2] : [b.bx, b.bz + 1, k === 2 ? 1 : 0]);
      if (cross[0] >= 0 && cross[1] >= 0 && cross[0] < GRID && cross[1] < GRID) {
        const x0 = roadCenter(cross[0]) + ROAD / 2, z0 = roadCenter(cross[1]) + ROAD / 2;
        this.block = { bx: cross[0], bz: cross[1], x0, z0, x1: x0 + CELL - ROAD, z1: z0 + CELL - ROAD };
        this.corner = cross[2];
        this.target = this.corners(this.block)[this.corner];
        return;
      }
    }
    this.corner = (this.corner + this.dir + 4) % 4;
    this.target = this.corners(this.block)[this.corner];
  }

  hurt(amount, from, byPlayer = true) {
    if (!this.alive) return;
    this.health -= amount;
    this.game.effects.blood(this.pos.clone().add(V(0, 1.2, 0)));
    if (this.health <= 0) {
      this.state = 'dead';
      this.deadT = 0;
      if (from) this.facing = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      if (byPlayer) {
        this.game.addHeat(this.cop ? 5 : 2);
        if (Math.random() < 0.7) this.game.spawnPickup('cash', this.pos.clone().add(V(0.8, 0, 0)), { amount: 5 + Math.floor(Math.random() * (this.cop ? 60 : 40)), temp: true });
      }
      return;
    }
    if (!this.cop) this.flee(from || this.game.player.position);
    else if (byPlayer) this.game.addHeat(2);
  }
  flee(from) {
    if (!this.alive || this.cop) return;
    this.state = 'flee'; this.fleeT = 6 + Math.random() * 4; this.fleeFrom = from.clone();
  }

  update(dt) {
    const g = this.game;
    if (!this.alive) {
      this.deadT += dt;
      animateHumanoid(this.mesh, { dead: true, deadT: this.deadT }, dt);
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.facing;
      return;
    }
    let move = null, spd = 0;
    if (this.state === 'walk') {
      const d = V(this.target.x - this.pos.x, 0, this.target.z - this.pos.z);
      if (d.length() < 0.6) this.nextCorner();
      move = d.normalize(); spd = 1.3;
      // wait at the kerb if traffic is coming
      if (!blockAt(this.pos.x + move.x * 1.5, this.pos.z + move.z * 1.5) && blockAt(this.pos.x, this.pos.z)) {
        for (const v of g.vehicles) if (Math.abs(v.speed) > 3 && v.pos.distanceToSquared(this.pos) < 400) { spd = 0; break; }
      }
    } else if (this.state === 'flee') {
      this.fleeT -= dt;
      move = V(this.pos.x - this.fleeFrom.x, 0, this.pos.z - this.fleeFrom.z).normalize();
      move.applyAxisAngle(V(0, 1, 0), Math.sin(this.phase * 0.3) * 0.4);
      spd = 5.5;
      if (this.fleeT <= 0) { this.state = 'walk'; this.pickWalkTarget(); }
    } else if (this.state === 'cop') {
      const pp = g.player.position;
      const d = V(pp.x - this.pos.x, 0, pp.z - this.pos.z);
      const dist = d.length();
      if (g.police.level === 0) { move = d.normalize().negate(); spd = 1.5; }
      else if (g.police.level === 1 || dist > 12) { move = d.normalize(); spd = dist > 2 ? 5 : 0; }
      else { move = d.normalize(); spd = 0; }
      this.aiming = g.police.level >= 2 && dist < 45;
      if (this.aiming) {
        this.shootT -= dt;
        if (this.shootT <= 0) { this.shootT = 0.7 + Math.random() * 0.9; g.copShoot(this); }
      }
    }
    if (move) {
      if (spd > 0) {
        const tf = Math.atan2(move.x, move.z);
        this.facing += wrap(tf - this.facing) * Math.min(1, dt * 8);
      } else if (this.cop && g.police.level > 0) this.facing = Math.atan2(g.player.position.x - this.pos.x, g.player.position.z - this.pos.z);
      this.pos.x += Math.sin(this.facing) * spd * dt;
      this.pos.z += Math.cos(this.facing) * spd * dt;
    }
    if (resolveCircle(this.pos, 0.35, 0.5) && this.state === 'walk') this.nextCorner();
    this.pos.y = groundY(this.pos.x, this.pos.z);
    this.speed = spd;
    this.phase += spd * dt * 2.4;
    animateHumanoid(this.mesh, { speed: spd, phase: this.phase, armed: this.cop, aiming: this.aiming, handsUp: this.state === 'flee' && spd === 0 }, dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;
  }
  dispose() { this.game.scene.remove(this.mesh); }
}

export class Game {
  constructor(renderer, textures, settings, audio, input) {
    this.renderer = renderer;
    this.settings = settings;
    this.audio = audio;
    this.input = input;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.2, 2500);
    this.scene.add(this.camera);
    this.world = new World(this.scene, textures, settings.quality);
    this.effects = new Effects(this.scene);
    this.hud = new HUD();
    this.vehicles = [];
    this.peds = [];
    this.pickups = [];
    this.time = 17.5;
    this.money = 0;
    this.cameraYaw = Math.PI;
    this.cameraPitch = -0.15;
    this.camLookTimer = 0;
    this.firstPerson = false;
    this.paused = false;
    this.gps = null;
    this.police = { level: 0, score: 0, lastSeen: 0, evading: false, spawnT: 0 };
    this.stats = { kills: 0, cars: 0, distance: 0 };
    this.createPlayer();
    this.spawnInitial();
    this.missions = new Missions(this);
    this.fpGun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.4), new THREE.MeshStandardMaterial({ color: '#1c1c1c', metalness: 0.6, roughness: 0.4 }));
    this.fpGun.position.set(0.18, -0.18, -0.45);
    this.camera.add(this.fpGun);
    this.cameraSmooth = this.player.position.clone();
  }

  createPlayer() {
    // Rae Vance — the protagonist: getaway driver in a worn leather jacket.
    const look = { skin: '#d9a47c', hair: '#2a1a12', longHair: true, top: '#e8e2d6', jacket: '#6b4228', bottom: '#2e3f5c', shoes: '#3a2a1e', shades: true };
    const mesh = makeHumanoid(look);
    this.scene.add(mesh);
    this.player = {
      mesh, position: PLACES.home.clone(), velY: 0, facing: Math.PI, health: 100, armor: 0, vehicle: null,
      weapons: [newWeapon('fist'), newWeapon('pistol', 48)], wi: 1, cooldown: 0, reloadT: 0, phase: 0, speed: 0,
      aiming: false, punchT: 0, arrestT: 0, lastShot: 99, invuln: 0, grounded: true,
      get weapon() { return this.weapons[this.wi]; },
    };
  }

  // ---------------------------------------------------------------- spawning
  randomLanePoint(minD, maxD) {
    const p = this.player.position;
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(Math.random() * (GRID + 1)), j = Math.floor(Math.random() * GRID);
      const horizontal = Math.random() < 0.5;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const t = 0.2 + Math.random() * 0.6;
      const a = horizontal ? { i: j, j: i } : { i, j };
      const b = horizontal ? { i: j + 1, j: i } : { i, j: j + 1 };
      const [from, to] = dir > 0 ? [a, b] : [b, a];
      const pos = nodePos(from.i, from.j).lerp(nodePos(to.i, to.j), t);
      const d = pos.distanceTo(p);
      if (d < minD || d > maxD) continue;
      const fwd = nodePos(to.i, to.j).sub(nodePos(from.i, from.j)).normalize();
      pos.add(V(-fwd.z, 0, fwd.x).multiplyScalar(-LANE)); // drive on the right
      return { pos, from, to, heading: Math.atan2(fwd.x, fwd.z) };
    }
    return null;
  }

  spawnTraffic(minD = 60, maxD = 170, type) {
    const s = this.randomLanePoint(minD, maxD);
    if (!s) return null;
    if (this.vehicles.some((v) => v.pos.distanceToSquared(s.pos) < 100)) return null;
    const v = new Vehicle(this.scene, type || CIVILIAN_TYPES[Math.floor(Math.random() * CIVILIAN_TYPES.length)], s.pos, s.heading);
    v.driver = { look: {} };
    v.ai = { mode: 'traffic', from: s.from, to: s.to, wps: [], cruise: 9 + Math.random() * 4, stuck: 0, reverseT: 0 };
    this.planSegment(v);
    v.vel.copy(v.forward).multiplyScalar(v.ai.cruise * 0.8);
    this.vehicles.push(v);
    return v;
  }

  // Lane waypoints for the segment from ai.from to ai.to
  planSegment(v) {
    const a = nodePos(v.ai.from.i, v.ai.from.j), b = nodePos(v.ai.to.i, v.ai.to.j);
    const f = b.clone().sub(a).normalize(), r = V(-f.z, 0, f.x);
    const off = r.clone().multiplyScalar(-LANE);
    v.ai.wps.push(b.clone().addScaledVector(f, -ROAD / 2 - 1).add(off));
  }
  nextSegment(v) {
    const { from, to } = v.ai;
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([di, dj]) => ({ i: to.i + di, j: to.j + dj }))
      .filter((n) => n.i >= 0 && n.j >= 0 && n.i <= GRID && n.j <= GRID && !(n.i === from.i && n.j === from.j));
    const next = opts[Math.floor(Math.random() * opts.length)] || from;
    // entry point on the new segment, then its exit
    const a = nodePos(to.i, to.j), b = nodePos(next.i, next.j);
    const f = b.clone().sub(a).normalize(), r = V(-f.z, 0, f.x);
    v.ai.wps.push(a.clone().addScaledVector(f, ROAD / 2 + 1).addScaledVector(r, LANE));
    v.ai.from = to; v.ai.to = next;
    this.planSegment(v);
  }

  spawnPed(minD = 30, maxD = 120) {
    const p = this.player.position;
    for (let t = 0; t < 20; t++) {
      const bx = Math.floor(Math.random() * GRID), bz = Math.floor(Math.random() * GRID);
      const x0 = roadCenter(bx) + ROAD / 2, z0 = roadCenter(bz) + ROAD / 2, w = CELL - ROAD;
      const side = Math.floor(Math.random() * 4), a = 2 + Math.random() * (w - 4);
      const pos = side === 0 ? V(x0 + 1.6, 0.2, z0 + a) : side === 1 ? V(x0 + w - 1.6, 0.2, z0 + a) : side === 2 ? V(x0 + a, 0.2, z0 + 1.6) : V(x0 + a, 0.2, z0 + w - 1.6);
      const d = pos.distanceTo(p);
      if (d < minD || d > maxD) continue;
      const ped = new Ped(this, pos);
      this.peds.push(ped);
      return ped;
    }
    return null;
  }

  spawnInitial() {
    const q = this.settings.quality;
    this.maxPeds = q === 'low' ? 18 : q === 'medium' ? 30 : 42;
    this.maxTraffic = q === 'low' ? 14 : q === 'medium' ? 22 : 30;
    for (let i = 0; i < this.maxPeds; i++) this.spawnPed(5, 150);
    for (let i = 0; i < this.maxTraffic; i++) this.spawnTraffic(15, 200);
    // parked cars around the safehouse
    const h = PLACES.home;
    const parked = [['muscle', V(h.x - 6, 0, h.z - 6), 0, '#e8dcc0'], ['sedan', V(h.x - 6, 0, h.z + 4), 0], ['sports', V(roadCenter(5) + 5.5, 0, roadCenter(4) + 30), Math.PI]];
    for (const [t, p, hd, c] of parked) { const v = new Vehicle(this.scene, t, p, hd, c); v.persistent = true; this.vehicles.push(v); }
    // fixed pickups
    const spots = [];
    for (let bx = 0; bx < GRID; bx += 2) for (let bz = 1; bz < GRID; bz += 2) spots.push(V(roadCenter(bx) + ROAD / 2 + 1.8, 0.2, roadCenter(bz) + CELL / 2));
    spots.forEach((p, i) => this.spawnPickup(['health', 'armor', 'pistolAmmo', 'cash', 'health', 'smg', 'cash', 'shotgun'][i % 8], p, { amount: 100 + Math.floor(Math.random() * 200), respawn: 60 }));
  }

  spawnPickup(kind, pos, opts = {}) {
    const g = new THREE.Group();
    const mat = (c, e) => new THREE.MeshStandardMaterial({ color: c, emissive: e || c, emissiveIntensity: 0.35 });
    if (kind === 'cash') { for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.25), mat('#3fae5a')); b.position.y = i * 0.09; b.rotation.y = i * 0.3; g.add(b); } }
    else if (kind === 'health') { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.3), mat('#f4f4f4', '#888'))); const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.02), mat('#2ecc71')); p1.position.z = 0.16; const p2 = p1.clone(); p2.rotation.z = Math.PI / 2; g.add(p1, p2); }
    else if (kind === 'armor') { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.18), mat('#2f5fbf'))); }
    else { const b = new THREE.Mesh(new THREE.BoxGeometry(kind === 'pistolAmmo' ? 0.3 : 0.8, 0.14, 0.12), mat(kind === 'pistolAmmo' ? '#c9a13b' : '#444', '#222')); g.add(b); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 6, 24), new THREE.MeshBasicMaterial({ color: kind === 'cash' ? '#6fe38a' : kind === 'health' ? '#ffffff' : kind === 'armor' ? '#6f9cff' : '#ffd36b', transparent: true, opacity: 0.6 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.4;
    g.add(ring);
    g.position.copy(pos).add(V(0, 0.8, 0));
    this.scene.add(g);
    const pk = { kind, pos: pos.clone(), mesh: g, amount: opts.amount || 0, temp: !!opts.temp, respawn: opts.respawn || 0, hidden: 0, life: opts.temp ? 30 : Infinity };
    this.pickups.push(pk);
    return pk;
  }

  // ---------------------------------------------------------------- crime / police
  addHeat(points) {
    const p = this.police;
    p.score += points;
    let lvl = 0;
    for (const t of HEAT) if (p.score >= t) lvl++;
    if (lvl > p.level) { p.level = lvl; p.lastSeen = 0; p.evading = false; this.hud.message(lvl === 1 ? 'The police are looking for you.' : `Heat level ${lvl}!`, 2.5); }
  }
  setWanted(level) {
    this.police.level = level; this.police.score = level ? HEAT[level - 1] : 0; this.police.lastSeen = 0; this.police.evading = false;
  }
  clearWanted() {
    this.police.level = 0; this.police.score = 0; this.police.evading = false;
    for (const v of this.vehicles) if (v.type === 'police' && v.ai) { v.ai.mode = 'traffic'; v.sirenOn = false; const n = this.nearestNode(v.pos); v.ai.from = n; v.ai.to = { i: Math.min(GRID, n.i + 1), j: n.j }; v.ai.wps = []; this.planSegment(v); }
  }
  nearestNode(p) { return { i: nearestRoadIndex(p.x), j: nearestRoadIndex(p.z) }; }

  spawnPoliceCar() {
    const s = this.randomLanePoint(70, 140);
    if (!s) return;
    const v = new Vehicle(this.scene, 'police', s.pos, s.heading);
    v.driver = { look: {}, cop: true };
    v.sirenOn = true;
    v.ai = { mode: 'chase', node: s.to, stuck: 0, reverseT: 0, crew: 2 };
    this.vehicles.push(v);
  }

  copShoot(cop) {
    const pl = this.player;
    const from = cop.pos.clone().add(V(0, 1.4, 0));
    const to = pl.position.clone().add(V(0, 1.1, 0));
    if (!this.lineOfSight(from, to)) return;
    const dist = from.distanceTo(to);
    this.audio.gunshot(cop.pos.distanceTo(this.camera.position));
    this.effects.muzzle(from.clone().add(to.clone().sub(from).normalize().multiplyScalar(0.8)));
    let hitChance = 0.45 - dist / 120 - (pl.vehicle ? 0.15 : 0) - (pl.speed > 4 ? 0.1 : 0);
    const miss = Math.random() > hitChance;
    const end = miss ? to.clone().add(V((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3)) : to;
    this.effects.tracer(from, end);
    if (!miss) {
      if (pl.vehicle) pl.vehicle.damage(20); else this.hurtPlayer(6 + Math.random() * 5);
    }
  }

  lineOfSight(a, b) {
    const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
    const ray = new THREE.Ray(a, dir);
    const hit = V();
    for (const c of this.collidersAlong(a, dir, len)) {
      if (c.kind !== 'building') continue;
      if (ray.intersectBox(c.box, hit) && hit.distanceTo(a) < len - 0.5) return false;
    }
    return true;
  }
  collidersAlong(o, dir, len) {
    const set = new Set();
    for (let s = 0; s <= len; s += 15) {
      const p = o.clone().addScaledVector(dir, s);
      for (const c of nearbyColliders(p.x, p.z, 12)) set.add(c);
    }
    return set;
  }

  hurtPlayer(amount) {
    const p = this.player;
    if (p.invuln > 0 || this.dead) return;
    if (p.armor > 0) { const a = Math.min(p.armor, amount * 0.7); p.armor -= a; amount -= a; }
    p.health -= amount;
    document.getElementById('damage').classList.remove('hit'); void document.getElementById('damage').offsetWidth; document.getElementById('damage').classList.add('hit');
    if (p.health <= 0) this.playerDown('dead');
  }

  playerDown(kind) {
    if (this.dead) return;
    this.dead = { kind, t: 0 };
    const p = this.player;
    if (p.vehicle && kind === 'arrest') this.exitVehicle(true);
    this.missions.fail(kind === 'dead' ? 'You died.' : 'You were arrested.');
    this.audio.deathSting();
    document.body.classList.add(kind === 'dead' ? 'wasted' : 'busted');
    this.hud.bigText(kind === 'dead' ? 'FLATLINED' : 'ARRESTED', '', kind === 'dead' ? 'dead' : 'arrest');
  }

  respawn() {
    const kind = this.dead.kind;
    this.dead = null;
    document.body.classList.remove('wasted', 'busted');
    this.hud.hideBig();
    const p = this.player;
    if (p.vehicle) this.exitVehicle(true);
    const fee = kind === 'dead' ? Math.min(this.money, 500) : Math.min(this.money, Math.floor(this.money * 0.1) + 100);
    this.money -= fee;
    if (kind === 'arrest') { p.weapons = [newWeapon('fist'), newWeapon('pistol', 24)]; p.wi = 0; }
    p.health = 100; p.armor = 0; p.velY = 0; p.invuln = 3;
    p.position.copy(kind === 'dead' ? PLACES.hospital : PLACES.police).add(V(0, 0.2, 0));
    p.facing = -Math.PI / 2;
    this.cameraYaw = p.facing;
    this.clearWanted();
    this.hud.message(kind === 'dead' ? `Hospital bill: $${fee}` : `Bail and fines: $${fee}. Weapons confiscated.`, 4);
    this.save();
  }

  // ---------------------------------------------------------------- vehicles
  enterNearestVehicle() {
    const p = this.player;
    let best = null, bd = 5;
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const d = v.pos.distanceTo(p.position) - v.spec.wid / 2;
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return;
    if (best.driver && best.driver !== 'player') {
      // carjack: pull the driver out
      const side = best.pos.clone().addScaledVector(best.right, -(best.spec.wid / 2 + 0.8));
      const ped = new Ped(this, side, best.driver.look || {}, best.driver.cop ? { cop: true } : {});
      if (ped.cop) { ped.state = 'cop'; this.addHeat(3); } else { ped.flee(p.position); this.addHeat(this.copsNear(40) ? 2 : 0.5); }
      this.peds.push(ped);
      this.audio.punch();
    }
    best.driver = 'player';
    best.ai = null;
    best.persistent = true;
    if (best.type === 'police') best.sirenOn = false;
    p.vehicle = best;
    p.mesh.visible = false;
    this.cameraYaw = best.heading;
    this.missions.onEnterVehicle(best);
  }

  exitVehicle(force = false) {
    const p = this.player, v = p.vehicle;
    if (!v) return;
    if (!force && Math.abs(v.speed) > 12) { this.hurtPlayer(15); }
    const out = v.pos.clone().addScaledVector(v.right, -(v.spec.wid / 2 + 0.7));
    resolveCircle(out, 0.4);
    p.position.set(out.x, groundY(out.x, out.z), out.z);
    p.facing = v.heading;
    v.driver = null;
    p.vehicle = null;
    p.mesh.visible = !this.firstPerson;
  }

  copsNear(r) {
    const pp = this.player.position;
    return this.peds.some((c) => c.cop && c.alive && c.pos.distanceTo(pp) < r) || this.vehicles.some((v) => v.type === 'police' && v.driver && v.pos.distanceTo(pp) < r);
  }

  trafficInput(v, dt) {
    const ai = v.ai;
    if (!ai.wps.length) this.nextSegment(v);
    const wp = ai.wps[0];
    const d = V(wp.x - v.pos.x, 0, wp.z - v.pos.z);
    if (d.length() < 3.5) { ai.wps.shift(); if (ai.wps.length < 2) this.nextSegment(v); }
    const want = Math.atan2(d.x, d.z);
    const diff = wrap(want - v.heading);
    let target = Math.abs(diff) > 0.35 ? 5 : ai.cruise;
    if (ai.wps.length >= 2 && d.length() < 12) target = Math.min(target, 6);
    // brake for anything ahead
    const f = v.forward;
    const check = (p, rad) => {
      const rel = V(p.x - v.pos.x, 0, p.z - v.pos.z);
      const ahead = rel.dot(f), side = Math.abs(rel.dot(v.right));
      return ahead > 0 && ahead < 8 + v.spec.len / 2 + Math.abs(v.speed) * 0.6 && side < rad;
    };
    let block = false;
    for (const o of this.vehicles) if (o !== v && !o.exploded && check(o.pos, 2.6)) { block = true; break; }
    if (!block && !this.player.vehicle && check(this.player.position, 1.8)) block = true;
    if (!block) for (const pd of this.peds) if (pd.alive && check(pd.pos, 1.6)) { block = true; break; }
    if (block) {
      ai.blockedT = (ai.blockedT || 0) + dt;
      if (ai.blockedT > 3 && Math.random() < dt * 0.8) this.audio.ctx && v.pos.distanceTo(this.player.position) < 25 && this.audio.horn();
      return { throttle: v.speed > 0.5 ? -1 : 0, steer: -THREE.MathUtils.clamp(diff * 2, -1, 1), handbrake: false };
    }
    ai.blockedT = 0;
    const sp = v.speed;
    return { throttle: THREE.MathUtils.clamp((target - sp) * 0.5, -1, 1), steer: -THREE.MathUtils.clamp(diff * 2.2, -1, 1), handbrake: false };
  }

  chaseInput(v, dt) {
    const ai = v.ai, pp = this.player.position;
    const dist = v.pos.distanceTo(pp);
    let target;
    if (dist < 35) target = pp;
    else {
      const np = nodePos(ai.node.i, ai.node.j);
      if (np.distanceTo(v.pos) < 8) {
        // pick the neighbouring intersection that gets closest to the player
        let best = ai.node, bd = Infinity;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = { i: ai.node.i + di, j: ai.node.j + dj };
          if (n.i < 0 || n.j < 0 || n.i > GRID || n.j > GRID) continue;
          const d = nodePos(n.i, n.j).distanceTo(pp);
          if (d < bd) { bd = d; best = n; }
        }
        ai.node = best;
      }
      target = nodePos(ai.node.i, ai.node.j);
    }
    const d = V(target.x - v.pos.x, 0, target.z - v.pos.z);
    let diff = wrap(Math.atan2(d.x, d.z) - v.heading);
    if (ai.reverseT > 0) { ai.reverseT -= dt; return { throttle: -1, steer: THREE.MathUtils.clamp(diff * 2, -1, 1), handbrake: false }; }
    if (Math.abs(v.speed) < 1.5) { ai.stuck += dt; if (ai.stuck > 1.5) { ai.stuck = 0; ai.reverseT = 1.2; } } else ai.stuck = 0;
    let throttle = 1;
    if (Math.abs(diff) > 0.7 && v.speed > 14) throttle = -0.6;
    if (dist < 10 && (!this.player.vehicle || Math.abs(this.player.vehicle.speed) < 3)) throttle = v.speed > 1 ? -1 : 0;
    return { throttle, steer: -THREE.MathUtils.clamp(diff * 2.5, -1, 1), handbrake: Math.abs(diff) > 1.2 && v.speed > 10 };
  }

  explodeVehicle(v) {
    if (v.exploded) return;
    v.explode();
    const big = v.type === 'tanker';
    this.effects.explosion(v.pos.clone(), big);
    this.audio.explosion(v.pos.distanceTo(this.camera.position));
    const R = big ? 16 : 9;
    for (const pd of this.peds) { const d = pd.pos.distanceTo(v.pos); if (pd.alive && d < R) pd.hurt(200 * (1 - d / R) + 20, v.pos, v.lastHitByPlayer); }
    const pp = this.player.position, dp = pp.distanceTo(v.pos);
    if (v.driver === 'player') { this.exitVehicle(true); this.hurtPlayer(200); }
    else if (dp < R) this.hurtPlayer(110 * (1 - dp / R));
    for (const o of this.vehicles) {
      if (o === v || o.exploded) continue;
      const d = o.pos.distanceTo(v.pos);
      if (d < R) { o.damage((big ? 1400 : 700) * (1 - d / R)); o.lastHitByPlayer = v.lastHitByPlayer; o.vel.add(o.pos.clone().sub(v.pos).setY(0).normalize().multiplyScalar(12 * (1 - d / R))); }
    }
    if (v.driver && v.driver !== 'player') { v.driver = null; }
    if (v.lastHitByPlayer) { this.addHeat(v.type === 'police' ? 5 : 2); this.stats.cars++; }
    v.deadT = 0;
    this.missions.onVehicleDestroyed(v);
  }

  // ---------------------------------------------------------------- combat
  raycast(origin, dir, maxDist, ignoreVehicle) {
    const ray = new THREE.Ray(origin, dir);
    let best = { t: maxDist, point: null };
    const tmp = V();
    for (const c of this.collidersAlong(origin, dir, maxDist)) {
      if (ray.intersectBox(c.box, tmp)) { const t = tmp.distanceTo(origin); if (t < best.t) best = { t, point: tmp.clone(), building: true }; }
    }
    if (dir.y < -1e-3) { const t = -origin.y / dir.y; if (t > 0 && t < best.t) best = { t, point: origin.clone().addScaledVector(dir, t), ground: true }; }
    for (const pd of this.peds) {
      if (!pd.alive || pd.pos.distanceTo(origin) > maxDist + 2) continue;
      for (const [y, r, head] of [[0.55, 0.32, false], [1.15, 0.34, false], [1.6, 0.2, true]]) {
        if (ray.intersectSphere(new THREE.Sphere(pd.pos.clone().setY(pd.pos.y + y), r), tmp)) {
          const t = tmp.distanceTo(origin); if (t < best.t) best = { t, point: tmp.clone(), ped: pd, head };
        }
      }
    }
    for (const v of this.vehicles) {
      if (v === ignoreVehicle || v.pos.distanceTo(origin) > maxDist + 8) continue;
      const f = v.forward, half = v.spec.len / 2 - v.spec.wid / 2;
      const r = v.type === 'tanker' ? 1.4 : v.spec.wid / 2, y = v.type === 'tanker' ? 2 : 0.9;
      for (let s = -1; s <= 1; s += 0.5) {
        if (ray.intersectSphere(new THREE.Sphere(v.pos.clone().addScaledVector(f, half * s).setY(y), r), tmp)) {
          const t = tmp.distanceTo(origin); if (t < best.t) best = { t, point: tmp.clone(), vehicle: v };
        }
      }
    }
    if (!best.point) best.point = origin.clone().addScaledVector(dir, maxDist);
    return best;
  }

  playerFire() {
    const p = this.player, w = p.weapon;
    if (p.cooldown > 0 || p.reloadT > 0) return;
    if (w.id === 'fist') {
      if (p.vehicle) return;
      p.cooldown = w.rate; p.punchT = 0.35;
      const f = V(Math.sin(p.facing), 0, Math.cos(p.facing));
      for (const pd of this.peds) {
        const rel = pd.pos.clone().sub(p.position); rel.y = 0;
        if (pd.alive && rel.length() < w.range && rel.normalize().dot(f) > 0.5) {
          pd.hurt(w.dmg, p.position); this.audio.punch();
          pd.pos.addScaledVector(f, 0.6);
          if (!pd.cop && this.copsNear(30)) this.addHeat(1);
          break;
        }
      }
      return;
    }
    if (w.mag <= 0) { this.reload(); return; }
    w.mag--; p.cooldown = w.rate; p.lastShot = 0;
    const cam = this.camera;
    const dir0 = V(); cam.getWorldDirection(dir0);
    const muzzle = p.vehicle ? p.vehicle.pos.clone().add(V(0, 1.4, 0)).addScaledVector(p.vehicle.right, -0.6) : p.position.clone().add(V(0, 1.45, 0)).addScaledVector(V(Math.sin(p.facing), 0, Math.cos(p.facing)), 0.7).addScaledVector(V(-Math.cos(p.facing), 0, Math.sin(p.facing)), 0.25);
    const origin = cam.position.clone();
    // skip past the player so third-person shots do not hit Rae herself
    const skip = this.firstPerson ? 0.3 : cam.position.distanceTo(p.vehicle ? p.vehicle.pos : p.position) - 0.5;
    origin.addScaledVector(dir0, Math.max(0, skip));
    this.effects.muzzle(muzzle);
    this.audio.gunshot(0, w.id === 'shotgun');
    this.effects.shake = Math.max(this.effects.shake, w.id === 'shotgun' ? 0.25 : 0.08);
    const pellets = w.pellets || 1;
    for (let k = 0; k < pellets; k++) {
      const dir = dir0.clone().add(V((Math.random() - 0.5) * w.spread * 2, (Math.random() - 0.5) * w.spread * 2, (Math.random() - 0.5) * w.spread * 2)).normalize();
      const hit = this.raycast(origin, dir, w.range, p.vehicle);
      this.effects.tracer(muzzle, hit.point);
      if (hit.ped) { hit.ped.hurt(w.dmg * (hit.head ? 2.5 : 1), p.position); if (!hit.ped.alive) this.stats.kills++; }
      else if (hit.vehicle) {
        hit.vehicle.damage(w.dmg * (hit.vehicle.type === 'tanker' ? 5 : 3)); hit.vehicle.lastHitByPlayer = true;
        this.effects.impact(hit.point, '#ffd27a');
        if (hit.vehicle.driver && hit.vehicle.driver !== 'player' && hit.vehicle.ai?.mode === 'traffic') hit.vehicle.ai.cruise = 20;
      } else if (hit.building || hit.ground) this.effects.impact(hit.point);
    }
    // gunfire scares people and draws attention
    for (const pd of this.peds) if (pd.alive && pd.pos.distanceTo(p.position) < 35) pd.flee(p.position);
    if (this.peds.some((pd) => pd.alive && !pd.cop && pd.pos.distanceTo(p.position) < 30) || this.copsNear(50)) this.addHeat(0.35);
    if (w.mag === 0 && w.reserve > 0) this.reload();
  }

  reload() {
    const p = this.player, w = p.weapon;
    if (w.id === 'fist' || w.mag === w.magSize || w.reserve <= 0 || p.reloadT > 0) return;
    p.reloadT = w.id === 'shotgun' ? 1.6 : 1.2;
    this.audio.reload();
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const input = this.input, p = this.player;
    this.time = (this.time + dt / 60) % 24;
    if (this.dead) {
      this.dead.t += dt;
      if (p.vehicle) { p.vehicle.update(dt, { throttle: 0, steer: 0, handbrake: true }); }
      if (this.dead.kind === 'dead') animateHumanoid(p.mesh, { dead: true, deadT: this.dead.t }, dt);
      else animateHumanoid(p.mesh, { speed: 0, phase: 0, handsUp: true }, dt);
      if (this.dead.t > 4.5) this.respawn();
    } else this.updatePlayer(dt);

    // vehicles
    for (const v of this.vehicles) {
      let inp = { throttle: 0, steer: 0, handbrake: true };
      if (v.driver === 'player') inp = this.vehicleInput;
      else if (v.driver && v.ai && !v.exploded) inp = v.ai.mode === 'chase' ? this.chaseInput(v, dt) : this.trafficInput(v, dt);
      v.update(dt, inp, (veh, force) => { if (veh.driver === 'player' || veh.pos.distanceTo(p.position) < 30) this.audio.crash(force); if (veh.driver === 'player') this.effects.shake = Math.max(this.effects.shake, force / 30); });
      if (v.health < 350 && !v.exploded) this.effects.smoke(v.pos.clone().add(V(0, 1, 0)).addScaledVector(v.forward, v.spec.len / 2 - 0.5), v.health < 150 ? '#222' : '#777');
      if (v.burning > 0) {
        v.burning -= dt;
        this.effects.fire(v.pos.clone().addScaledVector(v.forward, v.spec.len / 2 - 0.8).add(V(0, 1, 0)), 1.5);
        if (v.burning <= 0) this.explodeVehicle(v);
      }
      if (v.exploded) { v.deadT = (v.deadT || 0) + dt; if (v.deadT < 12) this.effects.fire(v.pos.clone().add(V(0, 0.8, 0)), 0.6); }
      // police car crew bails out near the player
      if (v.type === 'police' && v.ai?.mode === 'chase' && v.driver && !v.exploded && this.police.level > 0) {
        v.sirenOn = true;
        const d = v.pos.distanceTo(p.position);
        const playerSlow = !p.vehicle || Math.abs(p.vehicle.speed) < 4;
        if (d < 16 && Math.abs(v.speed) < 2 && playerSlow) {
          for (let k = 0; k < (v.ai.crew || 2); k++) {
            const pos = v.pos.clone().addScaledVector(v.right, k ? v.spec.wid / 2 + 0.8 : -(v.spec.wid / 2 + 0.8));
            const cop = new Ped(this, pos, { top: '#1f2d4a', bottom: '#1f2d4a', cap: '#15203a', shoes: '#111' }, { cop: true, health: 120 });
            cop.state = 'cop'; this.peds.push(cop);
          }
          v.driver = null; v.ai = null;
        }
      }
    }
    collideVehicles(this.vehicles.filter((v) => v.pos.distanceTo(p.position) < 150), (a, b, f) => {
      if (a.driver === 'player' || b.driver === 'player') { this.audio.crash(f); this.effects.shake = Math.max(this.effects.shake, f / 25); const o = a.driver === 'player' ? b : a; o.lastHitByPlayer = true; if (o.type === 'police' && this.police.level === 0) this.addHeat(1); }
    });
    this.vehiclePedHits();

    for (const pd of this.peds) pd.update(dt);
    this.updatePolice(dt);
    this.updatePickups(dt);
    this.missions.update(dt);
    this.manageSpawns(dt);
    this.effects.update(dt);
    this.world.setTime(this.time, p.position);
    this.world.updateLights(p.position);
    this.world.update(performance.now() / 1000);
    this.updateCamera(dt);
    this.hud.update(dt, this);
    const siren = this.vehicles.reduce((m, v) => (v.sirenOn ? Math.max(m, 1 - v.pos.distanceTo(p.position) / 120) : m), 0);
    this.audio.update(p.vehicle ? { rpm: Math.min(1, Math.abs(p.vehicle.speed) / p.vehicle.spec.maxSpeed) + (this.vehicleInput.throttle > 0 ? 0.15 : 0), throttle: Math.abs(this.vehicleInput.throttle) } : null, siren);
  }

  updatePlayer(dt) {
    const input = this.input, p = this.player;
    p.cooldown -= dt; p.invuln -= dt; p.lastShot += dt; p.punchT = Math.max(0, p.punchT - dt);
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { const w = p.weapon; const n = Math.min(w.magSize - w.mag, w.reserve); w.mag += n; w.reserve -= n; }
    }
    // weapon switching
    const cycle = input.mouse.wheel || (input.hit('KeyQ') ? -1 : 0) || (input.hit('KeyE') && !p.vehicle ? 1 : 0);
    if (cycle) { p.wi = (p.wi + cycle + p.weapons.length) % p.weapons.length; p.reloadT = 0; this.audio.uiMove(); }
    for (let k = 1; k <= 4; k++) if (input.hit('Digit' + k) && p.weapons[k - 1]) { p.wi = k - 1; p.reloadT = 0; }
    if (input.hit('KeyR')) this.reload();
    if (input.hit('KeyV')) { this.firstPerson = !this.firstPerson; }
    if (input.hit('KeyF', 'Enter')) { if (p.vehicle) this.exitVehicle(); else this.enterNearestVehicle(); }
    const look = input.consumeLook();
    this.cameraYaw -= look.x * 0.0025;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch - look.y * 0.0025, -1.2, 0.9);
    if (look.x || look.y) this.camLookTimer = 1.5; else this.camLookTimer -= dt;
    const firing = input.mouse.left && (p.weapon.auto || input.mouse.leftPressed) || input.hit('Mouse0');
    p.aiming = !p.vehicle && (input.mouse.right || input.down('Mouse1') || (p.lastShot < 0.6 && p.weapon.id !== 'fist'));

    if (p.vehicle) {
      const v = p.vehicle, a = input.axis();
      this.vehicleInput = { throttle: a.y, steer: a.x, handbrake: input.down('Space') };
      if (input.hit('KeyH')) this.audio.horn();
      if (firing && p.weapon.id !== 'fist') this.playerFire();
      p.position.copy(v.pos);
      p.facing = v.heading;
      p.speed = Math.abs(v.speed);
      this.stats.distance += p.speed * dt;
      // auto-centre the camera behind the car
      if (this.camLookTimer <= 0) {
        this.cameraYaw += wrap(v.heading - this.cameraYaw) * Math.min(1, dt * 2.5);
        this.cameraPitch += (-0.12 - this.cameraPitch) * Math.min(1, dt * 2);
      }
      // stopped car with cops alongside = arrest
      if (this.police.level > 0 && Math.abs(v.speed) < 1 && this.peds.some((c) => c.cop && c.alive && c.pos.distanceTo(v.pos) < 3.5)) {
        p.arrestT += dt; if (p.arrestT > 2) this.playerDown('arrest');
      } else p.arrestT = 0;
      return;
    }
    this.vehicleInput = { throttle: 0, steer: 0, handbrake: false };
    const a = input.axis();
    const f = V(Math.sin(this.cameraYaw), 0, Math.cos(this.cameraYaw)), r = V(-Math.cos(this.cameraYaw), 0, Math.sin(this.cameraYaw));
    const move = f.multiplyScalar(a.y).addScaledVector(r, a.x);
    const mag = Math.min(1, move.length());
    const sprint = input.down('ShiftLeft', 'ShiftRight') && !p.aiming;
    const speed = mag * (p.aiming ? 2.2 : sprint ? 7.5 : 4);
    if (mag > 0.05) {
      move.normalize();
      p.position.addScaledVector(move, speed * dt);
      if (!p.aiming) p.facing += wrap(Math.atan2(move.x, move.z) - p.facing) * Math.min(1, dt * 12);
    }
    if (p.aiming || this.firstPerson) p.facing = this.cameraYaw;
    p.speed = mag > 0.05 ? speed : 0;
    // jumping / gravity
    const gy = groundY(p.position.x, p.position.z);
    if (input.hit('Space') && p.grounded) { p.velY = 5.5; p.grounded = false; }
    p.velY -= 16 * dt;
    p.position.y += p.velY * dt;
    if (p.position.y <= gy) { p.position.y = gy; p.velY = 0; p.grounded = true; }
    resolveCircle(p.position, 0.4, p.position.y + 0.3);
    // bump into peds
    for (const pd of this.peds) {
      if (!pd.alive) continue;
      const d = V(pd.pos.x - p.position.x, 0, pd.pos.z - p.position.z); const l = d.length();
      if (l < 0.7 && l > 0.01) pd.pos.addScaledVector(d.divideScalar(l), 0.7 - l);
    }
    if (firing) this.playerFire();
    p.phase += p.speed * dt * 2.2;
    const w = p.weapon;
    animateHumanoid(p.mesh, { speed: p.speed, phase: p.phase, armed: w.id !== 'fist', aiming: p.aiming, aimPitch: this.cameraPitch * 0.8, airborne: !p.grounded, punch: p.punchT }, dt);
    p.mesh.position.copy(p.position);
    p.mesh.rotation.y = p.facing;
    p.mesh.visible = !this.firstPerson;
    // arrest when a cop gets hands on you at low heat
    if (this.police.level > 0 && this.police.level <= 2 && this.peds.some((c) => c.cop && c.alive && c.pos.distanceTo(p.position) < 1.8)) {
      p.arrestT += dt; if (p.arrestT > 1.5) this.playerDown('arrest');
    } else p.arrestT = 0;
  }

  vehiclePedHits() {
    const p = this.player;
    for (const v of this.vehicles) {
      const sp = Math.abs(v.speed);
      if (sp < 2.5) continue;
      const f = v.forward, half = v.spec.len / 2;
      const hits = (pos, r) => {
        const rel = V(pos.x - v.pos.x, 0, pos.z - v.pos.z);
        return Math.abs(rel.dot(f)) < half + r && Math.abs(rel.dot(v.right)) < v.spec.wid / 2 + r;
      };
      for (const pd of this.peds) {
        if (!pd.alive || !hits(pd.pos, 0.35)) continue;
        pd.hurt(sp * 9, v.pos, v.driver === 'player');
        pd.pos.addScaledVector(v.vel.clone().normalize(), 1.5);
        v.vel.multiplyScalar(0.92);
        if (v.driver === 'player') this.audio.punch();
      }
      if (!p.vehicle && !this.dead && hits(p.position, 0.35) && v.driver !== 'player') {
        this.hurtPlayer(sp * 3);
        p.position.addScaledVector(v.vel.clone().normalize(), 2); p.velY = 3;
      }
    }
  }

  updatePolice(dt) {
    const pol = this.police, p = this.player;
    if (pol.level === 0) return;
    // are any officers in sight range?
    const sight = 45 + pol.level * 12;
    const seen = this.peds.some((c) => c.cop && c.alive && c.pos.distanceTo(p.position) < sight) ||
      this.vehicles.some((v) => v.type === 'police' && (v.driver || v.ai) && !v.exploded && v.pos.distanceTo(p.position) < sight);
    if (seen) { pol.lastSeen = 0; pol.evading = false; }
    else { pol.lastSeen += dt; pol.evading = pol.lastSeen > 2; }
    if (pol.lastSeen > 10 + pol.level * 4) { this.clearWanted(); this.hud.message('You lost the police.', 3); this.audio.pickup(); return; }
    pol.spawnT -= dt;
    const want = [0, 1, 2, 4, 5, 7][pol.level];
    const have = this.vehicles.filter((v) => v.type === 'police' && v.ai?.mode === 'chase' && !v.exploded).length;
    if (have < want && pol.spawnT <= 0) { this.spawnPoliceCar(); pol.spawnT = 4 - pol.level * 0.5; }
  }

  updatePickups(dt) {
    const p = this.player, t = performance.now() / 1000;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (pk.hidden > 0) { pk.hidden -= dt; if (pk.hidden <= 0) pk.mesh.visible = true; continue; }
      pk.life -= dt;
      if (pk.life <= 0) { this.scene.remove(pk.mesh); this.pickups.splice(i, 1); continue; }
      pk.mesh.rotation.y = t * 2;
      pk.mesh.position.y = pk.pos.y + 0.8 + Math.sin(t * 3) * 0.12;
      const range = p.vehicle ? 2.5 : 1.3;
      if (pk.pos.distanceTo(p.position) < range && !this.dead) {
        let ok = true;
        const give = (id, ammo) => {
          let w = p.weapons.find((x) => x.id === id);
          if (!w) { w = newWeapon(id, 0); p.weapons.push(w); this.hud.message(`Picked up <b>${w.name}</b>`); }
          w.reserve += ammo;
        };
        switch (pk.kind) {
          case 'cash': this.money += pk.amount; break;
          case 'health': if (p.health >= 100) ok = false; else p.health = 100; break;
          case 'armor': if (p.armor >= 100) ok = false; else p.armor = 100; break;
          case 'pistolAmmo': give('pistol', 36); break;
          case 'smg': give('smg', 90); break;
          case 'shotgun': give('shotgun', 18); break;
        }
        if (!ok) continue;
        this.audio.pickup();
        if (pk.respawn) { pk.hidden = pk.respawn; pk.mesh.visible = false; }
        else { this.scene.remove(pk.mesh); this.pickups.splice(i, 1); }
      }
    }
  }

  manageSpawns(dt) {
    this.spawnT = (this.spawnT || 0) - dt;
    if (this.spawnT > 0) return;
    this.spawnT = 0.5;
    const p = this.player.position;
    const far = (o, d) => o.distanceTo(p) > d;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const pd = this.peds[i];
      if (pd.persistent) continue;
      if (far(pd.pos, 190) || (!pd.alive && pd.deadT > 30)) { pd.dispose(); this.peds.splice(i, 1); }
    }
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.driver === 'player' || v.missionTarget) continue;
      const limit = v.persistent ? 320 : 200;
      if (far(v.pos, limit) || (v.exploded && v.deadT > 40 && far(v.pos, 60))) { v.dispose(); this.vehicles.splice(i, 1); }
    }
    const civPeds = this.peds.filter((x) => !x.cop).length;
    if (civPeds < this.maxPeds) this.spawnPed(45, 140);
    const traffic = this.vehicles.filter((v) => v.ai?.mode === 'traffic').length;
    if (traffic < this.maxTraffic) this.spawnTraffic(80, 180);
  }

  updateCamera(dt) {
    const cam = this.camera, p = this.player;
    const v = p.vehicle;
    const yaw = this.cameraYaw, pitch = this.cameraPitch;
    const dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.fpGun.visible = this.firstPerson && !v && p.weapon.id !== 'fist' && !this.dead;
    if (this.firstPerson && !this.dead) {
      const eye = v ? v.pos.clone().add(V(0, v.type === 'tanker' ? 2.6 : 1.15, 0)).addScaledVector(v.right, -0.4).addScaledVector(v.forward, v.type === 'tanker' ? v.spec.len / 2 - 1.2 : -0.2)
        : p.position.clone().add(V(0, 1.62 + Math.sin(p.phase * 2) * 0.03 * Math.min(1, p.speed / 4), 0)).addScaledVector(V(Math.sin(p.facing), 0, Math.cos(p.facing)), 0.18);
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(dir));
      cam.fov += ((p.aiming ? 50 : 72) - cam.fov) * Math.min(1, dt * 8);
    } else {
      let target, dist, height;
      if (v) {
        target = v.pos.clone().add(V(0, v.type === 'tanker' ? 3 : 1.5, 0));
        dist = v.spec.len * 1.1 + 3 + Math.min(3, Math.abs(v.speed) * 0.05);
        height = 0.6;
      } else {
        const right = V(-Math.cos(yaw), 0, Math.sin(yaw));
        target = p.position.clone().add(V(0, 1.6, 0)).addScaledVector(right, p.aiming ? -0.7 : -0.35);
        dist = p.aiming ? 2.2 : 4.2;
        height = 0.1;
      }
      this.cameraSmooth.lerp(target, Math.min(1, dt * (v ? 12 : 20)));
      const desired = this.cameraSmooth.clone().addScaledVector(dir, -dist).add(V(0, height, 0));
      // keep the camera out of buildings
      const d = desired.clone().sub(this.cameraSmooth), len = d.length(); d.normalize();
      let allowed = len;
      for (let s = 0.5; s <= len; s += 0.4) {
        const pt = this.cameraSmooth.clone().addScaledVector(d, s);
        let inside = pt.y < 0.3;
        if (!inside) for (const c of nearbyColliders(pt.x, pt.z, 0.5)) if (c.kind === 'building' && pt.y < c.height && pt.x > c.minX - 0.3 && pt.x < c.maxX + 0.3 && pt.z > c.minZ - 0.3 && pt.z < c.maxZ + 0.3) { inside = true; break; }
        if (inside) { allowed = Math.max(0.6, s - 0.5); break; }
      }
      cam.position.copy(this.cameraSmooth).addScaledVector(d, allowed);
      cam.lookAt(cam.position.clone().add(dir));
      const fov = v ? 68 + Math.min(12, Math.abs(v.speed) * 0.25) : p.aiming ? 55 : 65;
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 5);
    }
    if (this.effects.shake > 0) {
      const s = this.effects.shake * 0.08;
      cam.rotation.x += (Math.random() - 0.5) * s; cam.rotation.y += (Math.random() - 0.5) * s;
    }
    cam.updateProjectionMatrix();
  }

  blips() {
    const out = [];
    for (const v of this.vehicles) if (v.type === 'police' && !v.exploded && (v.driver || v.ai)) out.push({ x: v.pos.x, z: v.pos.z, color: Math.sin(performance.now() / 150) > 0 ? '#ff3b3b' : '#3b6bff' });
    for (const c of this.peds) if (c.cop && c.alive && this.police.level > 0) out.push({ x: c.pos.x, z: c.pos.z, color: '#6c8cff', r: 2.5 });
    out.push({ x: PLACES.hospital.x, z: PLACES.hospital.z, color: '#e84d4d', r: 3 });
    out.push({ x: PLACES.police.x, z: PLACES.police.z, color: '#3d6bff', r: 3 });
    out.push({ x: PLACES.home.x, z: PLACES.home.z, color: '#4fbf6a', r: 3.5 });
    out.push(...this.missions.blips());
    return out;
  }

  save() {
    const p = this.player;
    try {
      localStorage.setItem('sundown-save', JSON.stringify({
        money: this.money, time: this.time, done: this.missions.done,
        weapons: p.weapons.map((w) => ({ id: w.id, mag: w.mag, reserve: w.reserve })), stats: this.stats,
      }));
    } catch { /* storage unavailable */ }
  }
  load(data) {
    this.money = data.money || 0;
    this.time = data.time ?? 17.5;
    this.missions.done = data.done || [];
    if (data.weapons) this.player.weapons = data.weapons.map((w) => ({ ...newWeapon(w.id, w.reserve), mag: w.mag }));
    this.player.wi = Math.min(this.player.wi, this.player.weapons.length - 1);
    if (data.stats) this.stats = data.stats;
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
