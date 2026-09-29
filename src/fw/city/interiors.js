import * as THREE from 'three';
import { GeoBuilder, rng } from './geom.js';
import { T } from './archkit.js';

// ============================================================================
// Interiors: furniture kit + room layouts for enterable buildings.
// Everything is in building-local space (front facade at +Z), built lazily by the streamer.
// A layout returns { group, colliders, doors, lights, volumes, interactables }.
//   doors:        same record format as exterior doors (hinged leaves handled by doors.js)
//   lights:       [{x,y,z,color,intensity,distance}] candidates for the pooled interior lights
//   volumes:      [{x0,x1,y0,y1,z0,z1,name}] interior spaces (camera interior mode, lights, ambience)
//   interactables:[{type,x,y,z,label,...}] shop counters, ATMs, elevators, cells...
// ============================================================================

const IW = 0.12;                      // interior partition thickness
const STEP_RISE = 0.18, STEP_RUN = 0.27;

// Stairwell openings cut in the first upper slab (shared with the exterior builder).
export function stairwellFor(kind, w, d, gfh) {
  const n = Math.ceil(gfh / STEP_RISE), run = n * STEP_RUN;
  if (kind === 'house') { const X0 = -w / 2 + T, z1 = d / 2 - T - 0.4; return { x0: X0, x1: X0 + 1.1, z0: z1 - run, z1, n, dir: -1 }; }
  if (kind === 'apartmentLobby') { const z1 = d / 2 - T - 2.2; return { x0: 2.5, x1: 3.7, z0: z1 - run, z1, n, dir: -1 }; }
  return null;
}

// ---------------------------------------------------------------- placement helper
// Furniture is authored facing +Z (the side a person uses). `at(B,x,y0,z,rot)` maps local
// offsets through a quarter-turn rotation so pieces can face any wall.
function at(B, x, y0, z, rot = 0) {
  const c = Math.round(Math.cos(rot)), s = Math.round(Math.sin(rot)), swap = Math.abs(s) === 1;
  const X = (lx, lz) => x + lx * c + lz * s, Z = (lx, lz) => z - lx * s + lz * c;
  return {
    box: (mat, lx, y, lz, sx, sy, sz, color, collide = false) => B.box(mat, X(lx, lz), y0 + y, Z(lx, lz), swap ? sz : sx, sy, swap ? sx : sz, color, { collide }),
    cyl: (mat, lx, y, lz, r, h, color, seg = 10, r2) => B.cyl(mat, X(lx, lz), y0 + y, Z(lx, lz), r, h, color, { seg, r2: r2 ?? r }),
    quad: (mat, lx, y, lz, w, h, rect) => B.quad(mat, X(lx, lz), y0 + y, Z(lx, lz), w, h, rect, rot),
  };
}

