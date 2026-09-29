// Turns a generated car GLB into a game-ready Free World vehicle:
//  - rotates it to face +Z, scales it to real metres, puts the origin at ground centre
//  - cuts the four baked-in wheels out into separately pivoted meshes (they spin/steer in-game)
//  - paints out badges and licence-plate text in the textures (spec: no logos)
//  - applies the same transform to body-only LOD files (wheel triangles removed)
// Usage: node tools/process-car.mjs <lod0.glb> <out.glb> --length 4.7 --front -z [--lods a.glb,b.glb]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [inFile, outFile] = args;
const LENGTH = Number(opt('length', 4.7));
const FRONT = opt('front', '-z'); // which axis the source model's nose points along
const lods = opt('lods', '') ? opt('lods').split(',') : [];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function readPrim(doc) {
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL')?.getArray();
  const T = prim.getAttribute('TEXCOORD_0')?.getArray();
  const I = prim.getIndices() ? prim.getIndices().getArray() : Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
  return { prim, P, N, T, I };
}

// ---- analyse the LOD0 model in source space --------------------------------
const doc = await io.read(inFile);
const src = readPrim(doc);
const { P, I } = src;
let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
for (let i = 0; i < P.length; i += 3) {
  minX = Math.min(minX, P[i]); maxX = Math.max(maxX, P[i]);
  minY = Math.min(minY, P[i + 1]); maxY = Math.max(maxY, P[i + 1]);
  minZ = Math.min(minZ, P[i + 2]); maxZ = Math.max(maxZ, P[i + 2]);
}
const halfW = (maxX - minX) / 2;
// wheel centres: tyre contact patches give the axle z; radius = axle height above ground
const wheels = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  let zs = 0, n = 0;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (Math.sign(x) === sx && Math.sign(z) === sz && y < minY + 0.012 * (maxY - minY) * 2 && Math.abs(x) > halfW * 0.55) { zs += z; n++; }
  }
  wheels.push({ sx, sz, cz: zs / n, n });
}
const R = Number(opt('radius', 0)) || (0.141 / 0.56) * (maxY - minY); // wheel radius ≈ 25% of body height (measured)
const cy = minY + R;
const innerX = halfW * 0.5;
console.log('source bounds', { minX, maxX, minY, maxY, minZ, maxZ }, 'wheel R', R.toFixed(4));
for (const w of wheels) console.log('wheel', w.sx, w.sz, 'cz', w.cz.toFixed(4), 'contact verts', w.n);

const vx = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
function wheelOf(i) {
  const [x, y, z] = vx(i);
  if (Math.abs(x) < innerX) return -1;
  for (let k = 0; k < 4; k++) {
    const w = wheels[k];
    if (Math.sign(x) === w.sx && Math.sign(z) === w.sz && Math.hypot(y - cy, z - w.cz) < R * 1.04) return k;
  }
  return -1;
}
function classify(Pa, Ia) {
  // triangle -> wheel index (all three vertices inside the same wheel cylinder) or -1 for body
  const out = new Int8Array(Ia.length / 3);
  const wOf = (i) => {
    const x = Pa[i * 3], y = Pa[i * 3 + 1], z = Pa[i * 3 + 2];
    if (Math.abs(x) < innerX) return -1;
    for (let k = 0; k < 4; k++) { const w = wheels[k]; if (Math.sign(x) === w.sx && Math.sign(z) === w.sz && Math.hypot(y - cy, z - w.cz) < R * 1.04) return k; }
    return -1;
  };
  for (let t = 0; t < out.length; t++) {
    const a = wOf(Ia[t * 3]), b = wOf(Ia[t * 3 + 1]), c = wOf(Ia[t * 3 + 2]);
    out[t] = a >= 0 && a === b && b === c ? a : -1;
  }
  return out;
}

// ---- transform: face +Z, metres, ground origin -------------------------------
const scale = LENGTH / (maxZ - minZ);
const flip = FRONT === '-z' ? -1 : 1; // rotate 180° about Y when the nose points to -Z
const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
const xf = (x, y, z) => [(x - cx0) * flip * scale, (y - minY) * scale, (z - cz0) * flip * scale];
const nf = (x, y, z) => [x * flip, y, z * flip];

