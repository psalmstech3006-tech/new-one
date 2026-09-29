import * as THREE from 'three';
import { GeoBuilder, rng } from './geom.js';

// ============================================================================
// Free World modular architecture kit.
// Buildings are built in local space: footprint centred on x=0,z=0, front facade at +Z,
// ground at y=0. Walls are real slabs with openings; every opening gets its own insert.
// ============================================================================

const T = 0.28; // wall thickness

// Wall sides: outward normal, u-axis along the facade (left→right seen from outside), and extents.
function sides(w, d) {
  return {
    front: { n: [0, 0, 1], u: [1, 0, 0], half: d / 2, len: w, rotY: 0 },
    back: { n: [0, 0, -1], u: [-1, 0, 0], half: d / 2, len: w, rotY: Math.PI },
    right: { n: [1, 0, 0], u: [0, 0, -1], half: w / 2, len: d - 2 * T, rotY: Math.PI / 2 },
    left: { n: [-1, 0, 0], u: [0, 0, 1], half: w / 2, len: d - 2 * T, rotY: -Math.PI / 2 },
  };
}

// Place a box on a wall side: u (centre along wall), y (centre height), du/dy sizes, dn thickness,
// off = offset of the box centre from the wall's centre plane along the outward normal.
function sideBox(B, S, mat, u, y, du, dy, dn, off, color, collide = false) {
  const c = S.half - T / 2 + off;
  const x = S.n[0] * c + S.u[0] * u, z = S.n[2] * c + S.u[2] * u;
  const alongX = Math.abs(S.u[0]) > 0.5;
  B.box(mat, x, y, z, alongX ? du : dn, dy, alongX ? dn : du, color, { collide, tile: mat === 'brick' ? 2.4 : 3 });
}

// ---------------------------------------------------------------- inserts
function windowInsert(B, S, o, st) {
  const u = (o.u0 + o.u1) / 2, w = o.u1 - o.u0, y0 = o.y0, h = o.y1 - o.y0, yc = y0 + h / 2;
  const glassOff = T / 2 - 0.16;
  sideBox(B, S, 'glass', u, yc, w, h, 0.03, glassOff, st.glass || '#8aa0b4');
  const fr = st.frame || '#e8e4dc', ft = 0.07;
  sideBox(B, S, 'frame', u, y0 + ft / 2, w, ft, 0.1, glassOff + 0.02, fr);
  sideBox(B, S, 'frame', u, y0 + h - ft / 2, w, ft, 0.1, glassOff + 0.02, fr);
  sideBox(B, S, 'frame', o.u0 + ft / 2, yc, ft, h, 0.1, glassOff + 0.02, fr);
  sideBox(B, S, 'frame', o.u1 - ft / 2, yc, ft, h, 0.1, glassOff + 0.02, fr);
  if (w > 1.25) sideBox(B, S, 'frame', u, yc, 0.05, h, 0.08, glassOff + 0.02, fr);           // mullion
  if (st.transom) sideBox(B, S, 'frame', u, y0 + h * 0.72, w, 0.05, 0.08, glassOff + 0.02, fr); // transom
  // reveal/sill/lintel
  sideBox(B, S, 'trim', u, y0 - 0.04, w + 0.16, 0.08, 0.2, T / 2 + 0.04, st.sill || '#cfc8bb');
  if (st.lintel) sideBox(B, S, 'trim', u, y0 + h + 0.1, w + 0.24, 0.2, 0.06, T / 2 + 0.03, st.lintel);
  if (st.shutters) for (const s of [-1, 1]) sideBox(B, S, 'wood', u + s * (w / 2 + 0.28), yc, 0.5, h, 0.05, T / 2 + 0.03, st.shutters);
}