// ---------------------------------------------------------------- furniture kit
const F = {
  sofa(B, x, y, z, rot, col = '#5a6470', len = 2.2) {
    const p = at(B, x, y, z, rot);
    p.box('fabric', 0, 0.22, 0, len, 0.44, 0.9, col, true);
    p.box('fabric', 0, 0.62, -0.36, len, 0.5, 0.2, col);
    for (const s of [-1, 1]) p.box('fabric', s * (len / 2 - 0.1), 0.5, 0, 0.2, 0.3, 0.9, col);
    for (let i = 0; i < 3; i++) p.box('fabric', -len / 2 + 0.2 + (len - 0.4) * (i + 0.5) / 3, 0.5, 0.05, (len - 0.5) / 3, 0.14, 0.7, col);
  },
  armchair(B, x, y, z, rot, col = '#7a5a48') { F.sofa(B, x, y, z, rot, col, 0.95); },
  coffeeTable(B, x, y, z, rot = 0) { const p = at(B, x, y, z, rot); p.box('wood', 0, 0.4, 0, 1.1, 0.05, 0.6, '#6b4a33'); for (const a of [-1, 1]) for (const b of [-1, 1]) p.box('wood', a * 0.5, 0.2, b * 0.25, 0.05, 0.4, 0.05, '#4a3322'); },
  rug(B, x, y, z, w, d, col = '#8a6a5a') { B.box('carpet', x, y + 0.012, z, w, 0.02, d, col); },
  tvUnit(B, x, y, z, rot) {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, 0.25, 0, 1.8, 0.5, 0.45, '#3a3430', true);
    p.box('plastic', 0, 1.05, -0.1, 1.4, 0.8, 0.06, '#111');
    p.box('screen', 0, 1.05, -0.065, 1.32, 0.72, 0.01, '#2a3a5a');
  },
  table(B, x, y, z, rot = 0, w = 1.6, d = 0.9, col = '#7a5a40', h = 0.76) {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, h, 0, w, 0.05, d, col, true);
    for (const a of [-1, 1]) for (const b of [-1, 1]) p.box('wood', a * (w / 2 - 0.06), h / 2, b * (d / 2 - 0.06), 0.06, h, 0.06, '#3a2a1e');
  },
  chair(B, x, y, z, rot, col = '#4a3a30') {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, 0.45, 0, 0.44, 0.05, 0.44, col);
    p.box('wood', 0, 0.72, -0.2, 0.44, 0.5, 0.04, col);
    for (const a of [-1, 1]) for (const b of [-1, 1]) p.box('metal', a * 0.19, 0.22, b * 0.19, 0.03, 0.44, 0.03, '#333');
  },
  diningSet(B, x, y, z, rot = 0) {
    F.table(B, x, y, z, rot, 1.6, 0.9);
    const p = (lx, lz, r) => { const c = Math.round(Math.cos(rot)), s = Math.round(Math.sin(rot)); F.chair(B, x + lx * c + lz * s, y, z - lx * s + lz * c, rot + r); };
    p(-0.4, 0.7, Math.PI); p(0.4, 0.7, Math.PI); p(-0.4, -0.7, 0); p(0.4, -0.7, 0);
  },
  kitchenRun(B, x, y, z, rot, len = 3.6) {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, 0.43, 0, len, 0.86, 0.6, '#e8e2d6', true);          // base cabinets
    p.box('stone', 0, 0.88, 0.01, len + 0.02, 0.04, 0.62, '#3a3a3c');      // worktop
    p.box('wood', 0, 1.85, -0.12, len, 0.7, 0.36, '#e8e2d6');              // wall cabinets
    for (let i = 0; i < Math.floor(len / 0.6); i++) p.box('chrome', -len / 2 + 0.3 + i * 0.6, 0.72, 0.305, 0.12, 0.02, 0.02, '#ccc');
    p.box('chrome', -len / 4, 0.9, 0.05, 0.6, 0.02, 0.4, '#b8bcc0');       // sink
    p.box('metal', len / 4, 0.905, 0.05, 0.6, 0.02, 0.5, '#1a1a1a');       // hob
    p.box('plastic', len / 2 + 0.4, 0.95, 0, 0.75, 1.9, 0.65, '#d8dadc', true); // fridge
    p.box('chrome', len / 2 + 0.1, 1.2, 0.33, 0.03, 0.5, 0.03, '#aaa');
  },
  bed(B, x, y, z, rot, col = '#c9d4e0', w = 1.6) {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, 0.2, 0, w + 0.1, 0.4, 2.1, '#5a4030', true);
    p.box('fabric', 0, 0.5, 0.05, w, 0.22, 2.0, '#f2f0ea');
    p.box('fabric', 0, 0.63, 0.35, w + 0.04, 0.06, 1.3, col);
    for (const s of w > 1.2 ? [-1, 1] : [0]) p.box('fabric', s * w / 4, 0.68, -0.75, w / 2 - 0.1, 0.14, 0.4, '#ffffff');
    p.box('wood', 0, 0.75, -1.05, w + 0.1, 1.1, 0.06, '#5a4030');
  },
  nightstand(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('wood', 0, 0.28, 0, 0.45, 0.56, 0.4, '#5a4030'); p.box('light', 0, 0.72, 0, 0.18, 0.3, 0.18, '#ffe6b0'); },
  wardrobe(B, x, y, z, rot, w = 1.4) { const p = at(B, x, y, z, rot); p.box('wood', 0, 1.0, 0, w, 2.0, 0.6, '#6b4f3a', true); p.box('wood', 0, 1.0, 0.301, 0.02, 1.9, 0.01, '#3a2a1e'); for (const s of [-1, 1]) p.box('chrome', s * 0.08, 1.1, 0.31, 0.02, 0.3, 0.02, '#bbb'); },
  toilet(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('tile', 0, 0.2, 0.05, 0.38, 0.4, 0.55, '#f4f4f2'); p.box('tile', 0, 0.55, -0.22, 0.42, 0.35, 0.18, '#f4f4f2'); p.box('plastic', 0, 0.41, 0.07, 0.4, 0.03, 0.5, '#ffffff'); },
  vanity(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('wood', 0, 0.4, 0, 0.9, 0.8, 0.5, '#e8e2d6', true); p.box('tile', 0, 0.83, 0.02, 0.5, 0.06, 0.36, '#ffffff'); p.box('chrome', 0, 1.6, -0.24, 0.8, 0.7, 0.02, '#c9d0d6'); },
  shower(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('tile', 0, 0.04, 0, 0.9, 0.08, 0.9, '#e4e8ea'); p.box('glassClear', 0.45, 1.0, 0, 0.02, 1.9, 0.9, '#fff'); p.box('glassClear', 0, 1.0, 0.45, 0.9, 1.9, 0.02, '#fff'); p.box('chrome', 0, 2.0, -0.35, 0.2, 0.03, 0.2, '#ccc'); },
  bookshelf(B, x, y, z, rot, w = 1.2, h = 2.0, r = Math.random) {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, h / 2, 0, w, h, 0.35, '#5a4030', true);
    const cols = ['#8a2f2f', '#2f4f8a', '#3f6a3a', '#c9a14a', '#5a3a6a', '#d8d2c6', '#2a2a2a'];
    for (let sh = 0; sh < Math.floor(h / 0.4); sh++) for (let i = 0; i < Math.floor(w / 0.2); i++) p.box('plastic', -w / 2 + 0.12 + i * 0.2, 0.2 + sh * 0.4, 0.06, 0.16, 0.26 + (i % 3) * 0.02, 0.25, cols[(sh * 7 + i * 3) % cols.length]);
  },
  plant(B, x, y, z, h = 1.2) {
    B.cyl('plastic', x, y, z, 0.22, 0.4, '#e8e2d6', { seg: 10, r2: 0.26 });
    const g = new THREE.IcosahedronGeometry(0.45, 0); g.scale(1, h / 0.9, 1); g.translate(x, y + 0.4 + h * 0.45, z); B.push('leaves', g, '#3f7a3a');
  },
  ceilingLight(B, x, y, z, w = 1.2, d = 0.3) { B.box('light', x, y - 0.03, z, w, 0.05, d, '#ffffff'); },
  desk(B, x, y, z, rot, withPC = true) {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, 0.74, 0, 1.4, 0.04, 0.7, '#d8d2c6', true);
    for (const s of [-1, 1]) p.box('metal', s * 0.66, 0.37, 0, 0.04, 0.74, 0.66, '#555');
    if (withPC) { p.box('plastic', 0, 1.02, -0.2, 0.55, 0.34, 0.03, '#111'); p.box('screen', 0, 1.02, -0.185, 0.5, 0.3, 0.005, '#5a8ad0'); p.box('plastic', 0, 0.8, -0.2, 0.08, 0.1, 0.08, '#222'); p.box('plastic', 0, 0.765, 0.05, 0.44, 0.015, 0.14, '#222'); }
    F.officeChair(B, ...offset(x, z, rot, 0, 0.6), y, rot + Math.PI);
  },
  officeChair(B, x, z, y, rot) { const p = at(B, x, y, z, rot); p.box('fabric', 0, 0.48, 0, 0.5, 0.08, 0.5, '#222'); p.box('fabric', 0, 0.85, -0.23, 0.46, 0.6, 0.06, '#222'); p.cyl('metal', 0, 0.08, 0, 0.03, 0.4, '#444', 6); p.box('metal', 0, 0.05, 0, 0.55, 0.04, 0.06, '#333'); p.box('metal', 0, 0.05, 0, 0.06, 0.04, 0.55, '#333'); },
  counter(B, x, y, z, rot, len = 2.4, col = '#3a3d42', top = '#d8d2c6') {
    const p = at(B, x, y, z, rot);
    p.box('wood', 0, 0.5, 0, len, 1.0, 0.7, col, true);
    p.box('stone', 0, 1.02, 0.02, len + 0.06, 0.05, 0.76, top);
  },
  register(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('plastic', 0, 1.1, 0, 0.35, 0.12, 0.35, '#222'); p.box('screen', 0, 1.32, -0.05, 0.3, 0.2, 0.02, '#6fa8ff'); },
  shelfUnit(B, x, y, z, rot, len = 3, h = 1.7, r = Math.random, double = true) {
    const p = at(B, x, y, z, rot), dep = double ? 0.9 : 0.45;
    p.box('metal', 0, h / 2, 0, len, h, 0.06, '#d8dadc', true);
    p.box('metal', 0, 0.08, 0, len, 0.16, dep, '#b8bcc0', true);
    const prod = ['#c8342a', '#f2c230', '#2f7a4f', '#1f6fb2', '#f4f1e8', '#e87a2a', '#6a3a8a', '#8a5a3a'];
    for (let sh = 0; sh < 4; sh++) {
      const yy = 0.2 + sh * (h - 0.3) / 4;
      for (const side of double ? [-1, 1] : [1]) {
        p.box('metal', 0, yy, side * dep / 4, len, 0.03, dep / 2 - 0.04, '#c9ccd0');
        let u = -len / 2 + 0.05;
        while (u < len / 2 - 0.2) { const bw = 0.12 + r() * 0.18, bh = 0.12 + r() * 0.2; p.box('plastic', u + bw / 2, yy + 0.015 + bh / 2, side * dep / 4, bw - 0.02, bh, dep / 2 - 0.12, prod[Math.floor(r() * prod.length)]); u += bw; }
      }
    }
  },
  cooler(B, x, y, z, rot, len = 3.6) {
    const p = at(B, x, y, z, rot), n = Math.round(len / 0.9);
    p.box('metal', 0, 1.05, 0, len, 2.1, 0.8, '#2a2d31', true);
    p.box('light', 0, 1.1, 0.3, len - 0.1, 1.8, 0.02, '#e8f4ff');
    const prod = ['#c8342a', '#1f6fb2', '#2f7a4f', '#f2c230', '#f4f1e8'];
    for (let i = 0; i < n; i++) for (let sh = 0; sh < 4; sh++) p.box('plastic', -len / 2 + 0.45 + i * 0.9, 0.45 + sh * 0.42, 0.33, 0.7, 0.26, 0.05, prod[(i + sh * 2) % prod.length]);
    for (let i = 0; i <= n; i++) p.box('chrome', -len / 2 + i * (len / n), 1.1, 0.39, 0.05, 2.0, 0.04, '#aaa');
    p.box('glassClear', 0, 1.1, 0.4, len, 1.9, 0.02, '#fff');
  },
  rack(B, x, y, z, rot, len = 1.6, r = Math.random) {
    const p = at(B, x, y, z, rot);
    for (const s of [-1, 1]) p.box('chrome', s * len / 2, 0.7, 0, 0.04, 1.4, 0.04, '#bbb');
    p.box('chrome', 0, 1.4, 0, len, 0.03, 0.03, '#bbb'); p.box('chrome', 0, 0.03, 0, len, 0.03, 0.5, '#999');
    const cols = ['#1c1c1c', '#f4f1e8', '#2f4f8a', '#8a2f2f', '#c9a14a', '#3f6a3a', '#9aa3ab'];
    for (let u = -len / 2 + 0.1; u < len / 2 - 0.05; u += 0.09) p.box('fabric', u, 0.95, 0, 0.05, 0.85, 0.46, cols[Math.floor(r() * cols.length)]);
  },
  displayTable(B, x, y, z, rot, r = Math.random) {
    F.table(B, x, y, z, rot, 1.6, 0.9, '#d8d2c6', 0.8);
    const cols = ['#1c1c1c', '#f4f1e8', '#2f4f8a', '#8a2f2f', '#c9a14a'];
    for (let i = 0; i < 6; i++) B.box('fabric', x - 0.55 + (i % 3) * 0.55, y + 0.86 + 0.02, z - 0.2 + Math.floor(i / 3) * 0.4, 0.4, 0.06 + r() * 0.08, 0.3, cols[i % cols.length]);
  },
  bench(B, x, y, z, rot, len = 1.8, col = '#6b4a2e') { const p = at(B, x, y, z, rot); p.box('wood', 0, 0.45, 0, len, 0.06, 0.45, col, true); p.box('wood', 0, 0.8, -0.2, len, 0.35, 0.05, col); for (const s of [-1, 1]) p.box('metal', s * (len / 2 - 0.1), 0.22, 0, 0.06, 0.45, 0.4, '#333'); },
  seatRow(B, x, y, z, rot, n = 4, col = '#2f4f8a') { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.3, 0, n * 0.55, 0.05, 0.1, '#555'); for (let i = 0; i < n; i++) { const u = -n * 0.275 + 0.275 + i * 0.55; p.box('plastic', u, 0.45, 0, 0.48, 0.06, 0.46, col); p.box('plastic', u, 0.75, -0.21, 0.48, 0.5, 0.05, col); } p.box('metal', 0, 0.2, 0, n * 0.55, 0.4, 0.05, '#555', true); },
  atm(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.8, 0, 0.8, 1.6, 0.6, '#3a4550', true); p.box('screen', 0, 1.25, 0.301, 0.4, 0.3, 0.01, '#4fb0ff'); p.box('plastic', 0, 1.0, 0.33, 0.45, 0.06, 0.1, '#222'); },
  locker(B, x, y, z, rot, n = 6, col = '#3f5a8a') { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.95, 0, n * 0.4, 1.9, 0.45, col, true); for (let i = 0; i <= n; i++) p.box('metal', -n * 0.2 + i * 0.4, 0.95, 0.23, 0.02, 1.9, 0.01, '#222'); for (let i = 0; i < n; i++) p.box('chrome', -n * 0.2 + 0.32 + i * 0.4, 1.1, 0.235, 0.02, 0.12, 0.02, '#ccc'); },
  whiteboard(B, x, y, z, rot, w = 3) { const p = at(B, x, y, z, rot); p.box('frame', 0, 1.5, 0, w + 0.08, 1.28, 0.03, '#999'); p.box('tile', 0, 1.5, 0.015, w, 1.2, 0.01, '#fbfbf8'); },
  hospitalBed(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.35, 0, 1.0, 0.1, 2.1, '#c9ccd0', true); p.box('fabric', 0, 0.5, 0, 0.9, 0.18, 2.0, '#e8f0f4'); p.box('fabric', 0, 0.62, -0.8, 0.8, 0.12, 0.35, '#fff'); p.box('metal', 0, 0.75, -1.05, 1.0, 0.8, 0.05, '#c9ccd0'); for (const a of [-1, 1]) for (const b of [-1, 1]) p.box('metal', a * 0.45, 0.17, b * 0.95, 0.05, 0.34, 0.05, '#888'); p.box('metal', 0.6, 1.0, -0.8, 0.04, 2.0, 0.04, '#bbb'); },
  curtain(B, x, y, z, rot, len = 2.4, col = '#8fb6c8') { const p = at(B, x, y, z, rot); p.box('chrome', 0, 2.4, 0, len, 0.03, 0.03, '#bbb'); for (let u = -len / 2; u < len / 2; u += 0.3) p.box('fabric', u + 0.15, 1.3, (Math.round(u * 10) % 2) * 0.05, 0.3, 2.1, 0.02, col); },
  treadmill(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('plastic', 0, 0.15, 0, 0.8, 0.3, 1.9, '#222', true); p.box('fabric', 0, 0.31, 0.1, 0.6, 0.02, 1.5, '#111'); for (const s of [-1, 1]) p.box('metal', s * 0.38, 0.8, -0.8, 0.05, 1.2, 0.05, '#666'); p.box('plastic', 0, 1.35, -0.8, 0.8, 0.3, 0.2, '#333'); p.box('screen', 0, 1.4, -0.69, 0.3, 0.18, 0.01, '#6fa8ff'); },
  weightBench(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('fabric', 0, 0.45, 0, 0.3, 0.1, 1.2, '#1a1a1a', true); p.box('metal', 0, 0.2, 0, 0.1, 0.4, 1.0, '#333'); for (const s of [-1, 1]) p.box('metal', s * 0.55, 0.6, -0.45, 0.06, 1.2, 0.06, '#444'); p.box('chrome', 0, 1.15, -0.45, 1.8, 0.04, 0.04, '#bbb'); for (const s of [-1, 1]) p.cyl('metal', s * 0.8, 0.93, -0.45, 0.22, 0.06, '#1a1a1a', 12); },
  squatRack(B, x, y, z, rot) { const p = at(B, x, y, z, rot); for (const a of [-1, 1]) for (const b of [-1, 1]) p.box('metal', a * 0.6, 1.2, b * 0.6, 0.08, 2.4, 0.08, '#2a2a2a'); for (const b of [-1, 1]) p.box('metal', 0, 2.4, b * 0.6, 1.3, 0.08, 0.08, '#2a2a2a'); p.box('fabric', 0, 0.02, 0, 2.2, 0.04, 2.2, '#1a1a1a', true); p.box('chrome', 0, 1.4, 0.6, 2.0, 0.04, 0.04, '#bbb'); },
  dumbbellRack(B, x, y, z, rot, len = 2.4) { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.4, 0, len, 0.08, 0.5, '#333', true); p.box('metal', 0, 0.75, -0.1, len, 0.08, 0.4, '#333'); for (let u = -len / 2 + 0.15; u < len / 2; u += 0.24) { p.box('metal', u, 0.5, 0.05, 0.12, 0.12, 0.3, '#1a1a1a'); p.box('metal', u, 0.85, -0.1, 0.1, 0.1, 0.26, '#1a1a1a'); } },
  carLift(B, x, y, z, rot) { const p = at(B, x, y, z, rot); for (const s of [-1, 1]) { p.box('metal', s * 1.6, 1.4, 0, 0.35, 2.8, 0.35, '#c8342a', true); p.box('metal', s * 0.9, 0.12, 0, 0.4, 0.08, 4.0, '#555'); } p.box('metal', 0, 2.85, 0, 3.6, 0.2, 0.3, '#c8342a'); },
  toolChest(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.55, 0, 1.0, 1.1, 0.5, '#c8342a', true); for (let i = 0; i < 6; i++) p.box('chrome', 0, 0.2 + i * 0.16, 0.26, 0.8, 0.02, 0.02, '#ccc'); },
  workbench(B, x, y, z, rot, len = 3) { const p = at(B, x, y, z, rot); p.box('wood', 0, 0.9, 0, len, 0.08, 0.8, '#8a6a4a', true); for (const s of [-1, 1]) p.box('metal', s * (len / 2 - 0.1), 0.45, 0, 0.08, 0.9, 0.7, '#555'); p.box('metal', 0, 1.6, -0.38, len, 1.2, 0.04, '#6b7075'); for (let i = 0; i < 10; i++) p.box('metal', -len / 2 + 0.2 + i * (len - 0.4) / 9, 1.6 + (i % 3) * 0.2, -0.34, 0.04, 0.25, 0.03, '#2a2a2a'); },
  tyres(B, x, y, z, n = 4) { for (let i = 0; i < n; i++) B.cyl('plastic', x, y + i * 0.24, z, 0.34, 0.23, '#1a1a1a', { seg: 14 }); B.collider(x, y + n * 0.12, z, 0.34, n * 0.12, 0.34); },
  cellBars(B, x, y, z, rot, len = 3, h = 2.6) { const p = at(B, x, y, z, rot); for (let u = -len / 2; u <= len / 2 + 0.01; u += 0.14) p.box('metal', u, h / 2, 0, 0.035, h, 0.035, '#3a3d42'); for (const yy of [0.05, h * 0.5, h - 0.05]) p.box('metal', 0, yy, 0, len, 0.06, 0.06, '#3a3d42'); },
  ticketMachine(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.9, 0, 0.8, 1.8, 0.5, '#1f6fb2', true); p.box('screen', 0, 1.3, 0.251, 0.5, 0.4, 0.01, '#9fd0ff'); p.box('plastic', 0, 0.8, 0.26, 0.4, 0.08, 0.04, '#222'); },
  turnstile(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('metal', 0, 0.5, 0, 0.25, 1.0, 1.0, '#c9ccd0', true); p.box('glassClear', 0.35, 0.8, 0.2, 0.45, 0.6, 0.02, '#fff'); },
  menuBoard(B, x, y, z, rot, atlas, text = 'MENU', style = { bg: '#1a1a1a', fg: '#f2d060' }, w = 2.4) { if (!atlas) return; const rect = atlas.add(text, style); at(B, x, y, z, rot).quad(atlas.material, 0, 0, 0, w, w / 4, rect); },
  kiosk(B, x, y, z, rot, col = '#8a3d22') { const p = at(B, x, y, z, rot); F.counter(B, x, y, z, rot, 2.4, col); p.box('chrome', 0.6, 1.25, -0.1, 0.4, 0.4, 0.35, '#c9ccd0'); p.box('glassClear', -0.5, 1.3, 0.1, 1.0, 0.5, 0.5, '#fff'); },
  mirrorWall(B, x, y, z, rot, w = 6) { at(B, x, y, z, rot).box('chrome', 0, 1.4, 0, w, 2.2, 0.02, '#dfe6ec'); },
  pastryCase(B, x, y, z, rot) { const p = at(B, x, y, z, rot); p.box('wood', 0, 0.5, 0, 1.4, 1.0, 0.7, '#5a3a24', true); p.box('glassClear', 0, 1.25, 0, 1.4, 0.5, 0.7, '#fff'); const c = ['#c9a14a', '#8a4a2a', '#f4e6c0', '#d87a8a']; for (let i = 0; i < 8; i++) p.box('plastic', -0.55 + (i % 4) * 0.36, 1.08, -0.15 + Math.floor(i / 4) * 0.3, 0.2, 0.08, 0.2, c[i % 4]); },
  elevatorDoors(B, x, y, z, rot, col = '#b8bcc0') { const p = at(B, x, y, z, rot); p.box('stone', 0, 1.35, 0, 1.8, 2.7, 0.14, '#3a3d42'); p.box('chrome', -0.33, 1.1, 0.075, 0.64, 2.1, 0.02, col); p.box('chrome', 0.33, 1.1, 0.075, 0.64, 2.1, 0.02, col); p.box('light', 1.1, 1.2, 0.07, 0.1, 0.2, 0.02, '#ffe6a0'); p.box('light', 0, 2.4, 0.075, 0.5, 0.12, 0.01, '#ff9a40'); },
  treadRailing(B, x0, z0, x1, z1, y, col = '#2f3337') {
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    B.box('metal', cx, y + 1.0, cz, alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, col);
    for (let t = 0; t <= len; t += 0.4) { const px = x0 + (x1 - x0) * t / len, pz = z0 + (z1 - z0) * t / len; B.box('metal', px, y + 0.5, pz, 0.03, 1.0, 0.03, col); }
    B.collider(cx, y + 0.55, cz, alongX ? len / 2 : 0.05, 0.55, alongX ? 0.05 : len / 2);
  },
};
const offset = (x, z, rot, lx, lz) => { const c = Math.round(Math.cos(rot)), s = Math.round(Math.sin(rot)); return [x + lx * c + lz * s, z - lx * s + lz * c]; };
export const Furniture = F;