// ---- paint out badge + plate in the textures ---------------------------------
async function paintOut(document, prim, P0, T0, I0) {
  const mat = prim.getMaterial();
  const base = mat.getBaseColorTexture(), normal = mat.getNormalTexture();
  const H = maxY - minY, W = maxX - minX, Lz = maxZ - minZ;
  // badge / plate zones at both ends (relative to body size); override with --badges none
  const inBox = (x, y, z, end, bx, y0, y1) => Math.abs(x) < W * bx && y > minY + H * y0 && y < minY + H * y1 && (end > 0 ? z > maxZ - 0.12 * Lz : z < minZ + 0.12 * Lz);
  const regions = opt('badges', 'both') === 'none' ? [] : [1, -1].flatMap((end) => [
    { name: `badge${end > 0 ? '+z' : '-z'}`, test: (x, y, z) => inBox(x, y, z, end, 0.07, 0.40, 0.62) },
    { name: `plate${end > 0 ? '+z' : '-z'}`, test: (x, y, z) => inBox(x, y, z, end, 0.13, 0.18, 0.42) },
  ]);
  const decode = async (tex) => { const img = sharp(Buffer.from(tex.getImage())); const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
  const B = await decode(base), Nm = normal ? await decode(normal) : null;
  const w = B.info.width, h = B.info.height;
  const px = (u, v) => [Math.min(w - 1, Math.max(0, Math.floor(u * w))), Math.min(h - 1, Math.max(0, Math.floor(v * h)))];
  const rasterTri = (uvs, fn) => {
    const [a, b, c] = uvs.map(([u, v]) => [u * w, v * h]);
    const x0 = Math.floor(Math.min(a[0], b[0], c[0])) - 1, x1 = Math.ceil(Math.max(a[0], b[0], c[0])) + 1;
    const y0 = Math.floor(Math.min(a[1], b[1], c[1])) - 1, y1 = Math.ceil(Math.max(a[1], b[1], c[1])) + 1;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) {
      const px_ = x + 0.5, py = y + 0.5;
      const w0 = ((b[0] - px_) * (c[1] - py) - (c[0] - px_) * (b[1] - py)) / area;
      const w1 = ((c[0] - px_) * (a[1] - py) - (a[0] - px_) * (c[1] - py)) / area;
      const w2 = 1 - w0 - w1;
      const m = -0.08; // dilate slightly to cover filtering seams
      if (w0 >= m && w1 >= m && w2 >= m) fn(x, y);
    }
  };
  const triUV = (t) => [0, 1, 2].map((k) => { const i = I0[t * 3 + k]; return [T0[i * 2], T0[i * 2 + 1]]; });
  const triPos = (t) => { let x = 0, y = 0, z = 0; for (let k = 0; k < 3; k++) { const i = I0[t * 3 + k]; x += P0[i * 3]; y += P0[i * 3 + 1]; z += P0[i * 3 + 2]; } return [x / 3, y / 3, z / 3]; };
  const median = (arr) => { const s = [...arr].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? 128; };
  for (const reg of regions) {
    const tris = [];
    for (let t = 0; t < I0.length / 3; t++) { const [x, y, z] = triPos(t); if (reg.test(x, y, z)) tris.push(t); }
    // replacement colour: median of the surrounding panel (same height band, just outside the region)
    const ring = [];
    for (let t = 0; t < I0.length / 3; t++) {
      const [x, y, z] = triPos(t);
      if (reg.test(x, y, z)) continue;
      if (reg.test(x * 0.5, y, z) && Math.abs(x) < W * 0.2) ring.push(t);
    }
    const rs_ = [], gs = [], bs = [];
    for (const t of ring) rasterTri(triUV(t), (x, y) => { const o = (y * w + x) * 4; rs_.push(B.data[o]); gs.push(B.data[o + 1]); bs.push(B.data[o + 2]); });
    const col = [median(rs_), median(gs), median(bs)];
    let painted = 0;
    for (const t of tris) rasterTri(triUV(t), (x, y) => {
      const o = (y * w + x) * 4; B.data[o] = col[0]; B.data[o + 1] = col[1]; B.data[o + 2] = col[2]; painted++;
      if (Nm) { Nm.data[o] = 128; Nm.data[o + 1] = 128; Nm.data[o + 2] = 255; }
    });
    console.log(`painted ${reg.name}: ${tris.length} tris, ${painted} texels, colour rgb(${col})`);
  }
  const enc = async (img) => sharp(img.data, { raw: { width: img.info.width, height: img.info.height, channels: 4 } }).webp({ quality: 88 }).toBuffer();
  base.setImage(new Uint8Array(await enc(B))).setMimeType('image/webp');
  if (Nm) normal.setImage(new Uint8Array(await enc(Nm))).setMimeType('image/webp');
}