function storefrontInsert(B, S, o, st) {
  const u = (o.u0 + o.u1) / 2, w = o.u1 - o.u0, h = o.y1 - o.y0, y0 = o.y0;
  const gOff = T / 2 - 0.1, fr = st.frame || '#2b2e33';
  sideBox(B, S, 'trim', u, y0 + 0.25, w, 0.5, 0.2, 0, st.kick || '#3a3d42');             // kick plate
  sideBox(B, S, st.clearGlass ? 'glassClear' : 'glass', u, y0 + 0.5 + (h - 0.5) / 2, w, h - 0.5, 0.03, gOff, st.clearGlass ? '#ffffff' : st.glass || '#93aabb');
  const n = Math.max(1, Math.round(w / 1.6));
  for (let i = 0; i <= n; i++) sideBox(B, S, 'frame', o.u0 + (w * i) / n, y0 + h / 2, 0.08, h, 0.12, gOff + 0.03, fr);
  sideBox(B, S, 'frame', u, y0 + h - 0.05, w, 0.1, 0.12, gOff + 0.03, fr);
  sideBox(B, S, 'frame', u, y0 + h * 0.8, w, 0.06, 0.1, gOff + 0.03, fr);
}

function doorFrameInsert(B, S, o, st) {
  const u = (o.u0 + o.u1) / 2, w = o.u1 - o.u0, h = o.y1 - o.y0, fr = st.doorFrame || st.frame || '#e8e4dc';
  sideBox(B, S, 'frame', o.u0 + 0.05, o.y0 + h / 2, 0.1, h, T + 0.04, 0, fr);
  sideBox(B, S, 'frame', o.u1 - 0.05, o.y0 + h / 2, 0.1, h, T + 0.04, 0, fr);
  sideBox(B, S, 'frame', u, o.y1 - 0.05, w, 0.1, T + 0.04, 0, fr);
  sideBox(B, S, 'concrete', u, 0.08, w + 0.8, 0.16, 0.8, T / 2 + 0.4, '#b9b5ad');          // step
}

function rollerInsert(B, S, o, st) {
  const u = (o.u0 + o.u1) / 2, w = o.u1 - o.u0, h = o.y1 - o.y0;
  sideBox(B, S, 'metal', u, o.y0 + h / 2, w, h, 0.06, 0, st.roller || '#8d949b');
  for (let y = o.y0 + 0.3; y < o.y1; y += 0.3) sideBox(B, S, 'metal', u, y, w, 0.03, 0.08, 0.02, '#6f757c');
  sideBox(B, S, 'frame', u, o.y1 + 0.12, w + 0.2, 0.24, 0.3, 0.1, '#4a4f55');
}