// ---------------------------------------------------------------- structure helpers
// Partition wall along X at z (x0..x1) or along Z at x, with door gaps {c, w, h, door?}.
function wall(ctx, axis, k, a0, a1, { y0 = 0, h, gaps = [], color = '#e8e4dc', mat = 'stucco' } = {}) {
  const { B } = ctx; h = h ?? ctx.h;
  const seg = (a, b, yy, hh) => {
    if (b - a < 0.02 || hh < 0.02) return;
    const m = (a + b) / 2;
    if (axis === 'x') B.box(mat, m, y0 + yy + hh / 2, k, b - a, hh, IW, color, { collide: true, tile: 3 });
    else B.box(mat, k, y0 + yy + hh / 2, m, IW, hh, b - a, color, { collide: true, tile: 3 });
  };
  let cur = a0;
  for (const g of [...gaps].sort((p, q) => p.c - q.c)) {
    const g0 = g.c - g.w / 2, g1 = g.c + g.w / 2, gh = g.h ?? 2.2;
    seg(cur, g0, 0, h); seg(g0, g1, gh, h - gh); cur = g1;
    // door casing
    const cas = (u, len) => axis === 'x' ? B.box('frame', u, y0 + gh / 2, k, 0.06, gh, IW + 0.04, '#f2efe8') : B.box('frame', k, y0 + gh / 2, u, IW + 0.04, gh, 0.06, '#f2efe8');
    cas(g0 + 0.03); cas(g1 - 0.03);
    if (g.door) {
      // interior door leaf record: hinge at g0, opens toward -normal
      const n = g.door.normal ?? 1;
      const normal = axis === 'x' ? [0, 0, n] : [n, 0, 0], u = axis === 'x' ? [1, 0, 0] : [0, 0, 1];
      const hinge = axis === 'x' ? [g0, y0, k] : [k, y0, g0];
      ctx.doors.push({ hinge, normal, u, w: g.w, h: gh, kind: 'single', interactive: true, locked: !!g.door.locked, keyId: g.door.keyId || null, label: g.door.label || 'Door', style: g.door.style || 'wood', interior: true });
    }
  }
  seg(cur, a1, 0, h);
}
function floorFinish(ctx, mat, color, x0 = ctx.X0, x1 = ctx.X1, z0 = ctx.Z0, z1 = ctx.Z1, y = 0.13) { ctx.B.box(mat, (x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 0.02, z1 - z0, color, { tile: mat === 'tile' ? 1.2 : 2 }); }
function ceilingGrid(ctx, x0, x1, z0, z1, y, sx = 3, sz = 3, w = 1.2, d = 0.3) {
  for (let x = x0 + sx / 2; x < x1; x += sx) for (let z = z0 + sz / 2; z < z1; z += sz) F.ceilingLight(ctx.B, x, y, z, w, d);
}
function light(ctx, x, y, z, intensity = 14, color = '#fff1dc', distance = 14) { ctx.lights.push({ x, y, z, intensity, color, distance }); }
function volume(ctx, name, x0, x1, z0, z1, y0 = 0, y1 = ctx.h) { ctx.volumes.push({ name, x0, x1, z0, z1, y0, y1 }); }
function act(ctx, type, x, y, z, label, extra = {}) { ctx.interactables.push({ type, x, y, z, label, ...extra }); }

// Straight stair: starts at (x, z) going along `dir` (±1 on Z) with n steps; each step a collider.
function stairs(ctx, x0, x1, zStart, dir, n, y0 = 0, rise = STEP_RISE, color = '#8a6a4a') {
  const { B } = ctx, w = x1 - x0, cx = (x0 + x1) / 2;
  for (let i = 0; i < n; i++) {
    const top = y0 + (i + 1) * rise, zc = zStart + dir * (i + 0.5) * STEP_RUN;
    B.box('wood', cx, (y0 + top) / 2, zc, w, top - y0, STEP_RUN, color);
    B.collider(cx, top - 0.06, zc, w / 2, 0.06, STEP_RUN / 2);
  }
  B.box('metal', x1, y0 + 0.5 + n * rise / 2, zStart + dir * n * STEP_RUN / 2, 0.04, 0.04, n * STEP_RUN, '#2f3337');
}
// Walkable upper floor collider with an optional opening.
function upperFloor(ctx, y, hole) {
  const { B, X0, X1, Z0, Z1 } = ctx, t = 0.125;
  if (!hole) { B.collider(0, y, 0, (X1 - X0) / 2, t, (Z1 - Z0) / 2); return; }
  const box = (a, b, c, d) => { if (b - a > 0.01 && d - c > 0.01) B.collider((a + b) / 2, y, (c + d) / 2, (b - a) / 2, t, (d - c) / 2); };
  box(X0, hole.x0, Z0, Z1); box(hole.x1, X1, Z0, Z1); box(hole.x0, hole.x1, Z0, hole.z0); box(hole.x0, hole.x1, hole.z1, Z1);
}

// ---------------------------------------------------------------- layouts
const L = {};

L.house = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, meta, r } = ctx, dx = ctx.mainDoor.x, two = meta.floors > 1;
  const sw = two ? stairwellFor('house', ctx.w, ctx.d, ctx.gfh) : null;
  const zm = Z0 + (Z1 - Z0) * 0.45, xb = X1 - 2.6, sx = sw ? sw.x1 + 0.05 : X0;
  floorFinish(ctx, 'wood', '#9a7452', X0, X1, zm, Z1);
  floorFinish(ctx, 'tile', '#d8d4cc', X0, X1, Z0, zm);
  // front/back split with a hall opening, bathroom off the kitchen
  wall(ctx, 'x', zm, sx, X1, { gaps: [{ c: Math.min(Math.max(dx, sx + 0.8), xb - 0.8), w: 1.2 }], color: '#efe8da' });
  wall(ctx, 'z', xb, Z0, zm, { gaps: [{ c: zm - 0.9, w: 0.85, door: { normal: -1, label: 'Bathroom' } }], color: '#dfe8ea' });
  // living room
  const lx = (sx + X1) / 2, lz = (zm + Z1) / 2;
  F.rug(B, lx, 0.13, lz, 2.8, 2.0, r.pick(['#8a6a5a', '#5a6a7a', '#7a7a5a']));
  F.sofa(B, lx, 0.13, lz + 1.0, Math.PI, r.pick(['#5a6470', '#6a4a3a', '#3f5a4a']));
  F.coffeeTable(B, lx, 0.13, lz);
  F.tvUnit(B, lx, 0.13, zm + 0.45, 0);
  F.armchair(B, X1 - 0.7, 0.13, lz, -Math.PI / 2);
  F.plant(B, X1 - 0.5, 0.13, Z1 - 0.5);
  if (!sw) F.bookshelf(B, X0 + 0.25, 0.13, lz, Math.PI / 2, 1.4, 2.0, r);
  // kitchen + dining
  F.kitchenRun(B, (X0 + xb) / 2 - 0.4, 0.13, Z0 + 0.32, 0, Math.min(3.6, xb - X0 - 1.6));
  F.diningSet(B, (X0 + xb) / 2, 0.13, (Z0 + zm) / 2 + 0.3, 0);
  // bathroom
  F.toilet(B, X1 - 0.4, 0.13, Z0 + 0.5, -Math.PI / 2);
  F.vanity(B, X1 - 0.3, 0.13, Z0 + 1.4, -Math.PI / 2);
  F.shower(B, xb + 0.55, 0.13, Z0 + 0.55, 0);
  ceilingGrid(ctx, X0, X1, Z0, Z1, h - 0.02, 4, 4, 0.6, 0.6);
  light(ctx, lx, h - 0.4, lz, 10); light(ctx, (X0 + xb) / 2, h - 0.4, (Z0 + zm) / 2, 8);
  volume(ctx, 'ground', X0, X1, Z0, Z1, 0, h);
  if (sw) {
    stairs(ctx, sw.x0 + 0.05, sw.x1 - 0.05, sw.z1, -1, sw.n, 0.13, (ctx.gfh + 0.125 - 0.13) / sw.n);
    const y = ctx.gfh + 0.125, fh = ctx.fh;
    upperFloor(ctx, ctx.gfh, sw);
    floorFinish(ctx, 'carpet', '#b8ad9c', X0, X1, Z0, Z1, y + 0.01);
    F.treadRailing(B, sw.x1, sw.z0, sw.x1, sw.z1, y);
    const zb = Z0 + (Z1 - Z0) * 0.55;
    wall(ctx, 'x', zb, sw.x1 + 0.1, X1, { y0: y, h: fh - 0.2, gaps: [{ c: sw.x1 + 1.0, w: 0.9, door: { normal: 1, label: 'Bedroom' } }], color: '#e6e0f0' });
    F.bed(B, (sw.x1 + X1) / 2 + 0.5, y, Z0 + 1.15, 0, r.pick(['#c9d4e0', '#e0c9c9', '#c9e0cf']));
    F.nightstand(B, (sw.x1 + X1) / 2 - 0.8, y, Z0 + 0.3, 0); F.nightstand(B, (sw.x1 + X1) / 2 + 1.8, y, Z0 + 0.3, 0);
    F.wardrobe(B, X1 - 0.35, y, zb - 1.2, -Math.PI / 2);
    F.desk(B, (sw.x1 + X1) / 2, y, Z1 - 0.5, Math.PI, true);
    F.bookshelf(B, X1 - 0.25, y, Z1 - 2.2, -Math.PI / 2, 1.2, 1.8, r);
    ceilingGrid(ctx, X0, X1, Z0, Z1, y + fh - 0.3, 4, 4, 0.6, 0.6);
    light(ctx, (X0 + X1) / 2, y + fh - 0.6, (Z0 + zb) / 2, 8);
    volume(ctx, 'upstairs', X0, X1, Z0, Z1, y - 0.1, y + fh - 0.2);
  }
};

