import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { R, L, groups } from './physics.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const norm = (n) => n.replace(/[^a-zA-Z0-9]/g, '').replace(/^mixamorig/, '').toLowerCase();

// Ragdoll segments on the Mixamo-spec skeleton (also what `tripo anim rig --spec mixamo` outputs).
// [bone, child bone used for length, radius, parent segment]
const SEGMENTS = [
  ['hips', 'spine', 0.14, null],
  ['spine', 'spine2', 0.13, 'hips'],
  ['spine2', 'neck', 0.15, 'spine'],
  ['head', 'headtopend', 0.11, 'spine2'],
  ['leftarm', 'leftforearm', 0.06, 'spine2'],
  ['leftforearm', 'lefthand', 0.05, 'leftarm'],
  ['rightarm', 'rightforearm', 0.06, 'spine2'],
  ['rightforearm', 'righthand', 0.05, 'rightarm'],
  ['leftupleg', 'leftleg', 0.08, 'hips'],
  ['leftleg', 'leftfoot', 0.065, 'leftupleg'],
  ['rightupleg', 'rightleg', 0.08, 'hips'],
  ['rightleg', 'rightfoot', 0.065, 'rightupleg'],
];

export const LOCO = { walk: 1.7, run: 4.6, sprint: 7.2, accel: 9, decel: 13, jump: 4.9 };