// ---------------------------------------------------------------- facade engine
// openings: [{u0,u1,y0,y1,type}] for one wall side spanning y 0..H. The wall is built in
// horizontal bands (one per floor, split at `bands`) so openings of different floors and widths
// never overlap: per band -> piers between openings, plus panels below/above each opening.
function facade(B, S, mat, color, H, openings, st, bands = [0, H], splits = []) {
  const L = S.len;
  // wall piece from u a..b; split at `splits` so per-unit colours (townhouses) change at party walls
  const piece = (a, b, y, h) => {
    const cuts = [a, ...splits.filter((s) => s > a + 1e-3 && s < b - 1e-3), b];
    for (let i = 0; i < cuts.length - 1; i++) {
      const m = (cuts[i] + cuts[i + 1]) / 2;
      sideBox(B, S, mat, m, y, cuts[i + 1] - cuts[i], h, T, 0, typeof color === 'function' ? color(m) : color, false);
    }
  };
  const ops = openings.filter((o) => o.u1 > -L / 2 && o.u0 < L / 2);
  const edges = [...new Set([...bands, 0, H].map((v) => +v.toFixed(4)))].filter((v) => v >= 0 && v <= H).sort((a, b) => a - b);
  for (let k = 0; k < edges.length - 1; k++) {
    const b0 = edges[k], b1 = edges[k + 1], bh = b1 - b0;
    if (bh < 0.001) continue;
    const inBand = ops.filter((o) => o.y0 >= b0 - 1e-3 && o.y1 <= b1 + 1e-3).sort((a, b) => a.u0 - b.u0);
    let cur = -L / 2;
    for (const o of inBand) {
      if (o.u0 - cur > 0.001) piece(cur, o.u0, b0 + bh / 2, bh);
      if (o.y0 - b0 > 0.001) piece(o.u0, o.u1, (b0 + o.y0) / 2, o.y0 - b0);
      if (b1 - o.y1 > 0.001) piece(o.u0, o.u1, (o.y1 + b1) / 2, b1 - o.y1);
      cur = Math.max(cur, o.u1);
    }
    if (L / 2 - cur > 0.001) piece(cur, L / 2, b0 + bh / 2, bh);
  }
  // Collision: glazing is solid, so a wall side collapses to full-height segments between
  // door openings plus a lintel block above each door (a handful of cuboids per side).
  const doorsHere = ops.filter((o) => o.type === 'door').sort((a, b) => a.u0 - b.u0);
  const colSeg = (a, b, y0, y1) => { if (b - a < 0.01 || y1 - y0 < 0.01) return; const m = (a + b) / 2, c = S.half - T / 2, alongX = Math.abs(S.u[0]) > 0.5;
    B.collider(S.n[0] * c + S.u[0] * m, (y0 + y1) / 2, S.n[2] * c + S.u[2] * m, alongX ? (b - a) / 2 : T / 2, (y1 - y0) / 2, alongX ? T / 2 : (b - a) / 2); };
  let cu = -L / 2;
  for (const o of doorsHere) { colSeg(cu, o.u0, 0, H); colSeg(o.u0, o.u1, o.y1, H); cu = o.u1; }
  colSeg(cu, L / 2, 0, H);
  for (const o of ops) {
    if (o.type === 'window') windowInsert(B, S, o, st);
    else if (o.type === 'storefront') storefrontInsert(B, S, o, st);
    else if (o.type === 'door') doorFrameInsert(B, S, o, st);
    else if (o.type === 'roller') rollerInsert(B, S, o, st);
  }
}

// Regular window grid for floors [f0, f1): returns openings
function windowGrid(len, floors, { f0 = 0, gfh, fh, winW = 1.3, winH = 1.5, sill = 0.9, module = 3, margin = 0.9, skip = () => false }) {
  const out = [], n = Math.max(1, Math.floor((len - margin * 2) / module)), step = (len - margin * 2) / n;
  for (let f = f0; f < floors; f++) {
    const base = f === 0 ? 0 : gfh + (f - 1) * fh;
    for (let i = 0; i < n; i++) {
      if (skip(f, i, n)) continue;
      const uc = -len / 2 + margin + step * (i + 0.5);
      out.push({ u0: uc - winW / 2, u1: uc + winW / 2, y0: base + sill, y1: base + sill + winH, type: 'window', floor: f, i });
    }
  }
  return { openings: out, n, step };
}

