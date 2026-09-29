import * as THREE from 'three';
import { L, groups } from './physics.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Critically damped spring (per component) — smooth follow without overshoot.
function spring(x, v, target, omega, dt) {
  const f = 1 + 2 * dt * omega, oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo;
  const det = 1 / (f + hhoo);
  const nx = det * (f * x + dt * v + hhoo * target);
  const nv = det * (v + hoo * (target - x));
  return [nx, nv];
}

// Camera states (spec §4). Parameters blend when the state changes.
const STATES = {
  explore: { height: 1.55, shoulder: 0.42, dist: 3.4, fov: 62, lag: 9, pitchMin: -1.2, pitchMax: 1.0 },
  aim:     { height: 1.5, shoulder: 0.62, dist: 1.55, fov: 46, lag: 22, pitchMin: -1.2, pitchMax: 1.1 },
  sprint:  { height: 1.5, shoulder: 0.35, dist: 3.9, fov: 68, lag: 8, pitchMin: -1.2, pitchMax: 1.0 },
  vehicle: { height: 1.35, shoulder: 0, dist: 6.2, fov: 60, lag: 7, pitchMin: -0.9, pitchMax: 0.9 },
  interior:{ height: 1.5, shoulder: 0.35, dist: 2.3, fov: 58, lag: 12, pitchMin: -1.1, pitchMax: 1.0 },
  first:   { height: 1.66, shoulder: 0, dist: 0, fov: 72, lag: 40, pitchMin: -1.4, pitchMax: 1.4 },
};
const DIST_STEPS = [0.75, 1, 1.4];

export class CameraRig {
  constructor(camera, physics) {
    this.cam = camera;
    this.physics = physics;
    this.yaw = Math.PI; this.pitch = -0.18;
    this.state = 'explore';
    this.p = { ...STATES.explore };
    this.pivot = new THREE.Vector3(); this.pivotV = new THREE.Vector3();
    this.curDist = 3; this.distStep = 1;
    this.shoulderSide = 1;
    this.idleLook = 0;
    this.lookBehind = false;
    this.shake = 0;
  }

  setState(s) { if (STATES[s]) this.state = s; }
  cycleDistance() { this.distStep = (this.distStep + 1) % DIST_STEPS.length; }
  swapShoulder() { this.shoulderSide *= -1; }

  look(dx, dy) {
    this.yaw -= dx * 0.0023;
    const p = this.p;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0023, p.pitchMin, p.pitchMax);
    if (dx || dy) this.idleLook = 0;
  }

  get forward() { return new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)); }
  get flatForward() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get flatRight() { return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)); }

  // target: {pos: Vector3 (feet or vehicle origin), vehicle?, exclude collider, headPos?}
  update(dt, target) {
    const S = STATES[this.state];
    // blend state parameters
    const k = Math.min(1, dt * 7);
    for (const key of Object.keys(S)) this.p[key] += (S[key] - this.p[key]) * k;
    const p = this.p;
    this.idleLook += dt;

    let pivotTarget;
    if (target.vehicle) {
      const v = target.vehicle;
      const vel = v.velocity; vel.y = 0;
      const speed = vel.length();
      pivotTarget = v.position.add(new THREE.Vector3(0, p.height, 0));
      // chase direction blends from vehicle nose to velocity as speed rises; free look when slow
      if (this.idleLook > 1.0 && speed > 2) {
        const nose = v.forward; nose.y = 0; nose.normalize();
        const dir = speed > 6 ? nose.clone().lerp(vel.normalize(), THREE.MathUtils.clamp((speed - 6) / 20, 0, 0.6)) : nose;
        const want = Math.atan2(dir.x, dir.z);
        const follow = THREE.MathUtils.clamp(speed / 12, 0.4, 3.5);
        this.yaw += wrap(want - this.yaw) * Math.min(1, dt * follow);
        this.pitch += (-0.16 - this.pitch) * Math.min(1, dt * 1.5);
      }
      this.targetDist = (v.H.dims[2] * 0.9 + 2.6) * DIST_STEPS[this.distStep] + Math.min(1.5, speed * 0.03);
      this.fovBoost = Math.min(14, speed * 0.28);
      this.shake = Math.max(this.shake, Math.min(0.25, (speed - 20) / 120) * (v.skid + 0.3));
    } else {
      const shoulder = p.shoulder * this.shoulderSide;
      pivotTarget = target.pos.clone().add(new THREE.Vector3(0, p.height, 0)).addScaledVector(this.flatRight, -shoulder);
      this.targetDist = p.dist * (this.state === 'explore' ? DIST_STEPS[this.distStep] : 1);
      this.fovBoost = 0;
    }
    // spring-follow the pivot (camera lag)
    for (const a of ['x', 'y', 'z']) {
      const [x, v] = spring(this.pivot[a], this.pivotV[a], pivotTarget[a], p.lag, dt);
      this.pivot[a] = x; this.pivotV[a] = v;
    }
    if (this.state === 'first') this.pivot.copy(target.headPos || pivotTarget);

    let yaw = this.yaw;
    if (this.lookBehind) yaw += Math.PI;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(yaw) * Math.cos(this.pitch));

    // collision: sphere-cast from pivot back to the desired position; snap in fast, ease out slowly
    let want = this.targetDist;
    if (want > 0.05) {
      const back = dir.clone().negate();
      const toi = this.physics.sphereCast(this.pivot, back, want, 0.22, groups(L.CHAR, L.WORLD | L.VEHICLE), target.exclude);
      if (toi != null) want = Math.max(0.35, toi - 0.05);
    }
    this.curDist = want < this.curDist ? want : this.curDist + (want - this.curDist) * Math.min(1, dt * 2.5);

    const camPos = this.pivot.clone().addScaledVector(dir, -this.curDist);
    this.cam.position.copy(camPos);
    this.cam.lookAt(camPos.clone().add(dir));
    if (this.shake > 0.001) {
      const s = this.shake * 0.02;
      this.cam.rotation.x += (Math.random() - 0.5) * s; this.cam.rotation.y += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-6 * dt);
    }
    const fov = p.fov + (this.fovBoost || 0);
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    // report how close the camera is so the player can be faded out if it clips
    return this.curDist;
  }
}