L.apartmentLobby = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx, sw = stairwellFor('apartmentLobby', ctx.w, ctx.d, ctx.gfh);
  // lobby spine x ∈ [-4, 4]; side ground-floor flats are closed off
  floorFinish(ctx, 'stone', '#cfc8bb', -4, 4, Z0, Z1);
  wall(ctx, 'z', -4, Z0, Z1, { color: '#e9e2d4' }); wall(ctx, 'z', 4, Z0, Z1, { color: '#e9e2d4' });
  for (let i = 0; i < 12; i++) B.box('metal', -3.85, 1.2 + Math.floor(i / 4) * 0.35, Z1 - 3 + (i % 4) * 0.34, 0.06, 0.3, 0.3, '#b08a4a'); // mailboxes
  F.bench(B, -3.5, 0.13, Z1 - 5.2, Math.PI / 2, 1.6);
  F.plant(B, -3.4, 0.13, Z1 - 0.8); F.plant(B, 3.4, 0.13, Z1 - 0.8);
  F.elevatorDoors(B, -1.2, 0.13, Z0 + 0.1, 0);
  act(ctx, 'elevator', -1.2, 0.13, Z0 + 1.0, 'Elevator', { stops: [0.13, ctx.gfh + 0.25], dx: -1.2, dz: Z0 + 1.0 });
  stairs(ctx, sw.x0, sw.x1, sw.z1, -1, sw.n, 0.13, (ctx.gfh + 0.125 - 0.13) / sw.n);
  ceilingGrid(ctx, -4, 4, Z0, Z1, h - 0.02, 4, 3.5, 0.8, 0.8);
  light(ctx, 0, h - 0.5, 0, 12);
  volume(ctx, 'lobby', -4, 4, Z0, Z1, 0, h);
  // first floor: corridor + Apartment 201 (hero unit) on the left
  const y = ctx.gfh + 0.125, fh = ctx.fh;
  upperFloor(ctx, ctx.gfh, sw);
  F.treadRailing(B, sw.x0, sw.z0, sw.x0, sw.z1, y);
  floorFinish(ctx, 'carpet', '#6a4a4a', -4, 4, Z0, Z1, y + 0.01);
  wall(ctx, 'z', -4, Z0, Z1, { y0: y, h: fh - 0.25, gaps: [{ c: 0, w: 0.95, door: { normal: 1, label: 'Apt 201', keyId: 'key_apt_201' } }], color: '#e9e2d4' });
  wall(ctx, 'z', 4, Z0, Z1, { y0: y, h: fh - 0.25, gaps: [{ c: 0, w: 0.95, door: { normal: -1, locked: true, keyId: 'key_apt_202', label: 'Apt 202' } }], color: '#e9e2d4' });
  F.elevatorDoors(B, -1.2, y, Z0 + 0.1, 0);
  // Apt 201: living/kitchen towards the street, bedroom + bath at the back
  const ax0 = X0, ax1 = -4, zb = Z0 + (Z1 - Z0) * 0.42;
  floorFinish(ctx, 'wood', '#a07a58', ax0, ax1, zb, Z1, y + 0.01);
  floorFinish(ctx, 'carpet', '#b8ad9c', ax0, ax1 - 3, Z0, zb, y + 0.01);
  floorFinish(ctx, 'tile', '#e4e8ea', ax1 - 3, ax1, Z0, zb, y + 0.01);
  wall(ctx, 'x', zb, ax0, ax1, { y0: y, h: fh - 0.25, gaps: [{ c: ax0 + 3, w: 0.9, door: { normal: 1, label: 'Bedroom' } }, { c: ax1 - 1.5, w: 0.8, door: { normal: 1, label: 'Bathroom' } }], color: '#efe8da' });
  wall(ctx, 'z', ax1 - 3, Z0, zb, { y0: y, h: fh - 0.25, color: '#dfe8ea' });
  const lx = (ax0 + ax1) / 2;
  F.sofa(B, lx, y, Z1 - 1.8, Math.PI, '#4a5a6a'); F.coffeeTable(B, lx, y, Z1 - 3.0); F.tvUnit(B, lx, y, zb + 0.4, 0);
  F.rug(B, lx, y, Z1 - 3.0, 3, 2.2, '#7a5a4a');
  F.kitchenRun(B, ax0 + 0.32, y, (zb + Z1) / 2, Math.PI / 2, 3.0);
  F.diningSet(B, ax0 + 2.2, y, zb + 1.4, 0);
  F.bed(B, (ax0 + ax1 - 3) / 2, y, Z0 + 1.15, 0); F.wardrobe(B, ax0 + 0.35, y, zb - 1.2, Math.PI / 2);
  F.nightstand(B, (ax0 + ax1 - 3) / 2 + 1.1, y, Z0 + 0.3, 0);
  F.toilet(B, ax1 - 0.4, y, Z0 + 0.5, -Math.PI / 2); F.vanity(B, ax1 - 0.3, y, Z0 + 1.5, -Math.PI / 2); F.shower(B, ax1 - 2.5, y, Z0 + 0.55, 0);
  F.plant(B, ax1 - 0.5, y, Z1 - 0.5);
  ceilingGrid(ctx, ax0, 4, Z0, Z1, y + fh - 0.3, 4, 4, 0.6, 0.6);
  light(ctx, lx, y + fh - 0.7, Z1 - 3, 10); light(ctx, 0, y + fh - 0.7, 0, 8);
  volume(ctx, 'corridor', -4, 4, Z0, Z1, y - 0.1, y + fh);
  volume(ctx, 'apt201', ax0, ax1, Z0, Z1, y - 0.1, y + fh);
};

// Generic retail unit inside a rectangle; kind drives the fit-out.
function retailUnit(ctx, kind, x0, x1, z0, z1, doorX, name) {
  const { B, h, r } = ctx, cx = (x0 + x1) / 2, W = x1 - x0, D = z1 - z0;
  const stockZ = z0 + Math.min(2.6, D * 0.2);
  floorFinish(ctx, kind === 'cafe' ? 'wood' : 'tile', kind === 'cafe' ? '#8a6446' : '#e2ddd4', x0, x1, stockZ, z1);
  floorFinish(ctx, 'concrete', '#8f8c86', x0, x1, z0, stockZ);
  wall(ctx, 'x', stockZ, x0, x1, { gaps: [{ c: x1 - 1.2, w: 0.95, door: { normal: 1, label: 'Staff only', locked: true, keyId: 'key_service' } }], color: '#e8e4dc' });
  for (let i = 0; i < Math.floor(W / 2.2); i++) B.box('wood', x0 + 1.1 + i * 2.2, 0.8, z0 + 0.6, 1.8, 1.6, 1.0, '#a08260', { collide: true }); // stock crates
  // cash desk beside the entrance, facing into the shop
  const cdx = doorX + (doorX > cx ? -2.4 : 2.4);
  const counterZ = z1 - 2.4;
  if (kind === 'cafe') {
    F.counter(B, cx, 0.13, stockZ + 1.3, 0, Math.min(W - 2, 5), '#5a3a24', '#e8e0d0');
    F.pastryCase(B, cx - 1.2, 0.13, stockZ + 1.3, 0); F.register(B, cx + 1.2, 0.13, stockZ + 1.3, 0);
    B.box('chrome', cx + 0.3, 1.25, stockZ + 1.25, 0.6, 0.45, 0.4, '#c9ccd0');
    F.menuBoard(B, cx, 2.7, stockZ + 0.08, 0, ctx.atlas, name || 'CAFE', { bg: '#1a1a1a', fg: '#f2d060' }, 2.8);
    for (let i = 0; i < Math.floor((W - 1) / 2.4); i++) for (let j = 0; j < 2; j++) {
      const tx = x0 + 1.4 + i * 2.4, tz = stockZ + 3.4 + j * 2.2; if (tz > z1 - 1) continue;
      B.cyl('wood', tx, 0.13 + 0.72, tz, 0.4, 0.04, '#6b4a33', { seg: 14 }); B.cyl('metal', tx, 0.13, tz, 0.05, 0.72, '#222', { seg: 6 }); B.collider(tx, 0.5, tz, 0.4, 0.4, 0.4);
      F.chair(B, tx - 0.65, 0.13, tz, Math.PI / 2); F.chair(B, tx + 0.65, 0.13, tz, -Math.PI / 2);
    }
    act(ctx, 'shop', cx, 0.13, stockZ + 2.2, name || 'Cafe', { shop: 'cafe' });
  } else if (kind === 'clothing') {
    for (let x = x0 + 1.6; x < x1 - 1.2; x += 2.4) F.rack(B, x, 0.13, (stockZ + z1) / 2 - 1, 0, 1.6, r);
    for (let x = x0 + 1.6; x < x1 - 1.2; x += 3.2) F.displayTable(B, x + 0.8, 0.13, z1 - 3.4, 0, r);
    F.mirrorWall(B, x0 + 0.08, 0.13, (stockZ + z1) / 2, Math.PI / 2, 3);
    // fitting rooms against the stock wall
    for (let i = 0; i < 2; i++) { const fx = x0 + 1 + i * 1.3; B.box('stucco', fx + 0.6, 1.2, stockZ + 0.8, IW, 2.2, 1.4, '#d8d2c6', { collide: true }); F.curtain(B, fx, 0.13, stockZ + 1.5, 0, 1.2, '#5a3a4a'); }
    F.counter(B, cdx, 0.13, counterZ, 0, 2.0, '#1c1c1c'); F.register(B, cdx, 0.13, counterZ, 0);
    act(ctx, 'shop', cdx, 0.13, counterZ + 1, name || 'Clothing', { shop: 'clothing' });
  } else if (kind === 'electronics') {
    for (let x = x0 + 1.6; x < x1 - 1.2; x += 3) { F.table(B, x, 0.13, (stockZ + z1) / 2, 0, 1.8, 0.9, '#f2f2f2', 0.9); for (let i = 0; i < 3; i++) { B.box('plastic', x - 0.6 + i * 0.6, 0.13 + 1.1, (stockZ + z1) / 2, 0.45, 0.3, 0.03, '#111'); B.box('screen', x - 0.6 + i * 0.6, 0.13 + 1.1, (stockZ + z1) / 2 + 0.02, 0.42, 0.27, 0.005, '#6fa8ff'); } }
    for (let x = x0 + 1; x < x1 - 1; x += 1.5) { B.box('plastic', x, 2.0, stockZ + 0.1, 1.3, 0.75, 0.05, '#111'); B.box('screen', x, 2.0, stockZ + 0.14, 1.24, 0.69, 0.005, r.pick(['#4fa0ff', '#ff8a4f', '#6fdc8a'])); }
    F.counter(B, cdx, 0.13, counterZ, 0, 2.0, '#0f2438'); F.register(B, cdx, 0.13, counterZ, 0);
    act(ctx, 'shop', cdx, 0.13, counterZ + 1, name || 'Electronics', { shop: 'electronics' });
  } else { // convenience / pharmacy / general
    F.cooler(B, cx, 0.13, stockZ + 0.46, 0, Math.min(W - 1.2, 7.2));
    for (let x = x0 + 1.3; x < x1 - 2.8; x += 2.3) F.shelfUnit(B, x, 0.13, (stockZ + counterZ) / 2 + 0.3, Math.PI / 2, Math.min(3.6, counterZ - stockZ - 3.4), 1.7, r, true);
    F.shelfUnit(B, x1 - 0.3, 0.13, (stockZ + counterZ) / 2 + 0.5, -Math.PI / 2, Math.min(4, counterZ - stockZ - 2.2), 2.0, r, false);
    F.counter(B, cdx, 0.13, counterZ, Math.PI, 2.4, kind === 'pharmacy' ? '#2f7a4f' : '#c8342a'); F.register(B, cdx, 0.13, counterZ, Math.PI);
    F.shelfUnit(B, cdx, 0.13, counterZ - 1.2, 0, 2.4, 1.5, r, false);
    act(ctx, 'shop', cdx, 0.13, counterZ + 0.9, name || 'Store', { shop: kind });
  }
  ceilingGrid(ctx, x0, x1, stockZ, z1, h - 0.02, 2.6, 2.6, 1.2, 0.3);
  light(ctx, cx, h - 0.5, (stockZ + z1) / 2, 16, '#f4f8ff');
  volume(ctx, name || kind, x0, x1, z0, z1, 0, h);
}
const shopKind = (name = '') => /CAFE|COFFEE|BEAN|BAKERY|DINER|GRILL|PIZZA/i.test(name) ? 'cafe' : /THREAD|WEAR|CLOTH|FASHION|BOUTIQUE|APPAREL/i.test(name) ? 'clothing' : /PHARM|DRUG|CHEM/i.test(name) ? 'pharmacy' : /ELECTR|VOLT|TECH|PHONE/i.test(name) ? 'electronics' : 'convenience';

