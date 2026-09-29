import * as THREE from 'three';
import { R, L, groups, ALL } from './physics.js';

// Handling data, one row per model. Values are Free World's own; the concepts
// (traction, suspension, anti-roll, brake bias, drive bias) follow spec §5.
export const HANDLING = {
  coupe: {
    name: 'Ardent GT', mass: 1350, dims: [1.86, 1.32, 4.45], wheelR: 0.34, wheelW: 0.25, wheelbase: 2.65, track: 1.58,
    susRest: 0.32, susTravel: 0.22, susStiff: 38, susComp: 3.2, susRelax: 4.2, antiRoll: 2600,
    gripFront: 1.45, gripRear: 1.38, sideStiff: 1.0, handbrakeGrip: 0.45,
    drive: 'rwd', torque: 380, redline: 7200, idle: 900, gears: [3.2, 2.1, 1.5, 1.15, 0.92, 0.76], finalDrive: 3.7, cdA: 0.62,
    brake: 42, brakeBias: 0.62, handbrake: 70, steerLock: 0.58, comY: -0.08,
    profile: { hood: 0.78, belt: 0.92, roofF: -0.05, roofR: -0.9, roof: 1.3, trunk: 0.95, ws: 0.6, rear: -1.4 },
  },
  sedan: {
    name: 'Meridian', mass: 1480, dims: [1.84, 1.46, 4.7], wheelR: 0.33, wheelW: 0.23, wheelbase: 2.8, track: 1.56,
    susRest: 0.34, susTravel: 0.24, susStiff: 30, susComp: 2.8, susRelax: 3.8, antiRoll: 1800,
    gripFront: 1.32, gripRear: 1.38, sideStiff: 1.0, handbrakeGrip: 0.5,
    drive: 'fwd', torque: 300, redline: 6500, idle: 800, gears: [3.4, 2.0, 1.35, 1.0, 0.8], finalDrive: 3.9, cdA: 0.68,
    brake: 38, brakeBias: 0.66, handbrake: 60, steerLock: 0.6, comY: -0.02,
    profile: { hood: 0.8, belt: 0.95, roofF: 0.35, roofR: -1.05, roof: 1.42, trunk: 0.98, ws: 0.95, rear: -1.6 },
  },
  meridian: {
    name: 'Meridian', model: 'fw_veh_sedan_meridian', mass: 1380, dims: [1.9, 1.45, 4.55], wheelR: 0.34, wheelW: 0.22, wheelbase: 2.56, track: 1.36,
    susRest: 0.34, susTravel: 0.24, susStiff: 30, susComp: 2.8, susRelax: 3.8, antiRoll: 1800,
    gripFront: 1.32, gripRear: 1.38, sideStiff: 1.0, handbrakeGrip: 0.5,
    drive: 'fwd', torque: 290, redline: 6400, idle: 800, gears: [3.4, 2.0, 1.35, 1.0, 0.8], finalDrive: 3.9, cdA: 0.7,
    brake: 38, brakeBias: 0.66, handbrake: 60, steerLock: 0.6, comY: -0.02,
    profile: { hood: 0.8, belt: 0.95, roofF: 0.35, roofR: -1.05, roof: 1.42, trunk: 0.98, ws: 0.95, rear: -1.6 },
  },
  suv: {
    name: 'Ridgeback', mass: 2100, dims: [1.95, 1.8, 4.8], wheelR: 0.38, wheelW: 0.26, wheelbase: 2.85, track: 1.64,
    susRest: 0.42, susTravel: 0.3, susStiff: 26, susComp: 2.6, susRelax: 3.4, antiRoll: 2400,
    gripFront: 1.18, gripRear: 1.18, sideStiff: 0.95, handbrakeGrip: 0.55,
    drive: 'awd', torque: 520, redline: 6000, idle: 750, gears: [3.6, 2.2, 1.45, 1.0, 0.78], finalDrive: 3.9, cdA: 0.95,
    brake: 50, brakeBias: 0.64, handbrake: 70, steerLock: 0.56, comY: 0.12,
    profile: { hood: 1.1, belt: 1.22, roofF: 0.75, roofR: -2.1, roof: 1.78, trunk: 1.7, ws: 1.25, rear: -2.35 },
  },
};

