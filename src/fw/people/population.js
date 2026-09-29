import * as THREE from 'three';
import { Character } from '../character.js';
import { buildAvatar, randomDNA } from './avatar.js';
import { rng } from '../city/geom.js';
import { LOT_Y } from '../city/district.js';

// ============================================================================
// Population: residents with homes, workplaces and daily schedules driven by the shared
// world clock (so every client agrees on who is where), routed over the sidewalk graph.
//
// Simulation tiers (brief: NPC life simulation):
//   T0 abstract — every resident; position is a pure function of the clock (schedule +
//                 route + walking speed). Indoors = inside a building, not rendered.
//   T1 embodied — the nearest outdoor residents (tier budget) get a pooled physical
//                 Character that walks the route, dodges cars and enters doors.
//   T2 aware    — embodied residents close to the player: look at the player, react to
//                 violence (flee), step aside from speeding cars.
// ============================================================================

const WALK = 1.35;                 // m/s
const REAL_S_PER_HOUR = 120;       // matches the client/server clock (1 game hour = 2 min)
const ACTIVE_R = { 'very-low': 55, low: 75, medium: 95, high: 120 };

export class Population {
  constructor(game, district, tierName, { count = 160, seed = 42, budget = 16 } = {}) {
    Object.assign(this, { game, district, budget });
    this.R = ACTIVE_R[tierName] ?? 90;
    this.buildGraph();
    this.places();
    const r = rng(seed);
    this.residents = [];
    for (let i = 0; i < count; i++) this.residents.push(this.makeResident(i, r));
    this.pool = [];
    for (let i = 0; i < budget; i++) {
      const c = new Character(game, buildAvatar(randomDNA(i)), new THREE.Vector3(0, -200, 0), {});
      c.inactive = true; c.visible = false; c.root.visible = false; c.collider.setEnabled(false);
      this.pool.push(c);
    }
    this.t = 0; this.panics = [];
    this.stats = { residents: count, outdoors: 0, embodied: 0 };
  }

  get chars() { return this.pool; }
  get active() { return this.pool.filter((c) => !c.inactive); }