L.convenience = (ctx) => retailUnit(ctx, 'convenience', ctx.X0, ctx.X1, ctx.Z0, ctx.Z1, ctx.mainDoor.x, ctx.meta.name);

L.shops = (ctx) => {
  const shops = ctx.meta.shops || [];
  for (let i = 0; i < shops.length; i++) {
    const s = shops[i], x0 = Math.max(ctx.X0, s.u0 - 0.15), x1 = Math.min(ctx.X1, s.u1 + 0.15);
    if (i < shops.length - 1) wall(ctx, 'z', x1, ctx.Z0, ctx.Z1, { color: '#e8e4dc' });
    retailUnit(ctx, s.kind || shopKind(s.name), x0 + (i ? IW / 2 : 0), x1 - IW / 2, ctx.Z0, ctx.Z1, (s.u0 + s.u1) / 2 + (s.doorOffset ?? 0), s.name);
  }
};

L.bank = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx, zt = Z0 + 6;
  floorFinish(ctx, 'stone', '#e6dfd0', X0, X1, zt, Z1);
  for (let x = X0 + 1; x < X1; x += 2) for (let z = zt + 1; z < Z1; z += 2) B.box('stone', x, 0.142, z, 0.9, 0.005, 0.9, (Math.round(x + z) % 2) ? '#cfc6b4' : '#e6dfd0');
  floorFinish(ctx, 'carpet', '#5a3a3a', X0, X1, Z0, zt);
  // teller line: counter + glass screen + 3 windows
  F.counter(B, 0, 0.13, zt, Math.PI, 12, '#5a3a24', '#e8e0d0');
  B.box('glassClear', 0, 1.8, zt - 0.1, 12, 1.4, 0.03, '#fff'); B.box('wood', 0, 2.55, zt - 0.1, 12.1, 0.1, 0.2, '#5a3a24');
  for (const x of [-4, 0, 4]) { F.register(B, x, 0.13, zt, Math.PI); F.officeChair(B, x, zt - 0.9, 0.13, 0); act(ctx, 'teller', x, 0.13, zt + 1, 'Teller'); }
  wall(ctx, 'z', -6, Z0, zt, { gaps: [{ c: zt - 1, w: 0.95, door: { normal: 1, locked: true, keyId: 'key_bank_staff', label: 'Staff only' } }], color: '#e6dfd0' });
  wall(ctx, 'z', 6, Z0, zt, { color: '#e6dfd0' });
  wall(ctx, 'x', zt, X0, -6, { color: '#e6dfd0' }); wall(ctx, 'x', zt, 6, X1, { gaps: [{ c: (6 + X1) / 2, w: 0.95, door: { normal: 1, label: 'Manager', locked: true, keyId: 'key_bank_staff' } }], color: '#e6dfd0' });
  // vault door on the back wall
  B.box('metal', 0, 1.2, Z0 + 0.1, 3, 2.4, 0.2, '#555');
  const vg = new THREE.CylinderGeometry(1.3, 1.3, 0.35, 28); vg.rotateX(Math.PI / 2); vg.translate(0, 1.5, Z0 + 0.3); B.push('chrome', vg, '#a9aeb3');
  for (let a = 0; a < 6; a++) B.box('chrome', Math.cos(a) * 0.5, 1.5 + Math.sin(a) * 0.5, Z0 + 0.5, 0.08, 0.08, 0.2, '#ddd');
  act(ctx, 'vault', 0, 0.13, Z0 + 1.2, 'Vault');
  // manager office
  F.desk(B, (6 + X1) / 2, 0.13, Z0 + 1.2, 0); F.bookshelf(B, X1 - 0.25, 0.13, Z0 + 3, -Math.PI / 2, 1.2, 2, r);
  // customer side: ATMs, queue posts, benches, info desk, plants
  for (let i = 0; i < 3; i++) { F.atm(B, X0 + 0.45, 0.13, zt + 3 + i * 1.2, Math.PI / 2); act(ctx, 'atm', X0 + 1.2, 0.13, zt + 3 + i * 1.2, 'ATM'); }
  for (let i = 0; i < 5; i++) { B.cyl('chrome', -2 + i, 0.13, zt + 2.2, 0.05, 1.0, '#c9a14a', { seg: 8 }); if (i < 4) B.box('fabric', -1.5 + i, 1.0, zt + 2.2, 1, 0.06, 0.02, '#7a1f24'); }
  F.bench(B, X1 - 0.6, 0.13, zt + 4, -Math.PI / 2, 2.4, '#5a3a24'); F.plant(B, X1 - 0.6, 0.13, Z1 - 0.6, 1.6); F.plant(B, X0 + 0.6, 0.13, Z1 - 0.6, 1.6);
  F.table(B, 4, 0.13, Z1 - 3, 0, 1.2, 0.6, '#5a3a24', 1.05);
  ceilingGrid(ctx, X0, X1, Z0, Z1, h - 0.02, 4, 4, 0.9, 0.9);
  for (const x of [-5, 5]) { B.cyl('chrome', x, h - 1.2, (zt + Z1) / 2, 0.02, 1.2, '#c9a14a', { seg: 4 }); B.cyl('light', x, h - 1.6, (zt + Z1) / 2, 0.45, 0.4, '#fff3d6', { seg: 14, r2: 0.2 }); }
  light(ctx, 0, h - 1.0, (zt + Z1) / 2, 18, '#fff1d6', 16); light(ctx, 0, 3, Z0 + 3, 8);
  volume(ctx, 'hall', X0, X1, Z0, Z1, 0, h);
};

L.police = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx, zf = Z1 - 6.5, zc = Z0 + 4.2;
  floorFinish(ctx, 'tile', '#c9ccd0', X0, X1, Z0, Z1);
  // public lobby at the front; secure line behind the reception
  F.counter(B, 0, 0.13, zf + 1.4, 0, 5, '#1c2a4a', '#d8d2c6'); B.box('glassClear', 0, 1.75, zf + 1.45, 5, 1.3, 0.03, '#fff');
  F.officeChair(B, -1, zf + 0.6, 0.13, 0); F.officeChair(B, 1, zf + 0.6, 0.13, 0); F.register(B, -1, 0.13, zf + 1.4, 0);
  act(ctx, 'reception', 0, 0.13, zf + 2.4, 'Front desk');
  F.seatRow(B, X0 + 3, 0.13, Z1 - 0.6, Math.PI, 5, '#2f3a5a'); F.seatRow(B, X1 - 3, 0.13, Z1 - 0.6, Math.PI, 5, '#2f3a5a');
  F.menuBoard(B, 0, 3.2, zf + 0.07, 0, ctx.atlas, 'HARBOR HEIGHTS PD', { bg: '#1c2a4a', fg: '#fff', accent: '#f2c230' }, 3.2);
  wall(ctx, 'x', zf, X0, X1, { gaps: [{ c: 4, w: 1.0, door: { normal: 1, locked: true, keyId: 'key_police', label: 'Secure area' } }], color: '#dfe2e6' });
  // offices (left), interview room (right), holding cells along the back
  wall(ctx, 'x', zc, X0, X1, { gaps: [{ c: -4, w: 1.4 }, { c: 8, w: 1.0, door: { normal: 1, label: 'Holding', locked: true, keyId: 'key_police' } }], color: '#dfe2e6' });
  wall(ctx, 'z', -2, zc, zf, { gaps: [{ c: zf - 1.2, w: 1.0 }], color: '#dfe2e6' });
  wall(ctx, 'z', X1 - 5, zc, zf, { gaps: [{ c: zf - 1.2, w: 0.95, door: { normal: -1, label: 'Interview' } }], color: '#dfe2e6' });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) F.desk(B, X0 + 2.2 + i * 3.4, 0.13, zc + 1.6 + j * 3.3, 0);
  F.whiteboard(B, X0 + 0.08, 0.13, (zc + zf) / 2, Math.PI / 2, 3.2); F.locker(B, -2.3, 0.13, zc + 2.5, -Math.PI / 2, 5, '#4a5560');
  // bullpen between offices and interview
  F.table(B, (X1 - 5 - 2) / 2 + 0.5, 0.13, (zc + zf) / 2, 0, 3, 1.2, '#d8d2c6'); for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) F.chair(B, (X1 - 5 - 2) / 2 + 0.5 + k, 0.13, (zc + zf) / 2 + s * 0.9, s > 0 ? Math.PI : 0, '#333');
  // interview room: table, two chairs, one-way mirror
  const ix = X1 - 2.5, iz = (zc + zf) / 2;
  F.table(B, ix, 0.13, iz, 0, 1.4, 0.8, '#9aa0a6'); F.chair(B, ix, 0.13, iz - 0.8, 0, '#333'); F.chair(B, ix, 0.13, iz + 0.8, Math.PI, '#333');
  B.box('chrome', X1 - 5 + 0.08, 1.5, iz, 0.02, 1.0, 2.4, '#3a4046');
  act(ctx, 'interview', ix, 0.13, iz, 'Interview room');
  // holding cells: bar fronts with barred doors
  const cw = 3.4, n = 4, cx0 = X1 - n * cw - 0.2;
  for (let i = 0; i < n; i++) {
    const x0 = cx0 + i * cw, x1 = x0 + cw;
    if (i > 0) wall(ctx, 'z', x0, Z0, Z0 + 3, { color: '#b9bcc0' });
    F.cellBars(B, x0 + 1.1 + (cw - 1.1) / 2, 0.13, Z0 + 3, 0, cw - 1.1);
    B.collider(x0 + 1.1 + (cw - 1.1) / 2, 1.4, Z0 + 3, (cw - 1.1) / 2, 1.3, 0.05);
    ctx.doors.push({ hinge: [x0 + 0.05, 0.13, Z0 + 3], normal: [0, 0, 1], u: [1, 0, 0], w: 1.0, h: 2.3, kind: 'single', interactive: true, locked: true, keyId: 'key_police', label: `Cell ${i + 1}`, style: 'bars', interior: true });
    F.bench(B, (x0 + x1) / 2 + 0.3, 0.13, Z0 + 0.4, 0, 1.8, '#8a8f95'); F.toilet(B, x0 + 0.4, 0.13, Z0 + 0.5, Math.PI / 2);
    act(ctx, 'cell', (x0 + x1) / 2, 0.13, Z0 + 1.5, `Cell ${i + 1}`, { cell: i });
  }
  wall(ctx, 'z', cx0, Z0, zc, { color: '#b9bcc0' });
  F.locker(B, X0 + 2.5, 0.13, Z0 + 0.3, 0, 6, '#3a4550'); F.table(B, X0 + 3, 0.13, Z0 + 2.4, 0, 2, 1, '#9aa0a6');
  ceilingGrid(ctx, X0, X1, Z0, Z1, h - 0.02, 3.4, 3.4, 1.2, 0.3);
  light(ctx, 0, h - 0.5, Z1 - 3, 14, '#f0f6ff'); light(ctx, X0 + 6, h - 0.5, (zc + zf) / 2, 12, '#f0f6ff'); light(ctx, X1 - 7, h - 0.5, Z0 + 2, 10, '#f0f6ff');
  volume(ctx, 'station', X0, X1, Z0, Z1, 0, h);
};

