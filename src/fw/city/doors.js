import * as THREE from 'three';
import { R, L, groups, ALL } from '../physics.js';
import { cityMaterials } from './materials.js';

// ============================================================================
// Doors: hinged leaves with kinematic colliders that follow the leaf, so an opening door
// pushes and blocks correctly. Leaves of every style are drawn with a handful of
// InstancedMeshes (one draw call per part type for the whole city).
//   states: closed / opening / open / closing, plus locked (needs a key from the key ring)
// ============================================================================

const OPEN_ANGLE = 1.62;          // ~93°
const SPEED = 2.6;                // rad/s
const AUTO_CLOSE = 6;             // seconds after the player walks away
const unitBox = (() => { const g = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0); g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; })();

class Parts {
  constructor(scene, mat, cap, shadow = true) {
    this.mesh = new THREE.InstancedMesh(unitBox, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.castShadow = shadow; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.cap = cap; this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  push(m4, color) { if (this.n >= this.cap) return; this.mesh.setMatrixAt(this.n, m4); if (color) this.mesh.setColorAt(this.n, color); this.n++; }
  end() { this.mesh.count = this.n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
}

const STYLE = { wood: '#6b4a33', glass: '#2b2e33', bars: '#3a3d42', metal: '#8d949b' };

export class DoorSystem {
  constructor(game) {
    this.game = game;
    const M = cityMaterials(), s = game.scene;
    this.parts = { slab: new Parts(s, M.wood, 1024), frame: new Parts(s, M.frame, 4096), glass: new Parts(s, M.glassClear, 1024, false), bars: new Parts(s, M.metal, 2048) };
    this.doors = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._c = new THREE.Color();
    this.dirty = true;
  }

  // rec: door record in building-local space; xf: {x,y,z,rot} building transform; owner tags streamed doors
  add(rec, xf, owner = null) {
    const c = Math.cos(xf.rot), s = Math.sin(xf.rot);
    const toW = (v) => new THREE.Vector3(xf.x + v[0] * c + v[2] * s, xf.y + (v[1] || 0), xf.z - v[0] * s + v[2] * c);
    const dirW = (v) => new THREE.Vector3(v[0] * c + v[2] * s, 0, -v[0] * s + v[2] * c);
    const hinge = toW(rec.hinge), u = dirW(rec.u), n = dirW(rec.normal);
    const double = rec.kind === 'double';
    const leafW = double ? rec.w / 2 : rec.w;
    const door = {
      rec, owner, label: rec.label || 'Door', locked: !!rec.locked, keyId: rec.keyId, interactive: rec.interactive !== false,
      style: rec.style || 'wood', h: rec.h - 0.02, normal: n, open: 0, target: 0, idle: 0, swing: 1,
      center: hinge.clone().addScaledVector(u, rec.w / 2).setY(hinge.y + 1.1), leaves: [],
    };
    const mk = (h0, dir, flip) => {
      const theta0 = Math.atan2(-dir.z, dir.x);
      const perp = new THREE.Vector3(-Math.sin(theta0), 0, -Math.cos(theta0));
      const inward = perp.dot(n) < 0 ? 1 : -1; // positive rotation that swings the leaf to -normal
      const body = this.game.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(h0.x, h0.y, h0.z)
        .setRotation({ x: 0, y: Math.sin(theta0 / 2), z: 0, w: Math.cos(theta0 / 2) }));
      this.game.physics.world.createCollider(R.ColliderDesc.cuboid(leafW / 2 - 0.02, door.h / 2, 0.035).setTranslation(leafW / 2, door.h / 2 + 0.01, 0)
        .setCollisionGroups(groups(L.WORLD, ALL)), body);
      door.leaves.push({ hinge: h0, theta0, inward, body, w: leafW, flip });
    };
    mk(hinge, u, false);
    if (double) mk(hinge.clone().addScaledVector(u, rec.w), u.clone().negate(), true);
    this.doors.push(door);
    this.dirty = true;
    return door;
  }

  removeOwner(owner) {
    const keep = [];
    for (const d of this.doors) {
      if (d.owner === owner) for (const l of d.leaves) this.game.physics.world.removeRigidBody(l.body);
      else keep.push(d);
    }
    this.doors = keep; this.dirty = true;
  }

  // Nearest interactive door the player is facing/near.
  nearest(pos, reach = 1.7) {
    let best = null, bd = reach;
    for (const d of this.doors) {
      if (!d.interactive) continue;
      const dy = pos.y + 0.9 - d.center.y; if (Math.abs(dy) > 1.4) continue;
      const dist = Math.hypot(pos.x - d.center.x, pos.z - d.center.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }

  prompt(d, keys) {
    if (d.target > 0) return `E: close ${d.label}`;
    if (d.locked) return keys.has(d.keyId) ? `E: unlock ${d.label}` : `${d.label} — locked`;
    return `E: open ${d.label}` + (d.keyId && keys.has(d.keyId) ? '   K: lock' : '');
  }

  use(d, pos, keys) {
    if (d.target > 0) { d.target = 0; return 'close'; }
    if (d.locked) {
      if (!keys.has(d.keyId)) return 'locked';
      d.locked = false;
    }
    // swing away from whoever opens it
    const side = pos.clone().sub(d.center).dot(d.normal);
    d.swing = side >= 0 ? 1 : -1;
    d.target = 1; d.idle = 0;
    return 'open';
  }

  toggleLock(d, keys) {
    if (!d.keyId || !keys.has(d.keyId) || d.target > 0 || d.open > 0.02) return false;
    d.locked = !d.locked; return true;
  }

  update(dt, playerPos) {
    let moved = this.dirty;
    for (const d of this.doors) {
      if (d.target > 0 && playerPos) {
        d.idle = playerPos.distanceTo(d.center) > 4 ? d.idle + dt : 0;
        if (d.idle > AUTO_CLOSE) d.target = 0;
      }
      if (d.open === d.target) continue;
      const step = SPEED * dt / OPEN_ANGLE;
      d.open = d.target > d.open ? Math.min(d.target, d.open + step) : Math.max(d.target, d.open - step);
      const e = d.open * d.open * (3 - 2 * d.open); // eased
      for (const l of d.leaves) {
        const th = l.theta0 + l.inward * d.swing * e * OPEN_ANGLE;
        l.body.setNextKinematicRotation({ x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) });
        l.theta = th;
      }
      moved = true;
    }
    if (!moved) return;
    this.dirty = false;
    const P = this.parts, m = this._m, q = this._q, c = this._c;
    for (const p of Object.values(P)) p.begin();
    const part = (l, h, ox, oy, oz, sx, sy, sz) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, l.theta ?? l.theta0);
      const off = new THREE.Vector3(ox, oy, oz).applyQuaternion(q);
      m.compose(l.hinge.clone().add(off), q, new THREE.Vector3(sx, sy, sz));
      return m;
    };
    for (const d of this.doors) for (const l of d.leaves) {
      const w = l.w, h = d.h, knobX = w - 0.12;
      if (d.style === 'glass') {
        P.frame.push(part(l, h, 0.02, 0.01, 0, 0.09, h, 0.06), c.set(STYLE.glass));
        P.frame.push(part(l, h, w - 0.11, 0.01, 0, 0.09, h, 0.06), c.set(STYLE.glass));
        P.frame.push(part(l, h, 0.02, h - 0.09, 0, w - 0.04, 0.09, 0.06), c.set(STYLE.glass));
        P.frame.push(part(l, h, 0.02, 0.01, 0, w - 0.04, 0.22, 0.06), c.set(STYLE.glass));
        P.glass.push(part(l, h, 0.1, 0.22, 0, w - 0.2, h - 0.3, 0.02), c.set('#ffffff'));
        for (const zz of [0.05, -0.05]) P.frame.push(part(l, h, knobX - 0.1, 0.8, zz, 0.03, 0.6, 0.03), c.set('#c9ccd0'));
      } else if (d.style === 'bars') {
        for (let x = 0.06; x < w - 0.02; x += 0.13) P.bars.push(part(l, h, x, 0.01, 0, 0.035, h, 0.035), c.set(STYLE.bars));
        for (const y of [0.05, h * 0.5, h - 0.06]) P.bars.push(part(l, h, 0.02, y, 0, w - 0.04, 0.05, 0.05), c.set(STYLE.bars));
      } else {
        P.slab.push(part(l, h, 0.01, 0.01, 0, w - 0.02, h - 0.01, 0.05), c.set(d.rec.color || STYLE.wood));
        for (const zz of [0.045, -0.045]) P.frame.push(part(l, h, knobX, 0.98, zz, 0.12, 0.03, 0.03), c.set('#c9b27a'));
      }
    }
    for (const p of Object.values(P)) p.end();
  }
}