  // ------------------------------------------------------------ sidewalk graph
  buildGraph() {
    const nodes = [], edges = new Map(), key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`, index = new Map();
    const node = (p) => { const k = key(p); if (!index.has(k)) { index.set(k, nodes.length); nodes.push(new THREE.Vector2(p[0], p[1])); edges.set(nodes.length - 1, []); } return index.get(k); };
    const link = (a, b) => { const d = nodes[a].distanceTo(nodes[b]); edges.get(a).push([b, d]); edges.get(b).push([a, d]); };
    this.segments = [];
    const rings = this.district.pedRings.slice(0, 9);
    for (const ring of rings) for (let i = 0; i < 4; i++) { const a = node(ring[i]), b = node(ring[(i + 1) % 4]); link(a, b); this.segments.push([a, b]); }
    // east sidewalk of Harbor Blvd, with nodes level with the east blocks' corners
    const zs = [...new Set(rings.flatMap((r) => r.map((c) => c[1])))].sort((a, b) => a - b);
    for (let i = 0; i < zs.length - 1; i++) { const a = node([188, zs[i]]), b = node([188, zs[i + 1]]); link(a, b); this.segments.push([a, b]); }
    // crosswalks: straight crossings between facing corners across a street
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const d = nodes[a].distanceTo(nodes[b]), dx = Math.abs(nodes[a].x - nodes[b].x), dz = Math.abs(nodes[a].y - nodes[b].y);
      if (d > 12 && d < 20 && (dx < 0.5 || dz < 0.5)) link(a, b);
    }
    this.nodes = nodes; this.edges = edges;
  }

  // nearest point on the sidewalk network: {p, a, b}
  snap(x, z) {
    let best = null, bd = Infinity; const P = new THREE.Vector2(x, z), t = new THREE.Vector2();
    for (const [a, b] of this.segments) {
      const A = this.nodes[a], B = this.nodes[b], AB = B.clone().sub(A), l2 = AB.lengthSq();
      const k = l2 ? THREE.MathUtils.clamp(P.clone().sub(A).dot(AB) / l2, 0, 1) : 0;
      t.copy(A).addScaledVector(AB, k); const d = t.distanceToSquared(P);
      if (d < bd) { bd = d; best = { p: t.clone(), a, b }; }
    }
    return best;
  }

  route(from, to) {
    const s = this.snap(from.x, from.y), e = this.snap(to.x, to.y), N = this.nodes;
    const dist = new Map(), prev = new Map(), q = [];
    for (const n of [s.a, s.b]) { dist.set(n, s.p.distanceTo(N[n])); q.push(n); }
    while (q.length) {
      q.sort((x, y) => dist.get(x) - dist.get(y));
      const u = q.shift();
      for (const [v, w] of this.edges.get(u)) { const nd = dist.get(u) + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); if (!q.includes(v)) q.push(v); } }
    }
    const endN = (dist.get(e.a) ?? 1e9) + e.p.distanceTo(N[e.a]) < (dist.get(e.b) ?? 1e9) + e.p.distanceTo(N[e.b]) ? e.a : e.b;
    const path = []; for (let n = endN; n != null; n = prev.get(n)) path.unshift(N[n]);
    const pts = [from, s.p, ...path, e.p, to];
    // same segment: walk straight along it
    if ((s.a === e.a && s.b === e.b) || (s.a === e.b && s.b === e.a)) pts.splice(2, path.length);
    const clean = [pts[0]]; for (const p of pts.slice(1)) if (p.distanceTo(clean[clean.length - 1]) > 0.3) clean.push(p);
    const cum = [0]; for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + clean[i].distanceTo(clean[i - 1]));
    return { pts: clean, cum, len: cum[cum.length - 1] };
  }

  // ------------------------------------------------------------ places
  places() {
    const D = this.district;
    const doorOf = (b) => {
      const d = b.doors.find((q) => q.interactive && !q.locked) || b.doors.find((q) => q.interactive) || b.doors[0];
      if (!d) return null;
      const c = Math.cos(b.rot), s = Math.sin(b.rot), lx = d.hinge[0] + d.u[0] * d.w / 2 + d.normal[0] * 1.2, lz = d.hinge[2] + d.u[2] * d.w / 2 + d.normal[2] * 1.2;
      return new THREE.Vector2(b.x + lx * c + lz * s, b.z - lx * s + lz * c);
    };
    const P = { home: [], work: [], shop: [], leisure: [], school: [] };
    for (const b of D.buildings) {
      const door = doorOf(b); if (!door) continue;
      const m = b.meta || {}, f = m.family, place = { b, door, name: m.name };
      if (m.category === 'residential') P.home.push(place);
      else if (f === 'school') P.school.push(place);
      else if (['mixedUse', 'convenience', 'mall', 'supermarket', 'gas'].includes(f)) { P.shop.push(place); P.work.push(place); }
      else if (['gym', 'cinema', 'library', 'community'].includes(f)) { P.leisure.push(place); P.work.push(place); }
      else if (f !== 'construction' && f !== 'parking') P.work.push(place);
    }
    // outdoor spots: park benches/paths, school field edge, plazas
    P.park = [[-100, 12], [-94, 20], [-106, 26], [-128, -10], [-128, 5], [-88, -30], [-140, 0], [120, 100], [-10, -8], [0, 95]].map(([x, z]) => ({ door: new THREE.Vector2(x, z), outdoor: true, name: 'park' }));
    this.P = P;
  }

  makeResident(i, r) {
    const P = this.P, pick = (a) => a[Math.floor(r() * a.length)];
    const roll = r(), home = pick(P.home);
    let arche = roll < 0.55 ? 'worker' : roll < 0.7 ? 'student' : roll < 0.85 ? 'retiree' : 'nightshift';
    const role = arche === 'worker' && r() < 0.12 ? 'worker' : 'civilian';
    const dna = randomDNA(9000 + i, { role });
    if (arche === 'student') dna.age = 14 + Math.floor(r() * 5);
    const plan = [];
    const jit = () => (r() - 0.5) * 1.2;
    const at = (h, act, place) => plan.push({ h: (h + 24) % 24, act, place });
    if (arche === 'worker') {
      const work = pick(P.work);
      at(7.5 + jit(), 'work', work); at(12 + r(), 'lunch', pick([...P.shop, ...P.park])); at(13 + r() * 0.5, 'work', work);
      at(17 + jit(), r() < 0.5 ? 'shop' : 'leisure', r() < 0.5 ? pick(P.shop) : pick([...P.leisure, ...P.park])); at(19 + r() * 2, 'home', home);
    } else if (arche === 'student') {
      at(7.6 + jit() * 0.5, 'school', pick(P.school)); at(15 + r() * 0.5, 'leisure', pick([...P.park, ...P.shop])); at(18 + r(), 'home', home);
    } else if (arche === 'retiree') {
      at(9 + jit(), 'park', pick(P.park)); at(11 + r(), 'shop', pick(P.shop)); at(13 + r(), 'home', home); at(15 + r(), 'stroll', pick(P.park)); at(18 + r(), 'home', home);
    } else {
      at(13 + jit(), 'work', pick(P.work)); at(22.5 + r(), 'home', home);
    }
    plan.sort((a, b) => a.h - b.h);
    return { id: i, dna, home, plan, char: null, legCache: new Map(), speed: WALK * (0.85 + r() * 0.3) };
  }

  // Where is resident `R` at world hour `h`? → {outdoor, pos, leg, dist} (T0, pure function of the clock)
  locate(R, h) {
    const plan = R.plan;
    let cur = plan.length - 1; for (let i = 0; i < plan.length; i++) if (plan[i].h <= h) cur = i;
    const now = plan[cur], prevP = plan[(cur - 1 + plan.length) % plan.length];
    const from = prevP.place, to = now.place;
    const since = (((h - now.h) + 24) % 24) * REAL_S_PER_HOUR;       // real seconds since departure
    const key = cur;
    let leg = R.legCache.get(key);
    if (!leg) { leg = from === to ? null : this.route(from.door, to.door); R.legCache.set(key, leg); }
    if (leg) {
      const d = since * R.speed;
      if (d < leg.len) return { outdoor: true, leg, dist: d, pos: sample(leg, d), act: now.act };
    }
    if (to.outdoor) return { outdoor: true, idle: true, pos: to.door.clone().add(new THREE.Vector2(((R.id * 7) % 5) - 2, ((R.id * 13) % 5) - 2)), act: now.act };
    return { outdoor: false, inside: to, act: now.act };
  }

  // ------------------------------------------------------------ runtime
  update(dt, hour, focus) {
    this.t -= dt;
    if (this.t <= 0) { this.t = 0.5; this.assign(hour, focus); }
    for (const p of this.panics) p.t -= dt;
    this.panics = this.panics.filter((p) => p.t > 0);
  }

  assign(hour, focus) {
    const cands = [];
    let outdoors = 0;
    for (const R of this.residents) {
      const L = this.locate(R, hour); R.loc = L;
      if (!L.outdoor) continue;
      outdoors++;
      const d = Math.hypot(L.pos.x - focus.x, L.pos.y - focus.z);
      if (d < this.R) cands.push([d, R]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const want = new Set(cands.slice(0, this.budget).map((c) => c[1]));
    // release characters whose resident went indoors / out of range / out of budget
    for (const c of this.pool) {
      if (c.inactive) continue;
      const R = c.resident, d = c.position.distanceTo(focus);
      if (!want.has(R) && (d > this.R + 15 || !R.loc.outdoor || c.arrived)) this.release(c);
    }
    let spawns = 2;
    for (const R of want) {
      if (R.char || spawns <= 0) continue;
      const c = this.pool.find((q) => q.inactive); if (!c) break;
      this.embody(c, R); spawns--;
    }
    this.stats.outdoors = outdoors; this.stats.embodied = this.active.length;
  }

  embody(c, R) {
    const L = R.loc;
    c.setModel(buildAvatar(R.dna));
    c.inactive = false; c.visible = true; c.collider.setEnabled(true); c.arrived = false;
    c.state = 'loco'; c.speed = 0; c.health = 100;
    c.body.setTranslation({ x: L.pos.x, y: LOT_Y + c.halfH + c.radius + 0.1, z: L.pos.y }, true);
    c.resident = R; R.char = c;
    c.ai = { leg: L.leg, i: L.leg ? Math.max(1, L.leg.cum.findIndex((v) => v > L.dist)) : 0, idle: !!L.idle, wait: 0, gait: 'walk', flee: 0, look: 0, idleYaw: Math.random() * 6.28 };
    if (c.ai.i < 0) c.ai.i = L.leg ? L.leg.pts.length - 1 : 0;
  }

  release(c) {
    if (c.state === 'ragdoll' || c.state === 'getup') return;
    if (c.resident) c.resident.char = null;
    c.resident = null; c.inactive = true; c.visible = false; c.root.visible = false; c.collider.setEnabled(false);
    c.body.setTranslation({ x: 0, y: -200, z: 0 }, true);
  }

  panic(pos, radius = 15, t = 8) {
    this.panics.push({ pos: pos.clone(), r: radius, t });
    for (const c of this.active) if (c.position.distanceTo(pos) < radius) { c.ai.flee = t; c.ai.from = pos.clone(); }
  }

  // fixed-step AI for embodied residents
  fixed(dt, vehicles, player) {
    for (const c of this.pool) {
      if (c.inactive || c.state !== 'loco') continue;
      const ai = c.ai, p = c.position;
      let dir = new THREE.Vector3(), gait = ai.gait;
      if (ai.flee > 0) {
        ai.flee -= dt;
        dir.set(p.x - ai.from.x, 0, p.z - ai.from.z).normalize(); gait = 'sprint';
        if (ai.flee <= 0) { ai.leg = null; ai.idle = false; this.t = 0; } // re-plan from the new spot
      } else if (ai.leg) {
        const tgt = ai.leg.pts[Math.min(ai.i, ai.leg.pts.length - 1)];
        const to = new THREE.Vector3(tgt.x - p.x, 0, tgt.y - p.z);
        if (to.length() < 0.9) { ai.i++; if (ai.i >= ai.leg.pts.length) { ai.leg = null; c.arrived = !c.resident?.loc?.idle; } }
        else dir.copy(to.normalize());
        gait = 'walk';
      } else if (ai.idle && (ai.wait -= dt) < 0) {
        // mill about at an outdoor spot: short walks, pauses, look around
        ai.wait = 6 + Math.random() * 10; ai.idleYaw = Math.random() * 6.28;
        const home = ai.spot || (ai.spot = new THREE.Vector2(p.x, p.z));
        const to = home.clone().add(new THREE.Vector2((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9));
        const from = new THREE.Vector2(p.x, p.z), len = from.distanceTo(to);
        ai.leg = { pts: [from, to], cum: [0, len], len }; ai.i = 1;
      } else if (!ai.leg && c.resident && c.resident.loc?.outdoor && !ai.idle && c.resident.loc.leg) {
        // re-join the scheduled route from wherever we are (after fleeing)
        const L = c.resident.loc; ai.leg = this.route(new THREE.Vector2(p.x, p.z), L.leg.pts[L.leg.pts.length - 1]); ai.i = 1;
      }
      // step aside from fast cars heading our way
      for (const v of vehicles) {
        const vv = v.velocity, sp = vv.length(); if (sp < 7) continue;
        const rel = p.clone().sub(v.position); if (rel.length() > 11) continue;
        if (rel.clone().normalize().dot(vv.clone().normalize()) > 0.7) { dir.set(-vv.z, 0, vv.x).normalize(); if (rel.dot(dir) < 0) dir.negate(); gait = 'sprint'; if (sp > 12 && !ai.flee) { ai.flee = 3; ai.from = v.position.clone(); } }
      }
      c.fixedUpdate(dt, { dir, gait, jump: false, aimYaw: dir.lengthSq() ? null : ai.idle ? ai.idleYaw : null });
    }
  }

  // T2 awareness after animation: glance at the player when close
  aware(player) {
    const pp = player.position;
    for (const c of this.pool) {
      if (c.inactive || c.state !== 'loco') continue;
      const head = c.bones.head; if (!head) continue;
      const to = pp.clone().sub(c.position), d = to.length();
      const want = d < 6 && d > 0.6 ? THREE.MathUtils.clamp(Math.atan2(to.x, to.z) - c.facing, -1.1, 1.1) : 0;
      const wr = Math.atan2(Math.sin(want), Math.cos(want));
      c.ai.look += (wr - c.ai.look) * 0.12;
      head.rotateY(c.ai.look * 0.8);
    }
  }
}

function sample(leg, d) {
  const { pts, cum } = leg;
  let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
  const k = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
  return pts[i - 1].clone().lerp(pts[i], THREE.MathUtils.clamp(k, 0, 1));
}
