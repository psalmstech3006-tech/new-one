import * as THREE from 'three';
import { PLACES, roadCenter, ROAD, CELL } from './world.js';
import { Vehicle } from './vehicles.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Original storyline: Rae Vance runs jobs for Rusty, a garage owner with debts.
const DEFS = [
  {
    id: 'chrome', letter: 'R', title: 'Borrowed Chrome', reward: 2000,
    start: V(roadCenter(4) + 12, 0.2, roadCenter(4) + 20),
    intro: ['<b>Rusty:</b> Rae! Collector left a cream Stallion 70 outside the marina hotel.', '<b>Rusty:</b> Bring it to my garage before the valet notices. Not a scratch.'],
  },
  {
    id: 'race', letter: 'R', title: 'Rush Hour', reward: 1500, needs: 'chrome',
    start: V(roadCenter(6) + 12, 0.2, roadCenter(6) + 30),
    intro: ['<b>Rusty:</b> Buyer wants proof you can drive. Hit every checkpoint before the clock runs out.'],
  },
  {
    id: 'tanker', letter: 'R', title: 'Tanker Trouble', reward: 3500, needs: 'race',
    start: V(roadCenter(2) + 12, 0.2, roadCenter(3) + 30),
    intro: ['<b>Rusty:</b> Solara Fuel squeezed my cousin out of business.', '<b>Rusty:</b> Two of their tankers are doing the rounds downtown. Make them go away. Loudly.'],
  },
  {
    id: 'heat', letter: 'R', title: 'Heat Wave', reward: 5000, needs: 'tanker',
    start: V(roadCenter(7) + 12, 0.2, roadCenter(1) + 30),
    intro: ['<b>Rusty:</b> Every cop in Sundown is looking for you now.', '<b>Rusty:</b> Lose them, then lie low at the safehouse. Do that and we are square.'],
  },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.done = [];
    this.active = null;
    this.markers = new Map();
    this.cooldown = 0;
    const markerMat = new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.45, depthWrite: false });
    for (const d of DEFS) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.4, 24, 1, true), markerMat);
      m.position.copy(d.start).add(V(0, 0.7, 0));
      game.scene.add(m);
      this.markers.set(d.id, m);
    }
    this.checkMat = new THREE.MeshBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
    this.target = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 3, 32, 1, true), this.checkMat);
    this.target.visible = false;
    game.scene.add(this.target);
  }

  available() { return DEFS.filter((d) => !this.done.includes(d.id) && (!d.needs || this.done.includes(d.needs))); }

  blips() {
    const out = [];
    if (this.active) {
      if (this.active.targetPos) out.push({ x: this.active.targetPos.x, z: this.active.targetPos.z, color: '#f2c230', r: 5, mission: true, label: 'Objective' });
      for (const v of this.active.targets || []) if (!v.exploded) out.push({ x: v.pos.x, z: v.pos.z, color: '#e84d4d', r: 4.5, mission: true, label: 'Target' });
      return out;
    }
    for (const d of this.available()) out.push({ x: d.start.x, z: d.start.z, color: '#f2c230', r: 5, mission: true, label: d.title });
    return out;
  }

  say(lines) {
    lines.forEach((l, i) => setTimeout(() => this.game.hud.subtitle(l, 4), i * 4200));
  }

  start(def) {
    const g = this.game;
    this.active = { def, t: 0 };
    this.game.audio.mission();
    g.hud.bigText(def.title, 'MISSION', 'mission');
    setTimeout(() => g.hud.hideBig(), 2500);
    this.say(def.intro);
    this['start_' + def.id]();
  }

  // --- mission setups --------------------------------------------------
  start_chrome() {
    const g = this.game, a = this.active;
    const pos = V(roadCenter(6) - ROAD / 2 + 3, 0, roadCenter(2) + 30);
    const car = new Vehicle(g.scene, 'muscle', pos, 0, '#e8dcc0');
    car.missionTarget = true;
    g.vehicles.push(car);
    a.car = car; a.stage = 'get';
    a.targetPos = pos;
    g.hud.objective('Steal the <span class="y">Stallion 70</span>.');
  }
  start_race() {
    const g = this.game, a = this.active;
    const pts = [[6, 5], [6, 3], [4, 3], [4, 1], [2, 1], [2, 4], [1, 7], [5, 7], [7, 7], [7, 5]];
    a.checkpoints = pts.map(([i, j]) => V(roadCenter(i), 0, roadCenter(j)));
    a.idx = 0; a.time = 120;
    a.targetPos = a.checkpoints[0];
    g.hud.objective('Get in a vehicle and hit every <span class="y">checkpoint</span>.');
  }
  start_tanker() {
    const g = this.game, a = this.active;
    a.targets = [];
    for (let k = 0; k < 2; k++) {
      let v = null;
      for (let tries = 0; tries < 10 && !v; tries++) v = g.spawnTraffic(60, 160, 'tanker');
      if (v) { v.missionTarget = true; v.ai.cruise = 8; a.targets.push(v); }
    }
    g.hud.objective('Destroy the <span class="r">Solara Fuel tankers</span>.');
  }
  start_heat() {
    const g = this.game, a = this.active;
    g.setWanted(3);
    a.stage = 'evade';
    g.hud.objective('Lose the <span class="b">police</span>.');
  }

  // --- per-frame -------------------------------------------------------
  update(dt) {
    const g = this.game, p = g.player;
    const t = performance.now() / 1000;
    for (const [id, m] of this.markers) {
      const avail = !this.active && this.available().some((d) => d.id === id);
      m.visible = avail;
      m.scale.y = 1 + Math.sin(t * 3) * 0.08;
    }
    this.cooldown -= dt;
    if (!this.active) {
      g.gps = null;
      g.hud.objective('');
      g.hud.missionTimer(null);
      if (this.cooldown > 0 || g.dead) return;
      for (const d of this.available()) {
        if (d.start.distanceTo(p.position) < 1.8 && !p.vehicle) { this.start(d); break; }
      }
      return;
    }
    const a = this.active;
    a.t += dt;
    this['update_' + a.def.id](dt, a);
    if (!this.active) return;
    if (a.targetPos) {
      this.target.visible = true;
      this.target.position.copy(a.targetPos).add(V(0, 1.5, 0));
      g.gps = [a.targetPos];
    } else { this.target.visible = false; g.gps = null; }
  }

  update_chrome(dt, a) {
    const g = this.game, p = g.player;
    if (a.car.exploded) return this.fail('The Stallion was destroyed.');
    if (a.stage === 'get') {
      a.targetPos = a.car.pos;
      if (p.vehicle === a.car) { a.stage = 'deliver'; a.time = 150; g.hud.objective('Deliver the car to <span class="y">Rusty\'s Garage</span>.'); }
    } else {
      a.time -= dt;
      g.hud.missionTimer(a.time);
      a.targetPos = PLACES.garage;
      if (p.vehicle !== a.car) g.hud.objective('Get back in the <span class="y">Stallion 70</span>.'), a.targetPos = a.car.pos;
      else g.hud.objective(`Deliver the car to <span class="y">Rusty's Garage</span>. Damage: ${Math.round(100 - a.car.health / 10)}%`);
      if (a.time <= 0) return this.fail('Too slow.');
      if (p.vehicle === a.car && a.car.pos.distanceTo(PLACES.garage) < 6 && Math.abs(a.car.speed) < 3) {
        const bonus = Math.round(a.car.health / 1000 * 1000);
        g.exitVehicle(true);
        a.car.missionTarget = false; a.car.dispose(); g.vehicles.splice(g.vehicles.indexOf(a.car), 1);
        this.pass(bonus);
      }
    }
  }
  update_race(dt, a) {
    const g = this.game, p = g.player;
    if (!p.vehicle) { a.targetPos = a.checkpoints[a.idx]; g.hud.objective('Get in a <span class="y">vehicle</span>.'); return; }
    a.time -= dt;
    g.hud.missionTimer(a.time);
    g.hud.objective(`Checkpoint <span class="y">${a.idx + 1}/${a.checkpoints.length}</span>`);
    if (a.time <= 0) return this.fail('Out of time.');
    a.targetPos = a.checkpoints[a.idx];
    if (p.position.distanceTo(a.targetPos) < 7) {
      a.idx++; g.audio.pickup(); a.time += 4;
      if (a.idx >= a.checkpoints.length) return this.pass(Math.round(a.time * 20));
    }
  }
  update_tanker(dt, a) {
    const g = this.game;
    a.targetPos = null;
    const left = a.targets.filter((v) => !v.exploded).length;
    g.hud.objective(`Destroy the <span class="r">Solara Fuel tankers</span>: ${left} left.`);
    if (!a.targets.length) return this.fail('The convoy never showed.');
    if (left === 0) { a.targets.forEach((v) => (v.missionTarget = false)); this.pass(0); }
  }
  update_heat(dt, a) {
    const g = this.game, p = g.player;
    if (a.stage === 'evade') {
      a.targetPos = null;
      if (g.police.level === 0) { a.stage = 'home'; g.hud.objective('Go to the <span class="g">safehouse</span>.'); }
    } else {
      a.targetPos = PLACES.home;
      if (g.police.level > 0) { a.stage = 'evade'; g.hud.objective('Lose the <span class="b">police</span>.'); }
      else if (p.position.distanceTo(PLACES.home) < 4) this.pass(0);
    }
  }

  onEnterVehicle() {}
  onVehicleDestroyed() {}

  pass(bonus) {
    const g = this.game, d = this.active.def;
    const total = d.reward + bonus;
    g.money += total;
    this.done.push(d.id);
    this.cleanup();
    g.audio.mission();
    g.hud.bigText('MISSION PASSED', `$${total.toLocaleString()}`, 'passed');
    setTimeout(() => g.hud.hideBig(), 4000);
    if (!this.available().length) setTimeout(() => g.hud.subtitle('<b>Rusty:</b> We\'re square, Rae. Sundown is yours. Free roam unlocked.', 6), 4500);
    g.save();
  }
  fail(reason) {
    if (!this.active) return;
    const g = this.game;
    for (const v of this.active.targets || []) v.missionTarget = false;
    if (this.active.car) this.active.car.missionTarget = false;
    this.cleanup();
    g.audio.fail();
    if (!g.dead) { g.hud.bigText('MISSION FAILED', reason, 'failed'); setTimeout(() => g.hud.hideBig(), 3500); }
  }
  cleanup() {
    this.active = null;
    this.cooldown = 5;
    this.target.visible = false;
    this.game.gps = null;
    this.game.hud.objective('');
    this.game.hud.missionTimer(null);
  }
}
