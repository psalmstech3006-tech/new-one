import * as THREE from 'three';
import { DoorSystem } from './doors.js';
import { buildInterior } from './interiors.js';
import { cityMaterials } from './materials.js';

// ============================================================================
// City runtime: door system for every building, interior streaming (built within 45 m,
// freed beyond 90 m, one build per frame), "am I inside" detection, a small pool of real
// point lights handed to the interiors nearest the player, and interactions (doors,
// elevators, counters/ATMs...).
// ============================================================================

const BUILD_R = 45, FREE_R = 90;
const POOL = { 'very-low': 1, low: 2, medium: 3, high: 4 };

export class CityRuntime {
  constructor(game, district, tierName = 'medium') {
    this.game = game; this.district = district;
    this.doors = new DoorSystem(game);
    for (const b of district.buildings) for (const d of b.doors) this.doors.add(d, b, null);
    this.enterable = district.buildings.filter((b) => b.meta?.interior);
    this.built = new Map();          // building id -> interior
    this.inside = null;
    this.pool = [];
    for (let i = 0; i < (POOL[tierName] ?? 2); i++) { const l = new THREE.PointLight('#fff1dc', 0, 14, 2); l.castShadow = false; game.scene.add(l); this.pool.push(l); }
    this.fade = document.createElement('div');
    Object.assign(this.fade.style, { position: 'fixed', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none', transition: 'opacity .25s', zIndex: 5 });
    document.body.appendChild(this.fade);
    this.stats = { interiors: 0, interiorTris: 0, buildMs: 0 };
  }

  local(b, p) { const dx = p.x - b.x, dz = p.z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot); return { x: dx * c - dz * s, y: p.y - b.y, z: dx * s + dz * c }; }
  world(b, x, y, z) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return new THREE.Vector3(b.x + x * c + z * s, b.y + y, b.z - x * s + z * c); }

  stream(pos) {
    // free far interiors
    for (const [id, inn] of this.built) {
      const b = inn.b;
      if (Math.hypot(pos.x - b.x, pos.z - b.z) - Math.max(...b.footprint) / 2 > FREE_R) this.free(id);
    }
    // build the nearest pending interior (at most one per frame)
    let best = null, bd = BUILD_R;
    for (const b of this.enterable) {
      if (this.built.has(b.id)) continue;
      const d = Math.hypot(pos.x - b.x, pos.z - b.z) - Math.max(...b.footprint) / 2;
      if (d < bd) { bd = d; best = b; }
    }
    if (best) this.build(best);
  }

  build(b) {
    const t0 = performance.now();
    const inn = buildInterior(b.res, cityMaterials());
    if (!inn) { this.built.set(b.id, { b, empty: true }); return; }
    inn.b = b;
    inn.group.position.set(b.x, b.y, b.z); inn.group.rotation.y = b.rot;
    inn.group.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
    this.game.scene.add(inn.group);
    inn.body = this.game.physics.staticCompound(inn.colliders, b.x, b.y, b.z, b.rot);
    for (const d of inn.doors) this.doors.add(d, b, b.id);
    inn.worldLights = inn.lights.map((l) => ({ ...l, pos: this.world(b, l.x, l.y, l.z) }));
    this.built.set(b.id, inn);
    this.stats.buildMs = performance.now() - t0;
    this.count();
  }

  free(id) {
    const inn = this.built.get(id);
    this.built.delete(id);
    if (!inn || inn.empty) return;
    this.game.scene.remove(inn.group);
    inn.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    inn.atlas?.dispose();
    this.game.physics.removeBody(inn.body);
    this.doors.removeOwner(id);
    if (this.inside?.inn === inn) this.inside = null;
    this.count();
  }

  count() {
    let n = 0, t = 0;
    for (const inn of this.built.values()) if (!inn.empty) { n++; t += inn.tris; }
    this.stats.interiors = n; this.stats.interiorTris = t;
  }

  whereIs(pos) {
    for (const inn of this.built.values()) {
      if (inn.empty) continue;
      const p = this.local(inn.b, pos);
      for (const v of inn.volumes) if (p.x > v.x0 && p.x < v.x1 && p.z > v.z0 && p.z < v.z1 && p.y > v.y0 - 0.3 && p.y < v.y1) return { inn, vol: v, b: inn.b };
    }
    return null;
  }

