import * as THREE from 'three';
import { resolveCircle, groundY } from './world.js';

export const TYPES = {
  muscle:  { name: 'Stallion 70', len: 4.8, wid: 2.0, h: 1.25, maxSpeed: 52, accel: 17, grip: 7.5, colors: ['#e8dcc0', '#b8261e', '#1e3f7a', '#111111', '#e0a326'], price: 900 },
  sedan:   { name: 'Meridian',    len: 4.6, wid: 1.9, h: 1.45, maxSpeed: 42, accel: 12, grip: 8.5, colors: ['#3a5f8f', '#d0d0d0', '#5a1d1d', '#2f4f3f', '#e7e3dc', '#1c1c1c'], price: 500 },
  compact: { name: 'Pip',         len: 3.8, wid: 1.75, h: 1.45, maxSpeed: 38, accel: 12, grip: 9, colors: ['#e05a47', '#8fc1e3', '#f2d15c', '#9ad18b', '#ffffff'], price: 300 },
  taxi:    { name: 'Cab',         len: 4.7, wid: 1.9, h: 1.5, maxSpeed: 42, accel: 12, grip: 8.5, colors: ['#f5c518'], price: 450 },
  sports:  { name: 'Vento GT',    len: 4.5, wid: 2.0, h: 1.1, maxSpeed: 64, accel: 22, grip: 9.5, colors: ['#d11f2a', '#f2f2f2', '#ffb400', '#18a0c9', '#222'], price: 2500 },
  van:     { name: 'Hauler',      len: 5.2, wid: 2.1, h: 2.3, maxSpeed: 34, accel: 9, grip: 7, colors: ['#f0f0f0', '#8c8c8c', '#2f5d8c'], price: 400 },
  police:  { name: 'Interceptor', len: 4.9, wid: 2.0, h: 1.45, maxSpeed: 55, accel: 18, grip: 9, colors: ['#111'], price: 0 },
  tanker:  { name: 'Fuel Tanker', len: 11, wid: 2.6, h: 3.6, maxSpeed: 30, accel: 6, grip: 6, colors: ['#1d3b6b', '#5a5a5a'], price: 0 },
};
export const CIVILIAN_TYPES = ['sedan', 'sedan', 'compact', 'compact', 'taxi', 'muscle', 'sports', 'van'];

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, ...o });
const GLASS = std('#1a2430', { roughness: 0.1, metalness: 0.8 });
const TIRE = std('#161616', { roughness: 0.9, metalness: 0 });
const RIM = std('#bfc3c7', { roughness: 0.25, metalness: 0.9 });
const CHROME = std('#dfe3e6', { roughness: 0.15, metalness: 1 });
const HEAD = new THREE.MeshStandardMaterial({ color: '#fffbe8', emissive: '#fff3c4', emissiveIntensity: 0.4 });
const TAIL = new THREE.MeshStandardMaterial({ color: '#7a0b0b', emissive: '#ff1a1a', emissiveIntensity: 0.4 });

function box(w, h, d, m, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = true; return b;
}

function wheel(r, w) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 16), TIRE); t.rotation.z = Math.PI / 2; t.castShadow = true;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 10), RIM); rim.rotation.z = Math.PI / 2;
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, r * 1.1, 0.08), RIM);
  const spoke2 = spoke.clone(); spoke2.rotation.x = Math.PI / 2;
  const spin = new THREE.Group(); spin.add(t, rim, spoke, spoke2); g.add(spin);
  g.userData.spin = spin;
  return g;
}