// ---- rebuild the document: body + four pivoted wheel nodes -------------------
function buildParts(document, prim, Pa, Na, Ta, Ia, withWheels) {
  const cls = classify(Pa, Ia);
  const root = document.getRoot();
  const mat = prim.getMaterial();
  const buffer = root.listBuffers()[0];
  const scene = root.listScenes()[0];
  for (const n of root.listNodes()) n.dispose();
  for (const m of root.listMeshes()) m.dispose();
  const names = ['wheel_rr', 'wheel_rf', 'wheel_lr', 'wheel_lf']; // placeholder, renamed after transform below
  const groups = [-1, 0, 1, 2, 3];
  const out = {};
  for (const g of groups) {
    if (g >= 0 && !withWheels) continue;
    const tris = []; for (let t = 0; t < cls.length; t++) if (cls[t] === g) tris.push(t);
    if (!tris.length) continue;
    const map = new Map(), pos = [], nor = [], uv = [], idx = [];
    let pivot = [0, 0, 0];
    if (g >= 0) {
      // true wheel centre = centre of the extracted wheel geometry's bounding box (in y/z)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const i = Ia[t * 3 + k], x = Pa[i * 3], y = Pa[i * 3 + 1], z = Pa[i * 3 + 2];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      pivot = xf((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    }
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const i = Ia[t * 3 + k];
      if (!map.has(i)) {
        map.set(i, pos.length / 3);
        const p = xf(Pa[i * 3], Pa[i * 3 + 1], Pa[i * 3 + 2]);
        pos.push(p[0] - (g >= 0 ? pivot[0] : 0), p[1] - (g >= 0 ? pivot[1] : 0), p[2] - (g >= 0 ? pivot[2] : 0));
        if (Na) nor.push(...nf(Na[i * 3], Na[i * 3 + 1], Na[i * 3 + 2]));
        if (Ta) uv.push(Ta[i * 2], Ta[i * 2 + 1]);
      }
      idx.push(map.get(i));
    }
    // mirroring both x and z keeps winding order, so indices stay as-is
    const p = document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx)).setBuffer(buffer));
    if (Na) p.setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer));
    if (Ta) p.setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
    if (mat) p.setMaterial(mat);
    let name = 'body';
    if (g >= 0) {
      // after the transform: +Z is front, +X is the car's left
      const front = pivot[2] > 0, left = pivot[0] > 0;
      name = `wheel_${left ? 'l' : 'r'}${front ? 'f' : 'r'}`;
    }
    const mesh = document.createMesh(name).addPrimitive(p);
    const node = document.createNode(name).setMesh(mesh).setTranslation(g >= 0 ? pivot : [0, 0, 0]);
    scene.addChild(node);
    out[name] = { tris: tris.length, pivot };
  }
  prim.dispose?.();
  return out;
}

if (src.T && doc.getRoot().listMaterials().length) await paintOut(doc, src.prim, src.P, src.T, src.I);
const parts = buildParts(doc, src.prim, src.P, src.N, src.T, src.I, true);
const radiusM = R * scale;
doc.getRoot().listScenes()[0].setExtras({ freeWorld: { wheelRadius: radiusM, length: LENGTH, parts } });
await io.write(outFile, doc);
console.log('wrote', outFile, JSON.stringify({ wheelRadius: +radiusM.toFixed(3), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { tris: v.tris, pivot: v.pivot.map((n) => +n.toFixed(3)) }])) }));

// LODs: same transform, body only (wheels always come from LOD0's wheel meshes)
for (const f of lods) {
  const d = await io.read(f);
  const s = readPrim(d);
  const res = buildParts(d, s.prim, s.P, s.N, s.T, s.I, false);
  await io.write(f, d);
  console.log('lod', f, 'body tris', res.body?.tris);
}