// ---------------------------------------------------------------- visuals
const paintMat = (color) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
const GLASS = new THREE.MeshPhysicalMaterial({ color: '#0f161d', metalness: 0.9, roughness: 0.05, clearcoat: 1 });
const TRIM = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.6, metalness: 0.2 });
const CHROME = new THREE.MeshStandardMaterial({ color: '#d7dade', roughness: 0.12, metalness: 1 });
const RUBBER = new THREE.MeshStandardMaterial({ color: '#131313', roughness: 0.92 });
const RIM = new THREE.MeshStandardMaterial({ color: '#b9bec4', roughness: 0.25, metalness: 0.95 });
const HEAD = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: '#fff5d6', emissiveIntensity: 0.6, roughness: 0.1 });
const TAIL = new THREE.MeshStandardMaterial({ color: '#5c0707', emissive: '#ff2020', emissiveIntensity: 0.5, roughness: 0.2 });

// Side-silhouette extrusion: rounded body with real wheel arches and a tapered greenhouse.
function buildBody(H, color) {
  const [W, , Lh] = H.dims, p = H.profile, r = H.wheelR;
  const L2 = Lh / 2, ax = H.wheelbase / 2, arch = r + 0.07, sill = r * 0.9;
  const s = new THREE.Shape();
  s.moveTo(-L2, sill + 0.05);
  s.lineTo(-ax - arch, sill);
  s.absarc(-ax, r, arch, Math.PI, 0, true);
  s.lineTo(ax - arch, sill);
  s.absarc(ax, r, arch, Math.PI, 0, true);
  s.lineTo(L2 - 0.05, sill + 0.04);
  s.quadraticCurveTo(L2 + 0.04, sill + 0.2, L2, p.hood - 0.2);
  s.quadraticCurveTo(L2 - 0.05, p.hood, L2 - 0.4, p.hood + 0.02);
  s.lineTo(p.ws, p.belt);
  s.lineTo(p.rear, p.trunk);
  s.quadraticCurveTo(-L2 + 0.05, p.trunk, -L2, p.trunk - 0.25);
  s.lineTo(-L2, sill + 0.05);
  const bevel = 0.07;
  const body = new THREE.ExtrudeGeometry(s, { depth: W - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.06, bevelSegments: 4, curveSegments: 16 });
  body.translate(0, 0, -(W - bevel * 2) / 2);
  body.rotateY(-Math.PI / 2);

  const g = new THREE.Shape();
  g.moveTo(p.ws + 0.05, p.belt - 0.02);
  g.lineTo(p.roofF, p.roof);
  g.lineTo(p.roofR, p.roof - 0.02);
  g.lineTo(p.rear + 0.05, p.trunk - 0.02);
  g.lineTo(p.ws + 0.05, p.belt - 0.02);
  const gw = W - 0.26;
  const glass = new THREE.ExtrudeGeometry(g, { depth: gw, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 2 });
  glass.translate(0, 0, -gw / 2);
  glass.rotateY(-Math.PI / 2);
  // tumblehome: pull the upper greenhouse inwards
  const gp = glass.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const y = gp.getY(i), k = THREE.MathUtils.clamp((y - p.belt) / (p.roof - p.belt), 0, 1);
    gp.setX(i, gp.getX(i) * (1 - 0.14 * k));
  }
  glass.computeVertexNormals();
  // roof skin in body colour over the glass
  const roofG = new THREE.BoxGeometry(gw * 0.84, 0.04, Math.abs(p.roofF - p.roofR) * 0.92);
  roofG.translate(0, p.roof + 0.03, (p.roofF + p.roofR) / 2);

  const group = new THREE.Group();
  const paint = paintMat(color);
  const bodyM = new THREE.Mesh(body, paint); bodyM.castShadow = true; bodyM.receiveShadow = true;
  const glassM = new THREE.Mesh(glass, GLASS); glassM.castShadow = true;
  const roofM = new THREE.Mesh(roofG, paint); roofM.castShadow = true;
  group.add(bodyM, glassM, roofM);
  // lights, grille, bumpers, mirrors
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.28, 4, 8).rotateZ(Math.PI / 2), HEAD);
    hl.position.set(sx * (W / 2 - 0.3), p.hood - 0.2, L2 - 0.02); group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.09, 0.05), TAIL);
    tl.position.set(sx * (W / 2 - 0.3), p.trunk - 0.14, -L2 - 0.02); group.add(tl);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.08), paint);
    mir.position.set(sx * (W / 2 + 0.05), p.belt + 0.08, p.ws - 0.15); group.add(mir);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.45, 0.14, 0.04), TRIM);
  grille.position.set(0, p.hood - 0.3, L2 + 0.02); group.add(grille);
  for (const z of [L2 + 0.03, -L2 - 0.03]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, 0.12, 0.08), TRIM);
    b.position.set(0, sill + 0.12, z); group.add(b);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: '#eceae2', roughness: 0.5 }));
  plate.position.set(0, sill + 0.28, -L2 - 0.05); group.add(plate);
  group.userData.deformables = [bodyM];
  return group;
}