// Builds the mesh for a vehicle type. Model faces +Z.
export function buildVehicleMesh(type, color) {
  const T = TYPES[type];
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.3, metalness: 0.5 });
  const L = T.len, W = T.wid;
  const wheels = [];
  let wr = 0.38, wheelZ = L * 0.32, wheelX = W / 2 - 0.12;

  if (type === 'tanker') {
    wr = 0.52;
    g.add(box(W, 1.6, 2.6, paint, 0, 1.9, L / 2 - 1.4)); // cab
    g.add(box(W - 0.1, 0.9, 1.2, GLASS, 0, 2.6, L / 2 - 0.8));
    g.add(box(W, 0.8, 2.6, paint, 0, 3.1, L / 2 - 1.9));
    g.add(box(W * 0.9, 0.3, L, std('#2a2a2a'), 0, 0.9, 0)); // chassis
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, L - 3.4, 20), std('#c9c5bd', { metalness: 0.7, roughness: 0.3 }));
    tank.rotation.x = Math.PI / 2; tank.position.set(0, 2.35, -1.3); tank.castShadow = true; g.add(tank);
    // original fuel brand decal
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#c9c5bd'; x.fillRect(0, 0, 512, 128); x.fillStyle = '#d4511c'; x.beginPath(); x.arc(64, 64, 44, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#1d3b6b'; x.font = 'bold 72px Oswald, Impact, sans-serif'; x.textBaseline = 'middle'; x.fillText('SOLARA FUEL', 128, 68);
    const decal = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), metalness: 0.5, roughness: 0.35 });
    for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.25), decal); d.position.set(s * 1.26, 2.35, -1.3); d.rotation.y = s * Math.PI / 2; g.add(d); }
    g.add(box(0.3, 1.6, 0.1, CHROME, 0, 2.4, -L / 2 + 0.5)); // rear ladder
    for (const z of [L / 2 - 1.4, -L / 2 + 1.2, -L / 2 + 2.6]) for (const s of [-1, 1]) { const w = wheel(wr, 0.5); w.position.set(s * (W / 2 - 0.2), wr, z); g.add(w); wheels.push({ w, front: z > 0 }); }
    g.add(box(0.5, 0.25, 0.1, HEAD, -0.8, 1.6, L / 2 - 0.08), box(0.5, 0.25, 0.1, HEAD, 0.8, 1.6, L / 2 - 0.08));
    g.add(box(0.4, 0.2, 0.1, TAIL, -1, 1.0, -L / 2), box(0.4, 0.2, 0.1, TAIL, 1, 1.0, -L / 2));
  } else {
    const bodyH = type === 'van' ? 1.9 : type === 'sports' ? 0.55 : 0.65;
    const baseY = wr + 0.1;
    g.add(box(W, bodyH, L, paint, 0, baseY + bodyH / 2, 0));
    if (type !== 'van') {
      const cabL = type === 'sports' ? L * 0.38 : type === 'muscle' ? L * 0.4 : L * 0.48;
      const cabZ = type === 'muscle' ? -L * 0.08 : type === 'sports' ? -L * 0.05 : -L * 0.04;
      const cabH = T.h - bodyH - baseY + 0.5;
      g.add(box(W - 0.2, cabH, cabL, GLASS, 0, baseY + bodyH + cabH / 2, cabZ));
      g.add(box(W - 0.16, 0.08, cabL - 0.15, paint, 0, baseY + bodyH + cabH, cabZ)); // roof
      for (const s of [-1, 1]) g.add(box(0.08, cabH, 0.14, paint, s * (W / 2 - 0.12), baseY + bodyH + cabH / 2, cabZ + cabL / 2 - 0.08)); // A-pillars
    } else {
      g.add(box(W - 0.02, 0.6, 0.9, GLASS, 0, baseY + 1.4, L / 2 - 0.5));
    }
    if (type === 'muscle') { g.add(box(0.6, 0.22, 1.0, paint, 0, baseY + bodyH + 0.1, L * 0.22)); g.add(box(0.5, 0.05, 0.1, std('#111'), 0, baseY + bodyH + 0.15, L * 0.22 + 0.5)); }
    if (type === 'sports') g.add(box(W - 0.2, 0.06, 0.4, paint, 0, baseY + bodyH + 0.35, -L / 2 + 0.2), box(0.08, 0.3, 0.08, paint, -0.6, baseY + bodyH + 0.15, -L / 2 + 0.2), box(0.08, 0.3, 0.08, paint, 0.6, baseY + bodyH + 0.15, -L / 2 + 0.2));
    if (type === 'taxi') { g.add(box(0.7, 0.2, 0.3, std('#fff', { emissive: '#ffe16b', emissiveIntensity: 0.5 }), 0, T.h + 0.35, -L * 0.04)); g.add(box(W + 0.01, 0.12, L * 0.6, std('#111'), 0, baseY + bodyH * 0.5, 0)); }
    if (type === 'police') {
      for (const s of [-1, 1]) g.add(box(0.02, bodyH * 0.9, L * 0.5, std('#f2f2f2'), s * (W / 2 + 0.005), baseY + bodyH / 2, -0.1));
      const bar = new THREE.Group(); bar.position.set(0, T.h + 0.35, -L * 0.04);
      const red = new THREE.MeshStandardMaterial({ color: '#600', emissive: '#ff0000', emissiveIntensity: 0 });
      const blue = new THREE.MeshStandardMaterial({ color: '#006', emissive: '#1a4dff', emissiveIntensity: 0 });
      bar.add(box(0.55, 0.14, 0.3, red, -0.33, 0, 0), box(0.55, 0.14, 0.3, blue, 0.33, 0, 0));
      g.add(bar);
      g.userData.siren = { red, blue };
    }
    g.add(box(W + 0.05, 0.18, 0.2, CHROME, 0, baseY + 0.15, L / 2), box(W + 0.05, 0.18, 0.2, CHROME, 0, baseY + 0.15, -L / 2)); // bumpers
    for (const s of [-1, 1]) {
      g.add(box(0.36, 0.16, 0.06, HEAD, s * (W / 2 - 0.3), baseY + bodyH * 0.7, L / 2 + 0.01));
      g.add(box(0.4, 0.14, 0.06, TAIL, s * (W / 2 - 0.3), baseY + bodyH * 0.7, -L / 2 - 0.01));
    }
    for (const z of [wheelZ, -wheelZ]) for (const s of [-1, 1]) { const w = wheel(wr, 0.28); w.position.set(s * wheelX, wr, z); g.add(w); wheels.push({ w, front: z > 0 }); }
  }
  g.userData.wheels = wheels;
  g.userData.wheelR = wr;
  g.userData.paint = paint;
  return g;
}