L.clinic = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx, zc = Z0 + 7, zr = Z1 - 7;
  floorFinish(ctx, 'tile', '#e8eef0', X0, X1, Z0, Z1);
  const dx = ctx.mainDoor.x;
  F.counter(B, dx + 5, 0.13, Z1 - 3.2, 0, 4.4, '#ffffff', '#b8d0dc'); F.register(B, dx + 4, 0.13, Z1 - 3.2, 0); F.officeChair(B, dx + 5, Z1 - 4.1, 0.13, 0);
  act(ctx, 'reception', dx + 5, 0.13, Z1 - 2.2, 'Reception');
  F.menuBoard(B, dx + 5, 3.0, zr + 0.07, 0, ctx.atlas, 'RECEPTION', { bg: '#1f5f8a', fg: '#fff' }, 2.4);
  for (let i = 0; i < 3; i++) F.seatRow(B, X0 + 4.5, 0.13, Z1 - 1.5 - i * 1.5, Math.PI, 6, '#3f7a8a');
  F.plant(B, X0 + 0.6, 0.13, Z1 - 0.6, 1.4); F.tvUnit(B, X0 + 4.5, 0.13, zr + 0.4, 0);
  wall(ctx, 'x', zr, X0, X1, { gaps: [{ c: 0, w: 1.8 }], color: '#f2f5f6' });
  // corridor between zc and zr, treatment rooms behind zc
  const rooms = 5, rw = (X1 - X0) / rooms;
  wall(ctx, 'x', zc, X0, X1, { gaps: Array.from({ length: rooms }, (_, i) => ({ c: X0 + rw * i + rw - 1.0, w: 1.2, door: { normal: 1, label: `Treatment ${i + 1}` } })), color: '#f2f5f6' });
  for (let i = 1; i < rooms; i++) wall(ctx, 'z', X0 + rw * i, Z0, zc, { color: '#f2f5f6' });
  for (let i = 0; i < rooms; i++) {
    const x = X0 + rw * i + rw / 2;
    F.hospitalBed(B, x - 1.2, 0.13, Z0 + 1.3, 0); F.curtain(B, x - 1.2, 0.13, Z0 + 2.7, 0, 2.2, '#8fb6c8');
    B.box('metal', x + 1.3, 0.9, Z0 + 0.35, 1.2, 1.8, 0.5, '#e8ecef', { collide: true }); F.chair(B, x + 1.1, 0.13, Z0 + 2.6, Math.PI);
    B.box('screen', x + 0.2, 1.8, Z0 + 0.06, 0.6, 0.4, 0.02, '#5fd18a');
    act(ctx, 'treatment', x - 1.2, 0.13, Z0 + 3.2, `Treatment ${i + 1}`, { bed: i });
  }
  for (let x = X0 + 4; x < X1 - 2; x += 8) F.bench(B, x, 0.13, zr - 0.4, Math.PI, 2.0, '#8fb6c8');
  B.box('paint', 0, 0.15, (zc + zr) / 2, X1 - X0 - 1, 0.005, 0.15, '#3f9adf'); B.box('paint', 0, 0.15, (zc + zr) / 2 + 0.3, X1 - X0 - 1, 0.005, 0.15, '#5fd18a');
  ceilingGrid(ctx, X0, X1, Z0, Z1, h - 0.02, 3.4, 3.4, 1.2, 0.3);
  light(ctx, X0 + 5, h - 0.5, Z1 - 3, 14, '#f4fbff'); light(ctx, 0, h - 0.5, (zc + zr) / 2, 12, '#f4fbff'); light(ctx, X1 - 6, h - 0.5, Z0 + 3, 10, '#f4fbff');
  volume(ctx, 'clinic', X0, X1, Z0, Z1, 0, h);
};

L.school = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx, zc0 = -1.6, zc1 = 1.6;
  floorFinish(ctx, 'tile', '#d8d0c0', X0, X1, zc0, zc1); floorFinish(ctx, 'tile', '#d8d0c0', -3, 3, zc1, Z1);
  // entry hall (x -3..3) to the corridor; classrooms front/back on both sides
  wall(ctx, 'z', -3, zc1, Z1, { color: '#efe6d2' }); wall(ctx, 'z', 3, zc1, Z1, { color: '#efe6d2' });
  const rooms = [[X0, -3], [3, X1]];
  const backRooms = [[X0, -8], [-8, 2], [2, 12], [12, X1]];
  wall(ctx, 'x', zc1, X0, -3, { gaps: [{ c: -5, w: 1.0, door: { normal: -1, label: 'Room 101' } }, { c: X0 + 2, w: 1.0 }], color: '#efe6d2' });
  wall(ctx, 'x', zc1, 3, X1, { gaps: [{ c: 5, w: 1.0, door: { normal: -1, label: 'Room 102' } }, { c: X1 - 2, w: 1.0 }], color: '#efe6d2' });
  wall(ctx, 'x', zc0, X0, X1, { gaps: backRooms.map(([a, b], i) => ({ c: b - 1.2, w: 1.0, door: { normal: 1, label: i === 1 ? 'Staff room' : `Room ${103 + i}` } })), color: '#efe6d2' });
  for (let i = 1; i < backRooms.length; i++) wall(ctx, 'z', backRooms[i][0], Z0, zc0, { color: '#efe6d2' });
  const classroom = (x0, x1, z0, z1, facing) => {
    floorFinish(ctx, 'wood', '#b08a5a', x0, x1, z0, z1);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, boardZ = facing > 0 ? z1 - 0.08 : z0 + 0.08;
    F.whiteboard(B, cx, 0.13, boardZ, facing > 0 ? Math.PI : 0, Math.min(4, x1 - x0 - 2));
    F.desk(B, cx + 1.5, 0.13, boardZ - facing * 1.4, facing > 0 ? 0 : Math.PI, true);
    const cols = Math.min(5, Math.floor((x1 - x0 - 1) / 1.6)), rows = Math.min(4, Math.floor((z1 - z0 - 3.2) / 1.4));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const dx = cx - (cols - 1) * 0.8 + i * 1.6, dz = boardZ - facing * (2.8 + j * 1.4);
      F.table(B, dx, 0.13, dz, 0, 1.0, 0.55, '#c9b89a', 0.72); F.chair(B, dx, 0.13, dz - facing * 0.5, facing > 0 ? 0 : Math.PI, '#2f4f8a');
    }
    F.bookshelf(B, x0 + 0.25, 0.13, cz, Math.PI / 2, 1.6, 1.4, r);
    ceilingGrid(ctx, x0, x1, z0, z1, h - 0.02, 3, 3, 1.2, 0.3);
  };
  classroom(X0, -3, zc1, Z1, -1); classroom(3, X1, zc1, Z1, -1);
  classroom(X0, -8, Z0, zc0, 1); classroom(2, 12, Z0, zc0, 1); classroom(12, X1, Z0, zc0, 1);
  // staff room
  floorFinish(ctx, 'carpet', '#6a7a8a', -8, 2, Z0, zc0);
  F.diningSet(B, -4.5, 0.13, Z0 + 3.5, 0); F.sofa(B, -1, 0.13, Z0 + 4.5, Math.PI, '#5a6470'); F.kitchenRun(B, -5, 0.13, Z0 + 0.32, 0, 3.0);
  // corridor lockers + trophy case
  for (let x = X0 + 4; x < X1 - 4; x += 5) if (Math.abs(x) > 4 && ![-5, X0 + 2, 5, X1 - 2].some((c) => Math.abs(c - x) < 2.4)) F.locker(B, x, 0.13, zc1 - 0.3, Math.PI, 8, r.pick(['#3f5a8a', '#8a2f2f', '#2f6a4a']));
  B.box('glassClear', -4, 1.5, zc0 + 0.35, 3, 1.4, 0.5, '#fff'); for (let i = 0; i < 5; i++) B.cyl('chrome', -5.2 + i * 0.6, 1.0, zc0 + 0.35, 0.08, 0.3 + (i % 2) * 0.15, '#d4af37', { seg: 8 });
  F.menuBoard(B, -4, 3.0, zc0 + 0.07, 0, ctx.atlas, 'GO MARINERS!', { bg: '#7a1f24', fg: '#f4e6c0' }, 3.2);
  ceilingGrid(ctx, X0, X1, zc0, zc1, h - 0.02, 3.6, 3.2, 1.2, 0.3);
  light(ctx, 0, h - 0.5, 0, 12); light(ctx, X0 + 10, h - 0.5, Z1 - 4, 10); light(ctx, X1 - 10, h - 0.5, Z0 + 4, 10);
  volume(ctx, 'school', X0, X1, Z0, Z1, 0, h);
};

