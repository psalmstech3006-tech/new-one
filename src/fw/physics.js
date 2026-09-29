import RAPIER from '@dimforge/rapier3d-compat';

export let R = null;

// Collision layers (membership bits). InteractionGroups = membership << 16 | filter.
export const L = { WORLD: 1, VEHICLE: 2, CHAR: 4, RAGDOLL: 8, PROP: 16 };
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
export const ALL = 0xffff;

export async function initPhysics() {
  await RAPIER.init();
  R = RAPIER;
}

// Fixed-timestep Rapier world. Game code hooks `onFixed` for per-step control
// (vehicle controllers, character controllers) so behaviour is framerate independent.
export class Physics {
  constructor() {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.events = new R.EventQueue(true);
    this.acc = 0;
    this.ms = 0;
    this.steps = 0;
    this.fixed = [];
    this.contactHandlers = [];
    this.forceHandlers = [];
    this.handles = new Map(); // collider handle -> owner object
  }

  onFixed(fn) { this.fixed.push(fn); }
  own(collider, owner) { this.handles.set(collider.handle, owner); return collider; }
  owner(handle) { return this.handles.get(handle); }

  update(dt) {
    const h = this.world.timestep;
    this.acc += Math.min(dt, 0.1);
    const t0 = performance.now();
    this.steps = 0;
    while (this.acc >= h && this.steps < 5) {
      for (const f of this.fixed) f(h);
      this.world.step(this.events);
      this.events.drainCollisionEvents((a, b, started) => {
        for (const fn of this.contactHandlers) fn(a, b, started);
      });
      this.events.drainContactForceEvents((e) => {
        for (const fn of this.forceHandlers) fn(e);
      });
      this.acc -= h;
      this.steps++;
    }
    this.ms = performance.now() - t0;
  }

  staticBox(cx, cy, cz, hx, hy, hz, rotY = 0, friction = 0.9) {
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(cx, cy, cz)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) }));
    const col = this.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction)
      .setCollisionGroups(groups(L.WORLD, ALL)), body);
    return col;
  }

  // One fixed body at (x,y,z,rotY) carrying many local cuboids {cx,cy,cz,hx,hy,hz,rotY}.
  // Used for whole buildings/interiors so they can be streamed in and out with one call.
  staticCompound(list, x, y, z, rotY = 0, friction = 0.9) {
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(rotY / 2), z: 0, w: Math.cos(rotY / 2) }));
    for (const c of list) {
      const d = R.ColliderDesc.cuboid(Math.max(0.01, c.hx), Math.max(0.01, c.hy), Math.max(0.01, c.hz)).setFriction(friction)
        .setTranslation(c.cx, c.cy, c.cz).setCollisionGroups(groups(L.WORLD, ALL));
      if (c.rotY) d.setRotation({ x: 0, y: Math.sin(c.rotY / 2), z: 0, w: Math.cos(c.rotY / 2) });
      this.world.createCollider(d, body);
    }
    return body;
  }
  removeBody(body) { if (body) this.world.removeRigidBody(body); }

  staticTrimesh(geometry, matrix) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    const pos = g.attributes.position.array;
    const idx = new Uint32Array(pos.length / 3).map((_, i) => i);
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    return this.world.createCollider(R.ColliderDesc.trimesh(new Float32Array(pos), idx).setFriction(0.9)
      .setCollisionGroups(groups(L.WORLD, ALL)), body);
  }

  // First hit of a sphere swept from `from` along `dir` (unit) up to `len`.
  sphereCast(from, dir, len, radius, filterGroups, exclude) {
    const shape = new R.Ball(radius);
    const hit = this.world.castShape(from, { x: 0, y: 0, z: 0, w: 1 }, dir, shape, 0, len, true,
      undefined, filterGroups, exclude);
    return hit ? hit.time_of_impact : null;
  }

  // Is a point inside any collider of the given groups?
  pointInside(p, filterGroups, exclude) {
    let hit = false;
    this.world.intersectionsWithPoint(p, (c) => { if (!exclude || c.handle !== exclude.handle) { hit = true; return false; } return true; }, undefined, filterGroups);
    return hit;
  }

  // Nearest spot around `p` where an upright capsule (halfH, radius; centre at p.y) doesn't overlap WORLD.
  freeSpot(p, halfH, radius, filterGroups) {
    const shape = new R.Capsule(halfH, radius), rot = { x: 0, y: 0, z: 0, w: 1 };
    const free = (q) => { let ok = true; this.world.intersectionsWithShape(q, rot, shape, () => { ok = false; return false; }, undefined, filterGroups); return ok; };
    if (free(p)) return p;
    for (const r of [0.25, 0.5, 0.8, 1.2, 1.8, 2.5, 3.5, 4.5, 6]) for (let a = 0; a < 16; a++) {
      const q = { x: p.x + Math.cos(a * Math.PI / 8) * r, y: p.y, z: p.z + Math.sin(a * Math.PI / 8) * r };
      if (free(q)) return q;
    }
    return p;
  }

  ray(from, dir, len, filterGroups, exclude) {
    const ray = new R.Ray(from, dir);
    const hit = this.world.castRay(ray, len, true, undefined, filterGroups, exclude);
    return hit ? { toi: hit.timeOfImpact ?? hit.toi, collider: hit.collider } : null;
  }
}