let nextId = 1;
export class Vehicle {
  constructor(scene, type, pos, heading = 0, color) {
    this.id = nextId++;
    this.type = type;
    this.spec = TYPES[type];
    this.color = color || this.spec.colors[Math.floor(Math.random() * this.spec.colors.length)];
    this.mesh = buildVehicleMesh(type, this.color);
    this.pos = pos.clone();
    this.heading = heading;
    this.vel = new THREE.Vector3();
    this.steer = 0;
    this.health = type === 'tanker' ? 700 : 1000;
    this.burning = 0;
    this.exploded = false;
    this.driver = null; // 'player' | ped | null
    this.ai = null;
    this.radius = this.spec.wid / 2 + 0.15;
    this.scene = scene;
    this.wheelRot = 0;
    this.sirenOn = false;
    this.lastImpact = 0;
    scene.add(this.mesh);
    this.syncMesh(0);
  }
  get forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  get right() { return new THREE.Vector3(-Math.cos(this.heading), 0, Math.sin(this.heading)); }
  get speed() { return this.vel.dot(this.forward); }

  // input: {throttle -1..1, steer -1..1 (positive = right), handbrake bool}
  update(dt, input, onImpact) {
    const T = this.spec, f = this.forward, r = this.right;
    if (this.exploded) { input = { throttle: 0, steer: 0, handbrake: true }; }
    let fwd = this.vel.dot(f), lat = this.vel.dot(r);
    const th = input.throttle || 0;
    const healthFactor = this.health < 250 ? 0.5 : 1;
    if (th > 0) fwd += (fwd < -0.5 ? T.accel * 2 : T.accel * healthFactor) * th * dt;
    else if (th < 0) fwd += (fwd > 0.5 ? T.accel * 2.2 : T.accel * 0.6) * th * dt;
    else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 3 * dt);
    fwd -= fwd * Math.abs(fwd) * 0.0009 * 60 * dt / 3; // aero drag
    fwd = THREE.MathUtils.clamp(fwd, -T.maxSpeed * 0.35, T.maxSpeed);
    if (input.handbrake) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 14 * dt);
    const grip = input.handbrake ? 1.2 : T.grip;
    lat *= Math.exp(-grip * dt);
    this.steer += ((input.steer || 0) - this.steer) * Math.min(1, dt * 8);
    const steerLimit = 0.9 - Math.min(0.55, Math.abs(fwd) / T.maxSpeed * 0.7);
    const yawRate = this.steer * steerLimit * THREE.MathUtils.clamp(fwd / 5, -1, 1) * 2.1 * (input.handbrake ? 1.35 : 1);
    this.heading -= yawRate * dt;
    const nf = this.forward, nr = this.right;
    this.vel.copy(nf).multiplyScalar(fwd).addScaledVector(nr, lat);
    this.pos.addScaledVector(this.vel, dt);

    // collide front and back circles against the city
    const half = T.len / 2 - this.radius * 0.8;
    for (const s of [1, -1]) {
      const c = this.pos.clone().addScaledVector(nf, half * s);
      const before = c.clone();
      const n = resolveCircle(c, this.radius, 0.5);
      if (n) {
        this.pos.add(c.sub(before));
        const vn = this.vel.x * n.x + this.vel.z * n.z;
        if (vn < 0) {
          this.vel.x -= 1.4 * vn * n.x; this.vel.z -= 1.4 * vn * n.z;
          this.vel.multiplyScalar(0.8);
          if (-vn > 6) { this.damage(-vn * 12); onImpact && onImpact(this, -vn); }
        }
      }
    }
    this.pos.y = groundY(this.pos.x, this.pos.z) > 0 ? 0.2 : 0;
    if (this.health <= 0 && !this.exploded && this.burning <= 0) this.burning = 4;
    this.syncMesh(dt);
  }

  damage(amount) {
    if (this.exploded) return;
    this.health -= amount;
  }

  syncMesh(dt) {
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.y = this.heading;
    const lat = this.vel.dot(this.right);
    m.rotation.z = THREE.MathUtils.clamp(-lat * 0.012, -0.08, 0.08);
    const spd = this.speed;
    this.wheelRot += (spd / m.userData.wheelR) * dt;
    for (const { w, front } of m.userData.wheels) {
      w.userData.spin.rotation.x = this.wheelRot;
      if (front) w.rotation.y = -this.steer * 0.5;
    }
    if (m.userData.siren) {
      const on = this.sirenOn, t = performance.now() / 1000;
      m.userData.siren.red.emissiveIntensity = on && Math.sin(t * 14) > 0 ? 4 : 0;
      m.userData.siren.blue.emissiveIntensity = on && Math.sin(t * 14) <= 0 ? 4 : 0;
    }
  }

  explode() {
    this.exploded = true;
    this.health = 0;
    this.burning = 0;
    const burnt = new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 1 });
    this.mesh.traverse((o) => { if (o.isMesh && o.material !== TIRE) o.material = burnt; });
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