function buildWheel(r, w) {
  const g = new THREE.Group();
  // rounded tyre via lathe profile
  const pts = [];
  const sw = w / 2;
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; pts.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, Math.sin(a) * sw)); }
  pts.unshift(new THREE.Vector2(r * 0.64, -sw)); pts.push(new THREE.Vector2(r * 0.64, sw));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), RUBBER);
  tyre.rotation.z = Math.PI / 2; tyre.castShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.64, r * 0.64, w * 0.8, 24), RIM);
  rim.rotation.z = Math.PI / 2;
  const hub = new THREE.Group();
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 1.15, 0.06), CHROME);
    sp.rotation.x = (k / 5) * Math.PI * 2; sp.position.x = w * 0.42; hub.add(sp);
  }
  const spin = new THREE.Group(); spin.add(tyre, rim, hub);
  g.add(spin);
  g.userData.spin = spin; g.userData.hub = hub;
  return g;
}

// ---------------------------------------------------------------- vehicle
export class Vehicle {
  constructor(game, type, pos, heading = 0, color = '#8e1b1b') {
    this.game = game;
    const model = HANDLING[type].model ? game.models?.[HANDLING[type].model] : null;
    // generated models define their own wheel layout and footprint
    this.H = model ? { ...HANDLING[type], ...model.handling } : HANDLING[type];
    this.model = model;
    this.type = type;
    const H = this.H, phys = game.physics, w = phys.world;
    const [W, Ht, Lh] = H.dims;

    // chassis rigid body with explicit mass properties and a lowered centre of mass
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + H.wheelR + H.susRest + 0.2, pos.z)
      .setRotation(q).setLinearDamping(0.05).setAngularDamping(0.4).setCanSleep(true).setCcdEnabled(true));
    const bodyH = (H.profile.roof - H.wheelR * 0.9) / 2;
    const cy = H.wheelR * 0.9 + bodyH - (H.wheelR + H.susRest * 0.5) + 0.05; // collider centre relative to body origin
    const inertia = { x: H.mass / 12 * (Ht * Ht + Lh * Lh), y: H.mass / 12 * (W * W + Lh * Lh), z: H.mass / 12 * (W * W + Ht * Ht) };
    this.collider = phys.own(w.createCollider(R.ColliderDesc.roundCuboid(W / 2 - 0.08, bodyH - 0.08, Lh / 2 - 0.08, 0.08)
      .setTranslation(0, cy, 0).setFriction(0.5).setRestitution(0.1)
      .setMassProperties(H.mass, { x: 0, y: H.comY, z: 0.05 }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setCollisionGroups(groups(L.VEHICLE, ALL)).setSolverGroups(groups(L.VEHICLE, ALL & ~L.CHAR))
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS | R.ActiveEvents.COLLISION_EVENTS)
      .setContactForceEventThreshold(H.mass * 25), this.body), this);
    this.bodyOffsetY = cy - bodyH + (H.wheelR * 0.9) * 0; // visual alignment below

    this.ctrl = w.createVehicleController(this.body);
    this.ctrl.indexUpAxis = 1;
    this.ctrl.setIndexForwardAxis = 2;
    const axleY = -0.05;
    this.wheels = [];
    const ax = H.wheelbase / 2, tr = H.track / 2;
    const layout = [[-tr, ax, true], [tr, ax, true], [-tr, -ax, false], [tr, -ax, false]];
    layout.forEach(([x, z, front], i) => {
      this.ctrl.addWheel({ x, y: axleY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, H.susRest, H.wheelR);
      this.ctrl.setWheelSuspensionStiffness(i, H.susStiff);
      this.ctrl.setWheelSuspensionCompression(i, H.susComp);
      this.ctrl.setWheelSuspensionRelaxation(i, H.susRelax);
      this.ctrl.setWheelMaxSuspensionTravel(i, H.susTravel);
      this.ctrl.setWheelMaxSuspensionForce(i, H.mass * 40);
      this.ctrl.setWheelFrictionSlip(i, front ? H.gripFront : H.gripRear);
      this.ctrl.setWheelSideFrictionStiffness(i, H.sideStiff);
      this.wheels.push({ front, x, z, mesh: null, driven: H.drive === 'awd' || (H.drive === 'rwd' ? !front : front) });
    });

    // visuals
    this.mesh = new THREE.Group();
    if (model) {
      // LOD body: full-detail near, simplified further away (spec §15/§16)
      const lod = new THREE.LOD();
      const near = model.body[0].clone();
      near.traverse((o) => { if (o.isMesh) { o.geometry = o.geometry.clone(); o.castShadow = o.receiveShadow = true; } }); // own copy so dents stay per-car
      lod.addLevel(near, 0);
      model.body.slice(1).forEach((b, i) => { const c = b.clone(); c.traverse((o) => { if (o.isMesh) o.castShadow = true; }); lod.addLevel(c, [22, 60][i]); });
      // model ground sits at y=0; place it so its axles line up with the suspension at rest
      const restLen = H.susRest - 9.81 / (4 * H.susStiff);
      lod.position.y = -0.05 - restLen - H.wheelR;
      this.bodyMesh = new THREE.Group(); this.bodyMesh.add(lod);
      this.bodyMesh.userData.deformables = [];
      near.traverse((o) => { if (o.isMesh) this.bodyMesh.userData.deformables.push(o); });
      this.lod = lod;
    } else {
      this.bodyMesh = buildBody(H, color);
      this.bodyMesh.position.y = -(H.wheelR + H.susRest * 0.5) + 0.02;
    }
    this.mesh.add(this.bodyMesh);
    const wheelNames = ['wheel_rf', 'wheel_lf', 'wheel_rr', 'wheel_lr']; // matches the layout order above
    this.wheels.forEach((wh, i) => {
      if (model?.wheels[wheelNames[i]]) {
        // detailed generated wheel near the camera, cheap procedural wheel far away
        const g = new THREE.Group(), spin = new THREE.Group();
        const detailed = model.wheels[wheelNames[i]].clone(); detailed.position.set(0, 0, 0);
        detailed.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        spin.add(detailed);
        const simple = buildWheel(H.wheelR, H.wheelW).userData.spin; simple.visible = false; spin.add(simple);
        g.add(spin); g.userData.spin = spin; g.userData.detailed = detailed; g.userData.simple = simple;
        wh.mesh = g;
      } else wh.mesh = buildWheel(H.wheelR, H.wheelW);
      this.mesh.add(wh.mesh);
    });
    game.scene.add(this.mesh);
    // original positions as real floats (quantised attributes store normalised integers)
    for (const m of this.bodyMesh.userData.deformables) {
      const a = m.geometry.attributes.position, o = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { o[i * 3] = a.getX(i); o[i * 3 + 1] = a.getY(i); o[i * 3 + 2] = a.getZ(i); }
      m.userData.orig = o;
    }

    // state
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steer = 0;
    this.gear = 1;
    this.rpm = H.idle;
    this.health = 1000;
    this.driver = null;
    this.speed = 0;
    this.shiftT = 0;
    this.skid = 0;
    game.physics.onFixed((dt) => this.fixedUpdate(dt));
  }

  get position() { const t = this.body.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  get quaternion() { const r = this.body.rotation(); return new THREE.Quaternion(r.x, r.y, r.z, r.w); }
  get forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion); }
  get right() { return new THREE.Vector3(-1, 0, 0).applyQuaternion(this.quaternion); }
  get velocity() { const v = this.body.linvel(); return new THREE.Vector3(v.x, v.y, v.z); }

  fixedUpdate(dt) {
    const H = this.H, c = this.ctrl, inp = this.input;
    const v = this.velocity, fwd = this.forward;
    const vF = v.dot(fwd);
    this.speed = vF;
    const spd = Math.abs(vF);

    // speed-sensitive steering with rate limiting (heavier at speed)
    const lock = H.steerLock * THREE.MathUtils.lerp(1, 0.3, THREE.MathUtils.clamp(spd / 45, 0, 1));
    const target = -inp.steer * lock;
    const rate = (inp.steer === 0 ? 3.2 : 2.2) * dt;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -rate, rate);

    // throttle / brake / reverse logic
    let drive = inp.throttle, brake = inp.brake;
    if (inp.brake > 0 && vF < 1.0 && inp.throttle === 0) { drive = -inp.brake; brake = 0; }  // reverse
    if (inp.throttle > 0 && vF < -1.0) { brake = inp.throttle; drive = 0; }                   // braking out of reverse

    // automatic gearbox from wheel-driven rpm
    const wheelRpm = (Math.abs(vF) / H.wheelR) * 60 / (2 * Math.PI);
    const reverse = drive < 0;
    const ratio = (reverse ? 3.3 : H.gears[this.gear - 1]) * H.finalDrive;
    this.rpm = THREE.MathUtils.clamp(Math.max(H.idle, wheelRpm * ratio), H.idle, H.redline + 200);
    this.shiftT -= dt;
    if (!reverse && this.shiftT <= 0) {
      if (this.rpm > H.redline * 0.92 && this.gear < H.gears.length) { this.gear++; this.shiftT = 0.35; }
      else if (this.gear > 1 && this.rpm < H.redline * 0.42) { this.gear--; this.shiftT = 0.35; }
    }
    // torque curve: rises to a plateau, falls past 85% redline
    const n = this.rpm / H.redline;
    const curve = n < 0.25 ? 0.55 + n * 1.6 : n < 0.85 ? 0.95 + (n - 0.25) * 0.08 : Math.max(0, 1 - (n - 0.85) * 4);
    const torque = H.torque * curve * Math.abs(drive) * (this.shiftT > 0.15 ? 0.2 : 1) * (this.health < 200 ? 0.5 : 1);
    let wheelForce = (torque * ratio * 0.9) / H.wheelR * Math.sign(drive || 0);
    if (reverse && vF < -8.5) wheelForce = 0; // reverse tops out around 19 mph
    const driven = this.wheels.filter((w) => w.driven).length;

    this.wheels.forEach((w, i) => {
      c.setWheelSteering(i, w.front ? this.steer : 0);
      c.setWheelEngineForce(i, w.driven ? wheelForce / driven : 0);
      const bb = w.front ? H.brakeBias : 1 - H.brakeBias;
      let b = brake * H.brake * bb * 2;
      if (inp.handbrake && !w.front) b += H.handbrake;
      if (!this.driver && inp.throttle === 0) b += 4; // parked cars hold still
      c.setWheelBrake(i, b); // Rapier brake = max rolling-friction impulse per step
      // handbrake unloads rear lateral grip for GTA-style slides
      const baseGrip = w.front ? H.gripFront : H.gripRear;
      c.setWheelFrictionSlip(i, inp.handbrake && !w.front ? baseGrip * H.handbrakeGrip : baseGrip);
    });

    c.updateVehicle(dt, undefined, groups(L.VEHICLE, L.WORLD | L.PROP | L.VEHICLE), this.collider);

    // anti-roll bars: resist compression difference across each axle
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const la = c.wheelSuspensionLength(a) ?? H.susRest, lb = c.wheelSuspensionLength(b) ?? H.susRest;
      const f = (la - lb) * H.antiRoll * dt;
      if (c.wheelIsInContact(a)) this.applyAtWheel(a, -f);
      if (c.wheelIsInContact(b)) this.applyAtWheel(b, f);
    }
    // aerodynamic drag + a little downforce
    const vv = this.body.linvel();
    const sp2 = vv.x * vv.x + vv.y * vv.y + vv.z * vv.z, sp = Math.sqrt(sp2);
    if (sp > 0.1) {
      const k = 0.5 * 1.2 * H.cdA * sp2 * dt / sp;
      this.body.applyImpulse({ x: -vv.x * k, y: -vv.y * k - 0.25 * sp2 * dt, z: -vv.z * k }, true);
    }
    // skid amount for audio/marks
    let side = 0;
    for (let i = 0; i < 4; i++) side += Math.abs(c.wheelSideImpulse(i) || 0);
    const lat = Math.abs(v.dot(this.right));
    this.skid = THREE.MathUtils.clamp((lat - 2.5) / 6, 0, 1) + (inp.handbrake && spd > 5 ? 0.5 : 0);
  }

  applyAtWheel(i, f) {
    const hp = this.ctrl.wheelHardPoint(i);
    if (!hp) return;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion).multiplyScalar(f);
    this.body.applyImpulseAtPoint({ x: up.x, y: up.y, z: up.z }, hp, true);
  }

  // Crash damage: vertex deformation weighted to spare the cabin.
  impact(worldPoint, worldDir, magnitude) {
    const dmg = magnitude / (this.H.mass * 60);
    if (dmg < 0.05) return;
    this.health -= dmg * 60;
    const depthW = Math.min(0.18, dmg * 0.08), radiusW = 0.55 + Math.min(0.6, dmg * 0.2);
    for (const m of this.bodyMesh.userData.deformables) {
      m.updateMatrixWorld(true);
      const inv = m.matrixWorld.clone().invert();
      const lp = worldPoint.clone().applyMatrix4(inv);
      const ld = worldDir.clone().transformDirection(inv).normalize();
      const unit = 1 / new THREE.Vector3().setFromMatrixScale(m.matrixWorld).x; // world metres -> mesh units
      const depth = depthW * unit, radius = radiusW * unit;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox, bh = bb.max.y - bb.min.y, bl = bb.max.z - bb.min.z;
      const pos = m.geometry.attributes.position, orig = m.userData.orig;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d = Math.hypot(x - lp.x, y - lp.y, z - lp.z);
        if (d > radius) continue;
        // spare the cabin: upper-middle of the body deforms far less
        const cabin = (y - bb.min.y) / bh > 0.55 && Math.abs(z - (bb.min.z + bb.max.z) / 2) / bl < 0.3 ? 0.25 : 1;
        const k = (1 - d / radius) ** 2 * depth * cabin;
        const nx = x + ld.x * k, ny = y + ld.y * k * 0.5, nz = z + ld.z * k;
        const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
        const lim = 0.35 * unit;
        pos.setXYZ(i, ox + THREE.MathUtils.clamp(nx - ox, -lim, lim), oy + THREE.MathUtils.clamp(ny - oy, -lim, lim), oz + THREE.MathUtils.clamp(nz - oz, -lim, lim));
      }
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
  }

  sync(dt) {
    const t = this.body.translation(), r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    // body sway on its springs: roll with lateral g, dive/squat with longitudinal g
    if (dt > 0) {
      const v = this.velocity, prev = this._prevVel || v;
      const acc = v.clone().sub(prev).divideScalar(dt);
      this._prevVel = v;
      const lat = acc.dot(this.right), lon = acc.dot(this.forward);
      const sw = this._sway || (this._sway = { r: 0, rv: 0, p: 0, pv: 0 });
      const tr = THREE.MathUtils.clamp(lat * 0.0075, -0.09, 0.09), tp = THREE.MathUtils.clamp(-lon * 0.0045, -0.06, 0.06);
      const k = 90, d = 11; // spring stiffness / damping
      sw.rv += ((tr - sw.r) * k - sw.rv * d) * dt; sw.r += sw.rv * dt;
      sw.pv += ((tp - sw.p) * k - sw.pv * d) * dt; sw.p += sw.pv * dt;
      this.bodyMesh.rotation.set(sw.p, 0, sw.r);
    }
    // detailed generated wheels only near the camera
    const cam = this.game.renderer?.camera;
    if (cam && this.model) {
      const near = cam.position.distanceToSquared(this.mesh.position) < 22 * 22;
      if (near !== this._nearWheels) {
        this._nearWheels = near;
        for (const w of this.wheels) if (w.mesh.userData.detailed) { w.mesh.userData.detailed.visible = near; w.mesh.userData.simple.visible = !near; }
      }
    }
    const c = this.ctrl;
    this.wheels.forEach((w, i) => {
      const len = c.wheelSuspensionLength(i) ?? this.H.susRest;
      w.mesh.position.set(w.x, -0.05 - len, w.z);
      w.mesh.rotation.y = w.front ? this.steer : 0;
      w.mesh.userData.spin.rotation.x = c.wheelRotation(i) ?? 0;
    });
  }

  // Seat position in world space (driver sits left, US-style)
  seatWorld() { return new THREE.Vector3(0.38, 0.1, -0.2).applyQuaternion(this.quaternion).add(this.position); }
  doorWorld() { return new THREE.Vector3(this.H.dims[0] / 2 + 0.55, -0.4, -0.1).applyQuaternion(this.quaternion).add(this.position); }
}