// ---------------------------------------------------------------- shared trims
function slabsAndRoof(B, w, d, H, floorsY, st) {
  // interior floor slabs (visible through windows) + roof slab
  for (const [k, y] of floorsY.entries()) {
    const h = k === 0 ? st.stairwell : null, iw = w - 2 * T, id = d - 2 * T;
    if (!h) { B.box('concrete', 0, y, 0, iw, 0.25, id, '#9c9a95'); continue; }
    // slab around a stairwell opening {x0,x1,z0,z1}
    const X0 = -iw / 2, X1 = iw / 2, Z0 = -id / 2, Z1 = id / 2;
    B.box('concrete', (X0 + h.x0) / 2, y, 0, h.x0 - X0, 0.25, id, '#9c9a95');
    B.box('concrete', (h.x1 + X1) / 2, y, 0, X1 - h.x1, 0.25, id, '#9c9a95');
    B.box('concrete', (h.x0 + h.x1) / 2, y, (Z0 + h.z0) / 2, h.x1 - h.x0, 0.25, h.z0 - Z0, '#9c9a95');
    B.box('concrete', (h.x0 + h.x1) / 2, y, (h.z1 + Z1) / 2, h.x1 - h.x0, 0.25, Z1 - h.z1, '#9c9a95');
  }
  B.box('concrete', 0, H + 0.15, 0, w, 0.3, d, st.roofColor || '#6f6d68', { collide: true });
}
function flatRoofDressing(B, w, d, H, r, st) {
  const p = st.parapet ?? 0.9, c = st.trimColor || '#d8d2c6';
  // parapet
  B.box('concrete', 0, H + 0.3 + p / 2, d / 2 - 0.15, w, p, 0.3, c, { collide: true });
  B.box('concrete', 0, H + 0.3 + p / 2, -d / 2 + 0.15, w, p, 0.3, c, { collide: true });
  B.box('concrete', w / 2 - 0.15, H + 0.3 + p / 2, 0, 0.3, p, d - 0.6, c, { collide: true });
  B.box('concrete', -w / 2 + 0.15, H + 0.3 + p / 2, 0, 0.3, p, d - 0.6, c, { collide: true });
  B.box('concrete', 0, H + 0.3 + p + 0.06, d / 2 - 0.15, w + 0.1, 0.12, 0.42, '#bdb7ab');
  // rooftop plant: AC units, vents, stair bulkhead, water tank on older buildings
  const n = Math.max(1, Math.floor((w * d) / 120));
  for (let i = 0; i < n; i++) {
    const x = r.range(-w / 2 + 2, w / 2 - 2), z = r.range(-d / 2 + 2, d / 2 - 2);
    B.box('metal', x, H + 0.3 + 0.55, z, 1.4, 1.1, 1.0, '#a9aeb3');
    B.box('metal', x, H + 0.3 + 1.12, z, 1.1, 0.06, 0.8, '#6b7075');
  }
  for (let i = 0; i < 3; i++) B.cyl('metal', r.range(-w / 2 + 1, w / 2 - 1), H + 0.3, r.range(-d / 2 + 1, d / 2 - 1), 0.18, 0.8, '#8c9196', { seg: 8 });
  if (st.bulkhead !== false) B.box(st.wallMat || 'brick', r.range(-w / 4, w / 4), H + 0.3 + 1.4, -d / 4, 3, 2.8, 3, st.wallColor || '#9a5a45');
  if (st.waterTank) {
    const x = r.range(-w / 3, w / 3), z = r.range(-d / 4, d / 4);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box('metal', x + a * 0.9, H + 0.3 + 1.2, z + b * 0.9, 0.12, 2.4, 0.12, '#4b3b2e');
    B.cyl('wood', x, H + 0.3 + 2.4, z, 1.3, 2.6, '#7a5a3c', { seg: 14 });
    B.cyl('shingle', x, H + 0.3 + 5.0, z, 0.1, 0.9, '#3d3f44', { seg: 14, r2: 0.1 });
  }
}
function beltCourses(B, w, d, levels, color) {
  for (const y of levels) {
    B.box('trim', 0, y, d / 2 + 0.04, w + 0.12, 0.16, 0.14, color);
    B.box('trim', 0, y, -d / 2 - 0.04, w + 0.12, 0.16, 0.14, color);
    B.box('trim', w / 2 + 0.04, y, 0, 0.14, 0.16, d + 0.12, color);
    B.box('trim', -w / 2 - 0.04, y, 0, 0.14, 0.16, d + 0.12, color);
  }
}
function cornice(B, w, d, H, color, depth = 0.45) {
  B.box('trim', 0, H + 0.1, 0, w + depth * 2, 0.3, d + depth * 2, color);
  B.box('trim', 0, H - 0.12, 0, w + depth, 0.16, d + depth, color);
}
function plinth(B, w, d, color, h = 0.55) { B.box('stone', 0, h / 2, 0, w + 0.1, h, d + 0.1, color); }
function balcony(B, S, u, y, w, st) {
  const dep = 1.3;
  sideBox(B, S, 'concrete', u, y - 0.1, w, 0.2, dep, T / 2 + dep / 2, st.balcony || '#d9d6cf');
  const rail = st.railColor || '#2f3337';
  sideBox(B, S, 'metal', u, y + 1.0, w, 0.05, 0.05, T / 2 + dep - 0.03, rail);
  sideBox(B, S, 'metal', u, y + 0.12, w, 0.04, 0.04, T / 2 + dep - 0.03, rail);
  for (let k = -w / 2; k <= w / 2 + 0.01; k += 0.3) sideBox(B, S, 'metal', u + k, y + 0.5, 0.025, 1.0, 0.025, T / 2 + dep - 0.03, rail);
  for (const s of [-1, 1]) {
    sideBox(B, S, 'metal', u + s * w / 2, y + 1.0, 0.05, 0.05, dep, T / 2 + dep / 2, rail);
    for (let k = 0.3; k < dep; k += 0.3) sideBox(B, S, 'metal', u + s * w / 2, y + 0.5, 0.025, 1.0, 0.025, T / 2 + k, rail);
  }
}
function fireEscape(B, S, u, floorsY, w = 3.2) {
  const c = '#2a2c2f', dep = 1.2;
  for (const y of floorsY) {
    sideBox(B, S, 'metal', u, y, w, 0.06, dep, T / 2 + dep / 2, c);
    sideBox(B, S, 'metal', u, y + 1.0, w, 0.05, 0.05, T / 2 + dep, c);
    for (let k = -w / 2; k <= w / 2; k += 0.3) sideBox(B, S, 'metal', u + k, y + 0.5, 0.03, 1.0, 0.03, T / 2 + dep, c);
  }
  for (let i = 0; i < floorsY.length - 1; i++) {
    // diagonal stair between platforms (approximated by stepped slats)
    const y0 = floorsY[i], y1 = floorsY[i + 1], steps = 10;
    for (let s = 0; s < steps; s++) sideBox(B, S, 'metal', u - w / 2 + 0.4 + (s * (w - 0.8)) / steps * (i % 2 ? -1 : 1) + (i % 2 ? w - 0.8 : 0), y0 + ((s + 1) * (y1 - y0)) / steps, 0.3, 0.04, 0.7, T / 2 + dep / 2, c);
  }
}
function awning(B, S, u, y, w, color, depth = 1.6) {
  const c = S.half - T / 2 + T / 2 + depth / 2;
  const x = S.n[0] * c + S.u[0] * u, z = S.n[2] * c + S.u[2] * u;
  const g = new THREE.BoxGeometry(Math.abs(S.u[0]) > 0.5 ? w : depth, 0.06, Math.abs(S.u[0]) > 0.5 ? depth : w);
  // slope down-and-out
  const ax = Math.abs(S.u[0]) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const tilt = 0.32 * (S.n[2] + S.n[0] > 0 ? 1 : -1) * (Math.abs(S.u[0]) > 0.5 ? 1 : -1);
  g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(ax, tilt));
  g.translate(x, y, z);
  B.push('fabric', g, color);
  // valance
  sideBox(B, S, 'fabric', u, y - depth * 0.32 - 0.12, w, 0.3, 0.03, T / 2 + depth - 0.02, color);
}
function sign(B, S, atlas, text, u, y, w, h, style) {
  if (!atlas) return;
  const rect = atlas.add(text, style);
  const c = S.half + 0.26; // in front of the sign band so it never z-fights
  const x = S.n[0] * c + S.u[0] * u, z = S.n[2] * c + S.u[2] * u;
  sideBox(B, S, 'trim', u, y, w + 0.2, h + 0.2, 0.08, T / 2 + 0.2, style?.frame || '#222');
  B.quad(atlas.material, x, y, z, w, h, rect, S.rotY);
}