  lights(pos) {
    const cands = [];
    for (const inn of this.built.values()) if (!inn.empty) for (const l of inn.worldLights) cands.push({ l, d: l.pos.distanceToSquared(pos) });
    cands.sort((a, b) => a.d - b.d);
    this.pool.forEach((pl, i) => {
      const c = cands[i];
      if (!c || c.d > 40 * 40) { pl.intensity = 0; return; }
      pl.position.copy(c.l.pos); pl.color.set(c.l.color); pl.distance = c.l.distance; pl.intensity = c.l.intensity * 2.2;
    });
  }

  // Interactables near the player (elevators and service points) in world space.
  nearestAct(pos) {
    let best = null, bd = 1.6;
    for (const inn of this.built.values()) {
      if (inn.empty) continue;
      const p = this.local(inn.b, pos);
      for (const a of inn.interactables) {
        if (a.type === 'elevator') {
          const stopIdx = a.stops.findIndex((y) => Math.abs(p.y - y) < 1.2);
          const d = Math.hypot(p.x - a.dx, p.z - a.dz);
          if (stopIdx >= 0 && d < bd) { bd = d; best = { a, inn, stopIdx }; }
        } else {
          const d = Math.hypot(p.x - a.x, p.z - a.z);
          if (Math.abs(p.y - a.y) < 1.5 && d < bd) { bd = d; best = { a, inn }; }
        }
      }
    }
    return best;
  }

  update(dt, pos) {
    this.tickRide(dt);
    this.stream(pos);
    this.inside = this.whereIs(pos);
    // interiors are only seen from inside or through nearby glass/open doors
    for (const inn of this.built.values()) if (!inn.empty) inn.group.visible = this.inside?.inn === inn || Math.hypot(pos.x - inn.b.x, pos.z - inn.b.z) - Math.max(...inn.b.footprint) / 2 < 28;
    this.lights(pos);
    this.doors.update(dt, pos);
  }

  // Returns the hint to show; performs the action when `use` (E) or `lock` (K) is pressed.
  interact(player, { use, lock }) {
    const pos = player.position, keys = player.keys;
    const act = this.nearestAct(pos), door = this.doors.nearest(pos);
    const dDoor = door ? Math.hypot(pos.x - door.center.x, pos.z - door.center.z) : 99;
    if (act && (!door || dDoor > 1.1)) {
      const { a, inn } = act;
      if (a.type === 'elevator') {
        const next = (act.stopIdx + 1) % a.stops.length;
        if (use) this.ride(player, inn.b, a, next);
        return `E: elevator to ${next === 0 ? 'lobby' : `floor ${next + 1}`}`;
      }
      return {
        shop: `${a.label} — counter (shopping opens with the economy phase)`, atm: 'ATM (banking opens with the economy phase)', teller: 'Bank teller',
        cell: `${a.label} — holding cell`, reception: a.label, vault: 'Vault door', workout: `${a.label} — training (skills phase)`,
      }[a.type] || a.label;
    }
    if (door) {
      if (lock && this.doors.toggleLock(door, keys)) return door.locked ? `${door.label} locked` : `${door.label} unlocked`;
      if (use) { const r = this.doors.use(door, pos, keys); if (r === 'locked') return `${door.label} is locked`; }
      return this.doors.prompt(door, keys);
    }
    return '';
  }

  // Elevator ride runs on simulation time (not wall-clock timers) so it is deterministic:
  // fade out 0.25 s, move the player, fade in.
  ride(player, b, a, stop) {
    if (this.pendingRide) return;
    this.onTeleport?.();
    this.fade.style.opacity = 1;
    const w = this.world(b, a.dx, a.stops[stop], a.dz + 0.4);
    this.pendingRide = { player, to: { x: w.x, y: w.y + player.halfH + player.radius + 0.08, z: w.z }, t: 0.25 };
  }

  tickRide(dt) {
    const r = this.pendingRide; if (!r) return;
    r.t -= dt;
    if (r.t > 0) return;
    if (!r.done) {
      r.done = true; r.t = 0.25;
      r.player.body.setTranslation(r.to, true); r.player.body.setNextKinematicTranslation(r.to);
      r.player.speed = 0; r.player.velY = 0;
      return;
    }
    this.fade.style.opacity = 0; this.pendingRide = null;
  }
}