// Car-vs-car collision using two circles per car.
export function collideVehicles(list, onImpact) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const maxR = (a.spec.len + b.spec.len) / 2 + 1;
    if (Math.abs(a.pos.x - b.pos.x) > maxR || Math.abs(a.pos.z - b.pos.z) > maxR) continue;
    const ha = a.spec.len / 2 - a.radius * 0.8, hb = b.spec.len / 2 - b.radius * 0.8;
    const af = a.forward, bf = b.forward;
    for (const sa of [1, 0, -1]) for (const sb of [1, 0, -1]) {
      const pa = a.pos.clone().addScaledVector(af, ha * sa), pb = b.pos.clone().addScaledVector(bf, hb * sb);
      const d = pa.distanceTo(pb), min = a.radius + b.radius;
      if (d < min && d > 1e-4) {
        const n = pb.sub(pa).divideScalar(d);
        const ma = a.spec.len * a.spec.wid, mb = b.spec.len * b.spec.wid;
        const push = (min - d);
        a.pos.addScaledVector(n, -push * mb / (ma + mb)); b.pos.addScaledVector(n, push * ma / (ma + mb));
        const rel = b.vel.clone().sub(a.vel).dot(n);
        if (rel < 0) {
          const imp = -1.3 * rel / (1 / ma + 1 / mb);
          a.vel.addScaledVector(n, -imp / ma); b.vel.addScaledVector(n, imp / mb);
          if (-rel > 5) { a.damage(-rel * 10); b.damage(-rel * 10); onImpact && onImpact(a, b, -rel); }
        }
      }
    }
  }
}