function officeFloor(ctx, y, x0, x1, z0, z1, coreX, coreZ) {
  const { B, r } = ctx;
  floorFinish(ctx, 'carpet', '#5a6470', x0, x1, z0, z1, y + 0.01);
  // desk clusters, meeting room with glass walls, kitchenette
  for (let x = x0 + 2.5; x < x1 - 6; x += 3.4) for (let z = z0 + 2; z < z1 - 2; z += 3.6) {
    if (Math.abs(x - coreX) < 3.5 && Math.abs(z - coreZ) < 4) continue;
    F.desk(B, x, y, z, 0); F.desk(B, x, y, z + 1.6, Math.PI);
    if (r.chance(0.5)) F.plant(B, x + 1.0, y, z + 0.8, 0.6);
  }
  const mx0 = x1 - 6, mz0 = z0, mz1 = z0 + 5;
  B.box('glassClear', mx0, y + 1.4, (mz0 + mz1) / 2, 0.03, 2.6, 5, '#fff'); B.box('glassClear', (mx0 + x1) / 2, y + 1.4, mz1, 6, 2.6, 0.03, '#fff');
  B.collider(mx0, y + 1.4, (mz0 + mz1) / 2 - 0.6, 0.05, 1.3, 1.9); B.collider((mx0 + x1) / 2 + 0.6, y + 1.4, mz1, 2.4, 1.3, 0.05);
  F.table(B, (mx0 + x1) / 2, y, (mz0 + mz1) / 2, 0, 3.2, 1.3, '#3a3430'); for (let k = -1; k <= 1; k++) for (const s of [-1, 1]) F.officeChair(B, (mx0 + x1) / 2 + k * 1, (mz0 + mz1) / 2 + s * 1.0, y, s > 0 ? Math.PI : 0);
  F.tvUnit(B, x1 - 0.3, y, (mz0 + mz1) / 2, -Math.PI / 2);
  F.kitchenRun(B, x1 - 0.32, y, z1 - 2.5, -Math.PI / 2, 2.4); F.table(B, x1 - 2.5, y, z1 - 2.5, 0, 1.2, 1.2, '#e8e2d6');
  F.plant(B, x0 + 0.6, y, z1 - 0.6, 1.4); F.plant(B, x1 - 0.6, y, z1 - 0.6, 1.4);
  act(ctx, 'workstation', (x0 + x1) / 2, y, (z0 + z1) / 2, 'Office floor');
}

L.office = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx;
  floorFinish(ctx, 'stone', '#cfc9bd', X0, X1, Z0, Z1);
  F.counter(B, 0, 0.13, Z1 - 4, 0, 3.6, '#2b2e33', '#e8e4dc'); F.officeChair(B, 0, Z1 - 4.9, 0.13, 0); F.register(B, 1, 0.13, Z1 - 4, 0);
  act(ctx, 'reception', 0, 0.13, Z1 - 3, 'Reception');
  F.sofa(B, X0 + 2.5, 0.13, Z1 - 1.2, Math.PI, '#3a3d42', 2.4); F.coffeeTable(B, X0 + 2.5, 0.13, Z1 - 2.4); F.plant(B, X0 + 0.6, 0.13, Z1 - 0.6, 1.6); F.plant(B, X1 - 0.6, 0.13, Z1 - 0.6, 1.6);
  F.menuBoard(B, 0, 2.8, Z0 + 3.07, 0, ctx.atlas, ctx.meta.name.toUpperCase(), { bg: '#2b2e33', fg: '#e8e4dc' }, 3.4);
  wall(ctx, 'x', Z0 + 3, X0, X1, { gaps: [{ c: X0 + 2, w: 1.0, door: { normal: 1, locked: true, keyId: 'key_office', label: 'Staff' } }], color: '#e2ddd2' });
  for (const x of [-2.2, 2.2]) F.elevatorDoors(B, x, 0.13, Z0 + 3.08, 0);
  const y2 = ctx.gfh + 0.125;
  act(ctx, 'elevator', 0, 0.13, Z0 + 4.0, 'Elevator', { stops: [0.13, y2], dx: 0, dz: Z0 + 4.0 });
  ceilingGrid(ctx, X0, X1, Z0 + 3, Z1, h - 0.02, 3.4, 3.4, 1.2, 0.3);
  light(ctx, 0, h - 0.5, Z1 - 4, 14, '#f4f8ff');
  volume(ctx, 'lobby', X0, X1, Z0, Z1, 0, h);
  // floor 2: open-plan office
  upperFloor(ctx, ctx.gfh, null);
  for (const x of [-2.2, 2.2]) F.elevatorDoors(B, x, y2, Z0 + 3.08, 0);
  wall(ctx, 'x', Z0 + 3, X0, X1, { y0: y2, h: ctx.fh - 0.25, color: '#e2ddd2' });
  officeFloor(ctx, y2, X0, X1, Z0 + 3.1, Z1, 0, Z0 + 4);
  ceilingGrid(ctx, X0, X1, Z0 + 3, Z1, y2 + ctx.fh - 0.3, 3.4, 3.4, 1.2, 0.3);
  light(ctx, 0, y2 + ctx.fh - 0.7, 0, 12, '#f4f8ff');
  volume(ctx, 'floor2', X0, X1, Z0, Z1, y2 - 0.1, y2 + ctx.fh);
};

L.officeLobby = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, meta } = ctx;
  floorFinish(ctx, 'stone', '#d8d2c6', X0, X1, Z0, Z1);
  for (let x = X0 + 2; x < X1; x += 4) B.box('stone', x, 0.142, 0, 0.12, 0.005, Z1 - Z0 - 1, '#2b2e33');
  // elevator core in the centre with 4 cars, security line, reception, seating
  B.box('stone', 0, h / 2, -2, 8, h, 5, '#3a3d42', { collide: true });
  for (const x of [-2.4, 0, 2.4]) F.elevatorDoors(B, x, 0.13, 0.58, 0);
  F.counter(B, -9, 0.13, 6, 0, 4, '#1f2226', '#d8dde2'); F.register(B, -9, 0.13, 6, 0); act(ctx, 'reception', -9, 0.13, 7, 'Security desk');
  for (let i = 0; i < 4; i++) F.turnstile(B, -1.8 + i * 1.2, 0.13, 4, 0);
  B.collider(-6, 0.6, 4, 3.4, 0.6, 0.05); B.collider(6, 0.6, 4, 3.4, 0.6, 0.05);
  B.box('metal', -6, 0.6, 4, 6.8, 1.2, 0.08, '#3a3d42'); B.box('metal', 6, 0.6, 4, 6.8, 1.2, 0.08, '#3a3d42');
  for (const s of [-1, 1]) { F.sofa(B, s * 10, 0.13, Z1 - 2.5, Math.PI, '#2b2e33', 2.6); F.plant(B, s * 13, 0.13, Z1 - 1, 2.0); F.plant(B, s * 13, 0.13, Z0 + 1, 2.0); }
  B.box('stone', 10, 0.5, -8, 6, 1, 3, '#2b2e33', { collide: true }); B.box('leaves', 10, 1.2, -8, 5.6, 0.4, 2.6, '#3f7a3a');
  F.menuBoard(B, 0, 6.5, 0.6, 0, ctx.atlas, meta.name.toUpperCase(), { bg: '#1f2226', fg: '#d8dde2' }, 5);
  ceilingGrid(ctx, X0, X1, Z0, Z1, h - 0.02, 4, 4, 1.6, 0.2);
  light(ctx, 0, h - 1, 6, 22, '#f4f8ff', 20); light(ctx, 0, h - 1, -8, 16, '#f4f8ff', 20);
  volume(ctx, 'lobby', X0, X1, Z0, Z1, 0, h);
  // elevator to an office floor inside the curtain-wall shaft
  const tw = meta.tw ?? 28, td = meta.td ?? 26, fy = meta.officeY;
  if (fy) {
    act(ctx, 'elevator', 0, 0.13, 1.4, 'Elevator', { stops: [0.13, fy], dx: 0, dz: 1.4 });
    const c = { ...ctx, X0: -tw / 2 + 0.2, X1: tw / 2 - 0.2, Z0: -td / 2 + 0.2, Z1: td / 2 - 0.2 };
    B.collider(0, fy - 0.125, 0, tw / 2, 0.125, td / 2);
    B.box('stone', 0, fy + 1.7, -2, 8, 3.4, 5, '#3a3d42', { collide: true });
    for (const x of [-2.4, 0, 2.4]) F.elevatorDoors(B, x, fy, 0.58, 0);
    officeFloor(c, fy, c.X0, c.X1, c.Z0, c.Z1, 0, -2);
    ceilingGrid(c, c.X0, c.X1, c.Z0, c.Z1, fy + 3.4, 3.4, 3.4, 1.2, 0.3);
    light(ctx, 0, fy + 3, 6, 12, '#f4f8ff'); light(ctx, 0, fy + 3, -8, 12, '#f4f8ff');
    volume(ctx, 'officeFloor', c.X0, c.X1, c.Z0, c.Z1, fy - 0.1, fy + 3.6);
  }
};

L.station = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx;
  floorFinish(ctx, 'stone', '#cbbfa8', X0, X1, Z0, Z1);
  for (let i = 0; i < 3; i++) { F.counter(B, X0 + 0.9, 0.13, -3 + i * 3, -Math.PI / 2, 2.2, '#1f3a2e', '#e8e0cf'); B.box('glassClear', X0 + 0.5, 1.8, -3 + i * 3, 0.03, 1.2, 2.2, '#fff'); act(ctx, 'tickets', X0 + 2, 0.13, -3 + i * 3, 'Ticket window'); }
  for (let i = 0; i < 4; i++) { F.ticketMachine(B, X1 - 0.4, 0.13, -4.5 + i * 1.6, -Math.PI / 2); act(ctx, 'tickets', X1 - 1.2, 0.13, -4.5 + i * 1.6, 'Ticket machine'); }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) F.bench(B, -5 + i * 5, 0.13, 1.5 + j * 2.4, j ? Math.PI : 0, 3.0, '#6b4a2e');
  // departure board + clock
  if (ctx.atlas) { const rect = ctx.atlas.add('DEPARTURES   14:05 PORT  14:20 CENTRAL  14:40 NORTHGATE', { bg: '#101418', fg: '#f2c230', font: 'bold 40px monospace' }); B.quad(ctx.atlas.material, 0, 4.5, Z0 + 0.2, 8, 1.4, rect, 0); }
  B.box('plastic', 0, 4.5, Z0 + 0.1, 8.2, 1.6, 0.1, '#1a1a1a');
  const cg = new THREE.CylinderGeometry(0.7, 0.7, 0.1, 24); cg.rotateX(Math.PI / 2); cg.translate(0, 6.3, Z0 + 0.2); B.push('tile', cg, '#f4f1e8');
  // gate line in front of the platform doors
  for (let i = 0; i < 5; i++) F.turnstile(B, -3 + i * 1.5, 0.13, Z0 + 2.2, 0);
  B.collider(X0 + (-3.8 - X0) / 2, 0.6, Z0 + 2.2, (-3.8 - X0) / 2, 0.6, 0.05); B.collider((X1 + 4.3) / 2, 0.6, Z0 + 2.2, (X1 - 4.3) / 2, 0.6, 0.05);
  B.box('metal', X0 + (-3.8 - X0) / 2, 0.6, Z0 + 2.2, -3.8 - X0, 1.2, 0.06, '#3a4550'); B.box('metal', (X1 + 4.3) / 2, 0.6, Z0 + 2.2, X1 - 4.3, 1.2, 0.06, '#3a4550');
  F.kiosk(B, X1 - 3, 0.13, Z1 - 1.8, Math.PI); act(ctx, 'shop', X1 - 3, 0.13, Z1 - 3, 'Station kiosk', { shop: 'cafe' });
  for (let x = X0 + 3; x < X1; x += 6) { B.cyl('chrome', x, h - 1.8, 0, 0.02, 1.8, '#333', { seg: 4 }); B.cyl('light', x, h - 2.2, 0, 0.5, 0.4, '#fff3d6', { seg: 14, r2: 0.2 }); }
  light(ctx, 0, h - 2, 0, 20, '#fff1d6', 20);
  volume(ctx, 'hall', X0, X1, Z0, Z1, 0, h);
};