// ---------------------------------------------------------------- generic building
// spec: {w,d,floors,gfh,fh,wallMat,wallColor,trimColor,frame,glass,ground:'residential'|'storefront'|'lobby'|'blank'|'garage',
//        roof:'flat'|'gable'|'hip', doors:[{side,u,w,h,kind}], shops:[{u0,u1,name,style,awning}], balconies, fireEscape, ...}
export function genericBuilding(spec, M, atlas, seed = 1) {
  const r = rng(seed), B = new GeoBuilder(M);
  const { w, d, floors } = spec, gfh = spec.gfh ?? 3.4, fh = spec.fh ?? 3.1;
  const H = gfh + (floors - 1) * fh;
  const S = sides(w, d);
  const st = { frame: spec.frame, glass: spec.glass, sill: spec.sill, lintel: spec.lintel, shutters: spec.shutters, transom: spec.transom, doorFrame: spec.doorFrame, roller: spec.roller, clearGlass: spec.clearGlass ?? !!spec.interiorKind };
  const mat = spec.wallMat || 'brick', color = spec.wallColor || '#a45a44';
  const doors = [];
  const perSide = { front: [], back: [], left: [], right: [] };
  // ground floor openings
  const winOpts = { gfh, fh, winW: spec.winW ?? 1.3, winH: spec.winH ?? 1.55, sill: spec.sillH ?? 0.9, module: spec.module ?? 3, margin: spec.margin ?? 0.9 };
  for (const name of Object.keys(S)) {
    const side = S[name], len = side.len;
    const blank = spec.blankSides?.includes(name);
    // doors on this side
    const sd = (spec.doors || []).filter((q) => q.side === name);
    for (const q of sd) {
      const dw = q.w ?? 1.1, dh = q.h ?? 2.25;
      perSide[name].push({ u0: q.u - dw / 2, u1: q.u + dw / 2, y0: 0.0, y1: dh, type: q.kind === 'roller' ? 'roller' : 'door' });
      if (q.kind !== 'roller') {
        const c = side.half; // door plane position
        doors.push({ hinge: [side.n[0] * (c - T / 2) + side.u[0] * (q.u - dw / 2), 0, side.n[2] * (c - T / 2) + side.u[2] * (q.u - dw / 2)], normal: side.n, u: side.u, w: dw, h: dh, kind: q.kind || 'single', interactive: q.interactive !== false, locked: !!q.locked, keyId: q.keyId || null, label: q.label || spec.name, style: q.style || spec.doorStyle || 'wood', double: q.double });
      }
    }
    // storefronts on this side
    const shops = name === 'front' && spec.ground === 'storefront' ? spec.shops || [] : [];
    for (const s of shops) {
      // leave room for the shop door (recorded in spec.doors)
      const doorsHere = sd.filter((q) => q.u > s.u0 && q.u < s.u1).sort((a, b) => a.u - b.u);
      let cur = s.u0 + 0.4;
      for (const q of doorsHere) {
        const dw = q.w ?? 1.1;
        if (q.u - dw / 2 - 0.15 - cur > 0.5) perSide[name].push({ u0: cur, u1: q.u - dw / 2 - 0.15, y0: 0.15, y1: gfh - 0.6, type: 'storefront' });
        cur = q.u + dw / 2 + 0.15;
      }
      if (s.u1 - 0.4 - cur > 0.5) perSide[name].push({ u0: cur, u1: s.u1 - 0.4, y0: 0.15, y1: gfh - 0.6, type: 'storefront' });
    }
    if (blank) continue;
    // window grid; skip where doors/storefront occupy the ground floor
    const f0 = spec.ground === 'storefront' && name === 'front' ? 1 : spec.ground === 'blank' ? 1 : 0;
    const { openings } = windowGrid(len, floors, { ...winOpts, f0, skip: (f, i, n) => {
      if (f !== 0) return spec.skipWindow ? spec.skipWindow(name, f, i, n) : false;
      const uc = -len / 2 + winOpts.margin + ((len - winOpts.margin * 2) / n) * (i + 0.5);
      return perSide[name].some((o) => uc + winOpts.winW / 2 + 0.25 > o.u0 && uc - winOpts.winW / 2 - 0.25 < o.u1) || (spec.skipWindow ? spec.skipWindow(name, f, i, n) : false);
    } });
    perSide[name].push(...openings);
  }
  const bands = [0]; for (let f = 1; f < floors; f++) bands.push(gfh + (f - 1) * fh); bands.push(H);
  for (const name of Object.keys(S)) {
    const cf = spec.wallColorAt ? (u) => spec.wallColorAt(name, u) || color : color;
    facade(B, S[name], mat, cf, H, perSide[name], st, bands, spec.wallSplits?.[name] || []);
  }
  // floors, roof, trims
  const floorsY = []; for (let f = 1; f < floors; f++) floorsY.push(gfh + (f - 1) * fh);
  B.box('concrete', 0, 0.06, 0, w - 2 * T, 0.12, d - 2 * T, spec.floorColor || '#8f8c86', { collide: true });
  slabsAndRoof(B, w, d, H, floorsY, spec);
  if (spec.plinth !== false) plinth(B, w, d, spec.plinthColor || '#8d877e', spec.plinthH ?? 0.45);
  if (spec.belts !== false && floors > 1) beltCourses(B, w, d, [gfh, ...(spec.allBelts ? floorsY.slice(1) : [])], spec.trimColor || '#d8d2c6');
  const roof = spec.roof || 'flat';
  if (roof === 'flat') { if (spec.cornice !== false) cornice(B, w, d, H + 0.3, spec.trimColor || '#d8d2c6', spec.corniceDepth ?? 0.35); flatRoofDressing(B, w, d, H, r, { ...spec, wallMat: mat, wallColor: color }); }
  else if (roof === 'gable') { B.gable('shingle', 0, H + 0.3, 0, w, d, spec.roofH ?? Math.min(w, d) * 0.38, spec.roofColor || '#5a4a42', { overhang: 0.5, alongZ: spec.ridgeZ }); fascia(B, w, d, H + 0.3, spec.trimColor || '#f2efe8'); }
  else if (roof === 'hip') { B.hip('shingle', 0, H + 0.3, 0, w, d, spec.roofH ?? Math.min(w, d) * 0.32, spec.roofColor || '#4d4a48'); fascia(B, w, d, H + 0.3, spec.trimColor || '#f2efe8'); }
  // storefront dressing: sign band, signs, awnings
  if (spec.ground === 'storefront') {
    B.box('trim', 0, gfh - 0.3, d / 2 + 0.06, w + 0.1, 0.6, 0.16, spec.bandColor || '#2c3036');
    for (const s of spec.shops || []) {
      const sw = Math.min(s.u1 - s.u0 - 0.8, 6);
      sign(B, S.front, atlas, s.name, (s.u0 + s.u1) / 2, gfh - 0.3, sw, sw / 4 > 0.55 ? 0.55 : sw / 4, s.style);
      if (s.awning) awning(B, S.front, (s.u0 + s.u1) / 2, gfh - 0.75, s.u1 - s.u0 - 0.6, s.awning);
    }
  }
  if (spec.signs) for (const sg of spec.signs) sign(B, S[sg.side || 'front'], atlas, sg.text, sg.u ?? 0, sg.y, sg.w, sg.h, sg.style);
  if (spec.balconies) {
    const { n, step } = windowGrid(S.front.len, floors, winOpts);
    for (let f = 1; f < floors; f++) for (let i = 0; i < n; i++) if (spec.balconies(f, i, n)) balcony(B, S.front, -S.front.len / 2 + winOpts.margin + step * (i + 0.5), gfh + (f - 1) * fh, Math.min(step - 0.3, 2.6), spec);
  }
  if (spec.fireEscape) fireEscape(B, S[spec.fireEscape.side || 'right'], spec.fireEscape.u ?? 0, floorsY);
  if (spec.extra) spec.extra(B, { w, d, H, gfh, fh, S, r, atlas, sideBox: (...a) => sideBox(B, ...a) });
  const group = B.build(spec.name);
  return { group, colliders: B.colliders, doors, height: H, tris: B.tris, footprint: [w, d], gfh, fh };
}
function fascia(B, w, d, y, color) {
  B.box('trim', 0, y + 0.08, d / 2 + 0.5, w + 1.0, 0.22, 0.06, color);
  B.box('trim', 0, y + 0.08, -d / 2 - 0.5, w + 1.0, 0.22, 0.06, color);
}

export { sides, sideBox, balcony, awning, sign, T };