export class Character {
  constructor(game, asset, pos, opts = {}) {
    this.game = game;
    this.isPlayer = !!opts.player;
    const phys = game.physics, w = phys.world;
    // visual
    this.root = new THREE.Group();
    game.scene.add(this.root);
    this.setModel(asset);
    // physics capsule (kinematic, moved by the character controller)
    this.halfH = 0.55; this.radius = 0.3;
    this.body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + this.halfH + this.radius + 0.05, pos.z));
    this.collider = phys.own(w.createCollider(R.ColliderDesc.capsule(this.halfH, this.radius)
      .setCollisionGroups(groups(L.CHAR, L.WORLD | L.VEHICLE | L.PROP))
      .setSolverGroups(groups(L.CHAR, L.WORLD | L.PROP))
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED | R.ActiveCollisionTypes.KINEMATIC_KINEMATIC), this.body), this);
    this.skin = 0.05; // controller offset: the capsule hovers this far above surfaces
    this.cc = w.createCharacterController(this.skin);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.enableAutostep(0.35, 0.15, false);
    this.cc.enableSnapToGround(0.35);
    this.cc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.cc.setMinSlopeSlideAngle(35 * Math.PI / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(80);

    this.facing = opts.facing || 0;
    this.speed = 0;
    this.velY = 0;
    this.grounded = true;
    this.push = new THREE.Vector3();
    this.turnRate = 0;
    this.lean = 0; this.pitchLean = 0;
    this.state = 'loco'; // loco | ragdoll | getup | seated
    this.ragdoll = null;
    this.health = 100;
    this.stagger = 0;
    this.visible = true;
    this.sync(0);
  }

  // (Re)build the visual body from an asset ({scene, clips, scale}); used by the character
  // creator and for remote players whose appearance arrives over the network.
  setModel(asset) {
    if (this.state === 'ragdoll' || this.state === 'getup') return false;
    const prevShadow = this.model ? this.model.children.some((o) => o.castShadow) : true;
    if (this.model) { this.root.remove(this.model); this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.model); this.releaseModel(this.model); }
    if (this.asset && this.asset.users) this.asset.users--;
    this.asset = asset; asset.users = (asset.users || 0) + 1;
    this.model = SkeletonUtils.clone(asset.scene);
    this.model.scale.setScalar(asset.scale);
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = prevShadow; o.receiveShadow = true; o.frustumCulled = false; } });
    this.root.add(this.model);
    this.bones = {};
    this.model.traverse((o) => { if (o.isBone) this.bones[norm(o.name)] = o; });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of asset.clips) {
      const a = this.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); this.actions[clip.name.toLowerCase()] = a;
    }
    this.shadowOn = undefined;
    return true;
  }

  // Cloned skeletons own a GPU bone texture; free it when a body is swapped or removed.
  releaseModel(model) { model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); }

  // Remove the character from the world (remote players leaving, pooled NPC teardown).
  dispose() {
    const P = this.game.physics, w = P.world;
    if (this.ragdoll) { for (const { body } of Object.values(this.ragdoll.parts)) w.removeRigidBody(body); this.ragdoll = null; }
    P.disown(this.collider);
    w.removeCharacterController(this.cc);
    w.removeRigidBody(this.body);
    this.mixer?.stopAllAction(); this.mixer?.uncacheRoot(this.model); this.releaseModel(this.model);
    if (this.asset?.users) this.asset.users--;
    this.root.traverse((o) => { if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } });
    this.game.scene.remove(this.root);
    this.disposed = true;
  }

  // Where the camera should look: the ragdoll's hips while ragdolled, else the capsule.
  get focus() {
    if (this.state === 'ragdoll' && this.ragdoll?.parts.hips) { const t = this.ragdoll.parts.hips.body.translation(); return new THREE.Vector3(t.x, t.y - 0.9, t.z); }
    return this.position;
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y - this.halfH - this.radius - this.skin * 0.9, t.z); }
  get head() { return this.position.add(new THREE.Vector3(0, 1.62, 0)); }
  get velocity() { return new THREE.Vector3(Math.sin(this.facing) * this.speed, this.velY, Math.cos(this.facing) * this.speed).add(this.push); }

  // move: {dir: world-space Vector3 (length 0..1), gait: 'walk'|'run'|'sprint', jump, aimYaw}
  fixedUpdate(dt, move) {
    if (this.state !== 'loco') return;
    const mag = Math.min(1, move.dir.length());
    const target = mag * LOCO[move.gait || 'run'];
    const want = mag > 0.05 ? Math.atan2(move.dir.x, move.dir.z) : this.facing;
    let diff = wrap(want - this.facing);
    if (move.aimYaw != null) diff = wrap(move.aimYaw - this.facing);
    // pivot: sharp reversals at speed brake first instead of spinning on the spot
    const reversing = Math.abs(diff) > 2.2 && this.speed > 3 && move.aimYaw == null;
    const maxTurn = THREE.MathUtils.lerp(11, 4.2, THREE.MathUtils.clamp(this.speed / LOCO.sprint, 0, 1)) * dt;
    const turn = reversing ? 0 : THREE.MathUtils.clamp(diff, -maxTurn, maxTurn);
    this.facing = wrap(this.facing + turn);
    this.turnRate = THREE.MathUtils.lerp(this.turnRate, turn / dt, 0.2);
    const goal = reversing ? 0 : target * Math.max(0, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)) * 0.6 + 0.4);
    const rate = goal > this.speed ? LOCO.accel : LOCO.decel;
    this.speed += THREE.MathUtils.clamp(goal - this.speed, -rate * dt, rate * dt);
    this.accel = (goal - this.speed);

    if (this.grounded && move.jump) { this.velY = LOCO.jump; this.grounded = false; }
    this.velY -= 9.81 * 1.6 * dt;
    // strafing while aiming: move along input dir, keep facing the aim
    const moveDir = move.aimYaw != null && mag > 0.05 ? move.dir.clone().normalize() : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const hs = move.aimYaw != null ? Math.min(this.speed, 2.2) : this.speed;
    const delta = moveDir.multiplyScalar(hs * dt).add(this.push.clone().multiplyScalar(dt));
    // grounded: only a tiny stick-down (snap-to-ground handles slopes); pushing into the
    // floor every step makes Rapier's controller swallow the horizontal movement
    delta.y = this.grounded && this.velY <= 0 ? -0.005 : this.velY * dt;
    this.push.multiplyScalar(Math.exp(-5 * dt));
    this.cc.computeColliderMovement(this.collider, delta, R.QueryFilterFlags.EXCLUDE_SENSORS, groups(L.CHAR, L.WORLD | L.VEHICLE | L.PROP));
    const m = this.cc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    const wasAir = !this.grounded;
    this.grounded = this.cc.computedGrounded();
    if (this.grounded) { if (wasAir && this.velY < -9) this.hurt((-this.velY - 9) * 12, UP.clone()); this.velY = Math.max(this.velY, -1); }
    // blocked by a wall: bleed off speed
    if (hs > 0.5 && Math.hypot(m.x, m.z) < hs * dt * 0.3) this.speed *= 0.8;
  }

  hurt(amount, dir) {
    this.health -= amount;
    if (this.health <= 0) this.goRagdoll(dir.clone().multiplyScalar(2), true);
  }

  // Physical reaction dispatcher: small hits stagger, big ones ragdoll.
  knock(impulseVel) {
    const s = impulseVel.length();
    if (this.state === 'seated') return;
    if (s > 3.2) { this.goRagdoll(impulseVel); return; }
    this.push.add(impulseVel);
    this.stagger = Math.min(1, this.stagger + s / 3);
  }

  goRagdoll(vel, dead = false) {
    if (this.state === 'ragdoll' || this.state === 'seated') return;
    this.dead = dead || this.dead;
    const w = this.game.physics.world;
    this.model.updateMatrixWorld(true);
    const parts = {};
    const baseVel = this.velocity.add(vel);
    for (const [name, childName, rad, parentName] of SEGMENTS) {
      const bone = this.bones[name], child = this.bones[childName];
      if (!bone || !child) continue;
      const p = bone.getWorldPosition(new THREE.Vector3()), q = bone.getWorldQuaternion(new THREE.Quaternion());
      const cp = child.getWorldPosition(new THREE.Vector3());
      const len = Math.max(0.08, p.distanceTo(cp));
      const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(q)
        .setLinvel(baseVel.x, baseVel.y, baseVel.z).setLinearDamping(0.1).setAngularDamping(1.2).setCcdEnabled(true));
      // capsule from the bone origin toward the child, expressed in the bone frame
      const localDir = cp.clone().sub(p).applyQuaternion(q.clone().invert()).normalize();
      const rot = new THREE.Quaternion().setFromUnitVectors(UP, localDir);
      const half = Math.max(0.01, len / 2 - rad);
      w.createCollider(R.ColliderDesc.capsule(half, rad).setTranslation(localDir.x * len / 2, localDir.y * len / 2, localDir.z * len / 2)
        .setRotation(rot).setDensity(name === 'hips' || name.startsWith('spine') ? 1100 : 900).setFriction(0.8)
        .setCollisionGroups(groups(L.RAGDOLL, L.WORLD | L.VEHICLE | L.PROP)), body);
      parts[name] = { bone, body };
      if (parentName && parts[parentName]) {
        const pb = parts[parentName];
        const pp = pb.bone.getWorldPosition(new THREE.Vector3()), pq = pb.bone.getWorldQuaternion(new THREE.Quaternion());
        const a1 = p.clone().sub(pp).applyQuaternion(pq.clone().invert());
        const j = R.JointData.spherical(a1, { x: 0, y: 0, z: 0 });
        w.createImpulseJoint(j, pb.body, body, true);
      }
    }
    this.ragdoll = { parts, t: 0, still: 0 };
    this.state = 'ragdoll';
    this.collider.setEnabled(false);
    for (const a of Object.values(this.actions)) a.setEffectiveWeight(0);
    // a weak protective reflex: arms come forward/out while falling
    this.ragdoll.reflex = true;
  }

  updateRagdoll(dt) {
    const rd = this.ragdoll;
    rd.t += dt;
    // drive bones from bodies (world -> local)
    const pq = new THREE.Quaternion();
    for (const [name, { bone, body }] of Object.entries(rd.parts)) {
      const r = body.rotation(), t = body.translation();
      const wq = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      bone.parent.getWorldQuaternion(pq);
      bone.quaternion.copy(pq.invert().multiply(wq));
      if (name === 'hips') bone.position.copy(bone.parent.worldToLocal(new THREE.Vector3(t.x, t.y, t.z)));
      bone.updateMatrixWorld(true);
    }
    // protective reflex: gently rotate upper arms toward the fall direction while airborne
    const hips = rd.parts.hips.body, hv = hips.linvel();
    const speed = Math.hypot(hv.x, hv.y, hv.z);
    if (rd.reflex && rd.t < 1.2 && speed > 1.5) {
      for (const n of ['leftarm', 'rightarm']) {
        const p = rd.parts[n]; if (!p) continue;
        const av = p.body.angvel();
        p.body.setAngvel({ x: av.x * 0.9 + hv.z * 0.15, y: av.y * 0.9, z: av.z * 0.9 - hv.x * 0.15 }, true);
      }
    }
    rd.still = speed < 0.35 ? rd.still + dt : 0;
    if (!this.dead && (rd.still > 0.8 || rd.t > 6)) this.getUp();
  }

  getUp() {
    const rd = this.ragdoll, w = this.game.physics.world;
    const hips = rd.parts.hips.body.translation();
    const hq = rd.parts.hips.body.rotation();
    // lying face up or face down decides the recovery direction
    const hipFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(hq.x, hq.y, hq.z, hq.w));
    this.facing = Math.atan2(hipFwd.x, hipFwd.z);
    for (const { body } of Object.values(rd.parts)) w.removeRigidBody(body);
    this.ragdoll = null;
    this.collider.setEnabled(true);
    // stand up where the capsule fits (a body lying against a wall must not end up inside it)
    const phys = this.game.physics;
    const floor = phys.ray({ x: hips.x, y: hips.y + 0.5, z: hips.z }, { x: 0, y: -1, z: 0 }, 3, groups(L.CHAR, L.WORLD));
    const fy = floor ? hips.y + 0.5 - floor.toi : Math.max(hips.y - 0.9, 0);
    const spot = phys.freeSpot({ x: hips.x, y: fy + this.halfH + this.radius + 0.06, z: hips.z }, this.halfH, this.radius, groups(L.CHAR, L.WORLD));
    this.body.setTranslation(spot, true);
    this.body.setNextKinematicTranslation(spot);
    if (Math.hypot(spot.x - hips.x, spot.z - hips.z) > 0.5) this.onTeleport?.(); // tell the server this jump is legitimate
    this.speed = 0; this.push.set(0, 0, 0); this.velY = 0;
    this.state = 'getup';
    this.getupT = 0;
    // pose snapshot so the recovery blends out of the ragdoll pose instead of popping
    this.snapshot = Object.values(this.bones).map((b) => [b, b.quaternion.clone()]);
  }

  sync(dt) {
    const pos = this.position;
    this.root.position.copy(pos);
    this.root.visible = this.visible;
    if (this.state === 'ragdoll') { this.updateRagdoll(dt); this.root.position.set(0, 0, 0); this.model.position.set(0, 0, 0); return; }
    this.root.rotation.y = this.facing;
    // animation blend by speed with stride-matched playback rates
    const s = this.speed;
    const wIdle = THREE.MathUtils.clamp(1 - s / 1.1, 0, 1);
    const wWalk = s < LOCO.walk ? THREE.MathUtils.clamp(s / 1.1, 0, 1) : THREE.MathUtils.clamp(1 - (s - LOCO.walk) / 2.2, 0, 1);
    const wRun = THREE.MathUtils.clamp((s - LOCO.walk) / 2.2, 0, 1);
    const a = this.actions;
    if (a.idle) a.idle.setEffectiveWeight(wIdle);
    if (a.walk) { a.walk.setEffectiveWeight(wWalk); a.walk.timeScale = THREE.MathUtils.clamp(s / 1.45, 0.6, 1.6); }
    if (a.run) { a.run.setEffectiveWeight(wRun); a.run.timeScale = THREE.MathUtils.clamp(s / 4.2, 0.8, 1.6); }
    if (this.state === 'getup') {
      this.getupT += dt;
      const k = Math.min(1, this.getupT / 0.7);
      this.mixer.update(dt);
      for (const [b, q] of this.snapshot) b.quaternion.slerpQuaternions(q, b.quaternion.clone(), k);
      if (k >= 1) this.state = 'loco';
    } else if (this.state === 'loco') {
      this.mixer.update(dt);
    }
    // procedural lean: bank into turns, tip forward when accelerating, stagger wobble
    const targetLean = THREE.MathUtils.clamp(-this.turnRate * s * 0.028, -0.28, 0.28);
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 8);
    this.pitchLean += (THREE.MathUtils.clamp((this.accel || 0) * 0.03, -0.1, 0.12) - this.pitchLean) * Math.min(1, dt * 6);
    this.stagger = Math.max(0, this.stagger - dt * 1.5);
    const wob = this.stagger * Math.sin(performance.now() / 70) * 0.18;
    this.model.rotation.set(this.pitchLean + this.stagger * 0.15, 0, this.lean + wob);
  }

  dispose() {
    const w = this.game.physics.world;
    if (this.ragdoll) for (const { body } of Object.values(this.ragdoll.parts)) w.removeRigidBody(body);
    w.removeCharacterController(this.cc);
    w.removeRigidBody(this.body);
    this.game.scene.remove(this.root);
  }
}