L.mall = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r, atlas } = ctx;
  floorFinish(ctx, 'stone', '#e2ddd2', X0, X1, Z0, Z1);
  for (let x = X0 + 3; x < X1; x += 6) B.box('stone', x, 0.142, (Z0 + Z1) / 2, 2.6, 0.005, Z1 - Z0 - 1, '#cfc8bb');
  // front units behind the facade shops (THREADLINE / VOLT) opening onto the concourse
  const fz = Z1 - 10;
  for (const [a, b, kind, name] of [[X0, -18, 'clothing', 'THREADLINE'], [18, X1, 'electronics', 'VOLT ELECTRONICS']]) {
    wall(ctx, 'z', a === X0 ? b : a, fz, Z1, { color: '#f2eee6' });
    wall(ctx, 'x', fz, a, b, { color: '#f2eee6' });
    retailUnit(ctx, kind, a + 0.1, b - 0.1, fz + 0.1, Z1, (a + b) / 2, name);
  }
  // back row of shop units with storefronts onto the concourse
  const bz = Z0 + 12, names = [['GLOW BEAUTY', '#d86a9a'], ['KICKS DEPOT', '#1c1c1c'], ['PAGE & QUILL BOOKS', '#3a2a1e'], ['HARBOR TOYS', '#1f6fb2'], ['FRESH GREENS', '#2f7a4f'], ['URBAN OUTFIT CO', '#5a3a6a']];
  const n = names.length, uw = (X1 - X0) / n;
  for (let i = 0; i < n; i++) {
    const x0 = X0 + i * uw, x1 = x0 + uw, cx = (x0 + x1) / 2;
    if (i > 0) wall(ctx, 'z', x0, Z0, bz, { h: h - 0.2, color: '#f2eee6' });
    // storefront: glazing with a 3 m opening
    B.box('glassClear', x0 + (uw - 3) / 4 + 0.1, 1.9, bz, (uw - 3) / 2 - 0.2, 3.6, 0.04, '#fff'); B.box('glassClear', x1 - (uw - 3) / 4 - 0.1, 1.9, bz, (uw - 3) / 2 - 0.2, 3.6, 0.04, '#fff');
    B.collider(x0 + (uw - 3) / 4 + 0.1, 1.9, bz, (uw - 3) / 4, 1.8, 0.05); B.collider(x1 - (uw - 3) / 4 - 0.1, 1.9, bz, (uw - 3) / 4, 1.8, 0.05);
    B.box('trim', cx, 4.3, bz, uw, 1.4, 0.3, '#2a2e33', { collide: true });
    if (atlas) { const rect = atlas.add(names[i][0], { bg: names[i][1], fg: '#fff' }); B.quad(atlas.material, cx, 4.3, bz + 0.17, Math.min(uw - 1, 7), 1.0, rect, 0); }
    const kind = /BEAUTY|TOYS|GREENS|BOOK/.test(names[i][0]) ? 'convenience' : 'clothing';
    retailUnit({ ...ctx, h: 4.9 }, kind, x0 + 0.1, x1 - 0.1, Z0, bz - 0.1, cx, names[i][0]);
  }
  // food court + fountain + seating in the concourse
  for (let i = 0; i < 3; i++) { F.kiosk(B, -12 + i * 12, 0.13, bz + 3.5, 0, ['#8a3d22', '#c8342a', '#2f7a4f'][i]); act(ctx, 'shop', -12 + i * 12, 0.13, bz + 4.7, 'Food court', { shop: 'cafe' }); }
  for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) { const tx = -15 + i * 6, tz = bz + 8 + j * 3.2; B.cyl('plastic', tx, 0.85, tz, 0.5, 0.04, '#f4f1e8', { seg: 14 }); B.cyl('metal', tx, 0.13, tz, 0.05, 0.72, '#555', { seg: 6 }); B.collider(tx, 0.5, tz, 0.5, 0.4, 0.5); F.chair(B, tx - 0.75, 0.13, tz, Math.PI / 2, '#c8342a'); F.chair(B, tx + 0.75, 0.13, tz, -Math.PI / 2, '#c8342a'); }
  B.cyl('stone', 0, 0.13, fz - 3.5, 3, 0.6, '#cfc8bb', { seg: 28, collide: true }); B.cyl('tile', 0, 0.5, fz - 3.5, 2.7, 0.25, '#5fa8c9', { seg: 28 }); B.cyl('stone', 0, 0.13, fz - 3.5, 0.4, 2.2, '#cfc8bb', { seg: 12 });
  for (const x of [-26, -8, 8, 26]) { F.plant(B, x, 0.13, fz - 3.5, 2.2); F.bench(B, x + 2, 0.13, fz - 3.5, Math.PI / 2, 2.0, '#6b4a2e'); }
  // skylight strip
  B.box('light', 0, h + ctx.fh - 0.3, (bz + fz) / 2, X1 - X0 - 4, 0.05, 4, '#ffffff');
  ceilingGrid(ctx, X0, X1, bz, fz, h - 0.02, 6, 4, 1.6, 0.3);
  light(ctx, -18, h - 1, (bz + fz) / 2, 20, '#fff6e8', 22); light(ctx, 18, h - 1, (bz + fz) / 2, 20, '#fff6e8', 22); light(ctx, 0, h - 1, fz - 3, 16, '#fff6e8', 18);
  volume(ctx, 'mall', X0, X1, Z0, Z1, 0, h);
};

L.gym = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx, zl = Z0 + 4.5, dx = ctx.mainDoor.x;
  floorFinish(ctx, 'fabric', '#2a2a2a', X0, X1, zl, Z1);
  floorFinish(ctx, 'tile', '#c9ccd0', X0, X1, Z0, zl);
  F.counter(B, dx + 3, 0.13, Z1 - 2.2, 0, 3, '#111', '#f2c230'); F.register(B, dx + 3, 0.13, Z1 - 2.2, 0);
  act(ctx, 'shop', dx + 3, 0.13, Z1 - 1.2, 'Membership desk', { shop: 'gym' });
  for (let i = 0; i < 5; i++) F.treadmill(B, 0.5 + i * 1.3, 0.13, Z1 - 1.6, Math.PI);
  for (let i = 0; i < 2; i++) F.squatRack(B, X0 + 2.5 + i * 3.4, 0.13, zl + 2.5, 0);
  for (let i = 0; i < 3; i++) F.weightBench(B, X0 + 2 + i * 2.2, 0.13, zl + 6.5, 0);
  F.dumbbellRack(B, X1 - 0.5, 0.13, zl + 3.5, -Math.PI / 2, 3.2); F.mirrorWall(B, X1 - 0.08, 0.13, zl + 3.5, -Math.PI / 2, 7);
  for (let i = 0; i < 4; i++) B.box('fabric', X1 - 5 + (i % 2) * 1.4, 0.16, zl + 7 + Math.floor(i / 2) * 2.2, 1.0, 0.04, 1.9, '#3f5a8a');
  act(ctx, 'workout', X0 + 4, 0.13, zl + 4, 'Weights', { stat: 'strength' }); act(ctx, 'workout', dx + 8, 0.13, Z1 - 3, 'Cardio', { stat: 'stamina' });
  wall(ctx, 'x', zl, X0, X1, { gaps: [{ c: X0 + 3, w: 1.0, door: { normal: 1, label: 'Locker room' } }], color: '#3b3f45' });
  F.locker(B, (X0 + X1) / 2, 0.13, Z0 + 0.3, 0, 12, '#f2c230'); F.bench(B, (X0 + X1) / 2, 0.13, Z0 + 2.2, 0, 4, '#555');
  for (let i = 0; i < 3; i++) F.shower(B, X1 - 1 - i * 1.1, 0.13, zl - 0.55, Math.PI);
  ceilingGrid(ctx, X0, X1, Z0, Z1, h - 0.02, 3.6, 3.6, 1.4, 0.2);
  light(ctx, 0, h - 1, (zl + Z1) / 2, 18, '#eef4ff', 18);
  volume(ctx, 'gym', X0, X1, Z0, Z1, 0, h);
};

L.workshop = (ctx) => {
  const { B, X0, X1, Z0, Z1, h, r } = ctx;
  floorFinish(ctx, 'concrete', '#7a7872', X0, X1, Z0, Z1);
  for (let i = 0; i < 6; i++) B.box('paint', r.range(X0 + 2, X1 - 6), 0.145, r.range(Z0 + 2, Z1 - 2), r.range(0.4, 1.4), 0.004, r.range(0.4, 1.0), '#3a3834');
  F.carLift(B, -4.5, 0.13, 0, 0); B.box('paint', -4.5, 0.146, 0, 4.4, 0.004, 6.5, '#f2c230');
  act(ctx, 'repair', -4.5, 0.13, 2.8, 'Service bay', { service: 'repair' });
  F.workbench(B, -1, 0.13, Z0 + 0.5, 0, 4); F.toolChest(B, 2.4, 0.13, Z0 + 0.4, 0); F.toolChest(B, -7.5, 0.13, Z0 + 0.4, 0);
  F.tyres(B, X0 + 0.6, 0.13, Z0 + 0.6, 5); F.tyres(B, X0 + 1.4, 0.13, Z0 + 0.6, 3); F.tyres(B, X0 + 0.6, 0.13, Z0 + 1.4, 4);
  for (let i = 0; i < 3; i++) B.cyl('metal', X0 + 0.6 + i * 0.7, 0.13, Z1 - 3.5, 0.3, 0.9, ['#c8342a', '#1f6fb2', '#2f7a4f'][i], { seg: 12, collide: true });
  // office booth (front right) with a window onto the bay
  const ox = X1 - 4.5, oz = Z1 - 4;
  wall(ctx, 'z', ox, oz, Z1, { h: 2.6, gaps: [{ c: oz + 1, w: 0.9, door: { normal: -1, label: 'Office' } }], color: '#d8d2c6' });
  wall(ctx, 'x', oz, ox, X1, { h: 2.6, color: '#d8d2c6' });
  B.box('glassClear', ox + 2.2, 1.6, oz - 0.02, 2.4, 1.0, 0.03, '#fff');
  F.desk(B, X1 - 2, 0.13, Z1 - 1.2, Math.PI); F.counter(B, ox + 1.8, 0.13, Z1 - 0.8, Math.PI, 1.8, '#8a3d1f'); B.box('wood', (ox + X1) / 2, 2.62, (oz + Z1) / 2, X1 - ox, 0.06, Z1 - oz, '#8a7a5a');
  act(ctx, 'shop', ox + 1.8, 0.13, Z1 - 1.8, "Rusty's front desk", { shop: 'mechanic' });
  for (let x = X0 + 3; x < X1; x += 5) { B.cyl('chrome', x, h - 0.9, 0, 0.02, 0.9, '#333', { seg: 4 }); B.box('light', x, h - 0.95, 0, 1.4, 0.1, 0.25, '#ffffff'); }
  light(ctx, -3, h - 1.2, 0, 16, '#eef4ff', 16);
  volume(ctx, 'workshop', X0, X1, Z0, Z1, 0, h);
};

// ---------------------------------------------------------------- entry point
export const INTERIOR_KINDS = Object.keys(L);

export function buildInterior(building, M, atlas) {
  const meta = building.meta, kind = meta?.interior;
  if (!kind || !L[kind]) return null;
  const [w, d] = building.footprint;
  const B = new GeoBuilder(M);
  const gfh = meta.gfh ?? building.gfh ?? 3.4;
  const main = building.doors.find((q) => q.interactive && q.normal[2] > 0.5) || building.doors[0];
  const ctx = {
    B, w, d, gfh, fh: building.fh ?? 3.1, h: gfh - 0.15, meta, atlas, r: rng((meta.seed ?? 7) * 31 + 5),
    X0: -w / 2 + T, X1: w / 2 - T, Z0: -d / 2 + T, Z1: d / 2 - T,
    mainDoor: { x: main ? main.hinge[0] + main.u[0] * main.w / 2 : 0 },
    doors: [], lights: [], volumes: [], interactables: [],
  };
  L[kind](ctx);
  const group = B.build(`${meta.name} interior`);
  group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { group, colliders: B.colliders, doors: ctx.doors, lights: ctx.lights, volumes: ctx.volumes, interactables: ctx.interactables, tris: B.tris };
}
