import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const col = new THREE.Color();
const KEEP = ['position', 'normal', 'uv', 'color'];

// Collects kit modules in building-local space, bucketed by material, with per-module tint
// (vertex colour) and world-scaled UVs; `build()` merges each bucket into one mesh.
export class GeoBuilder {
  constructor(materials) {
    this.M = materials;
    this.buckets = new Map(); // material -> geometries[]
    this.colliders = [];       // {cx,cy,cz,hx,hy,hz,rotY}
    this.tris = 0;
  }

  push(matName, geo, color = '#ffffff') {
    const mat = typeof matName === 'string' ? this.M[matName] : matName;
    if (!mat) throw new Error('unknown material ' + matName);
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    col.set(color); for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    this.tris += n / 3;
    return g;
  }

  // Axis-aligned (optionally yaw-rotated) box with UVs scaled to world metres / tile.
  box(mat, cx, cy, cz, sx, sy, sz, color, { rotY = 0, tile = 1, collide = false } = {}) {
    if (sx <= 0 || sy <= 0 || sz <= 0) return;
    const g = new THREE.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
    if (rotY) g.rotateY(rotY);
    g.translate(cx, cy, cz);
    this.push(mat, g, color);
    if (collide) this.collider(cx, cy, cz, sx / 2, sy / 2, sz / 2, rotY);
  }

  cyl(mat, cx, cy, cz, r, h, color, { seg = 12, r2 = r, collide = false } = {}) {
    const g = new THREE.CylinderGeometry(r2, r, h, seg); g.translate(cx, cy + h / 2, cz);
    this.push(mat, g, color);
    if (collide) this.collider(cx, cy + h / 2, cz, r, h / 2, r);
  }

  // Triangular-prism gable roof along X (ridge along X), footprint w x d centered at (cx,cz), base at y.
  gable(mat, cx, y, cz, w, d, h, color, { overhang = 0.4, alongZ = false, tile = 2 } = {}) {
    const W = (alongZ ? d : w) + overhang * 2, D = (alongZ ? w : d) + overhang * 2;
    const s = new THREE.Shape(); s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(0, h); s.lineTo(-D / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false });
    g.translate(0, 0, -W / 2); g.rotateY(Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
    if (alongZ) g.rotateY(Math.PI / 2);
    g.translate(cx, y, cz);
    this.push(mat, g, color);
  }

  // Hip roof (pyramid-ish) over w x d.
  hip(mat, cx, y, cz, w, d, h, color, overhang = 0.45) {
    const W = w + overhang * 2, D = d + overhang * 2, r = Math.min(W, D) / 2;
    const p = [[-W / 2, 0, -D / 2], [W / 2, 0, -D / 2], [W / 2, 0, D / 2], [-W / 2, 0, D / 2]];
    const ridgeHalf = Math.max(0, W / 2 - r);
    const a = [-ridgeHalf, h, 0], b = [ridgeHalf, h, 0];
    const tris = [p[0], a, p[1], p[1], a, b, p[1], b, p[2], p[2], b, p[3], p[3], b, a, p[3], a, p[0]].map((v) => [v[0] + cx, v[1] + y, v[2] + cz]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
    const uv = []; for (const v of tris) uv.push((v[0] + v[2]) / 2, v[1] + Math.abs(v[2] - cz) * 0.5); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.push(mat, g, color);
  }

  plane(mat, cx, y, cz, w, d, color, { tile = 2, rotY = 0 } = {}) {
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    if (rotY) g.rotateY(rotY);
    g.translate(cx, y, cz);
    this.push(mat, g, color);
  }

  // Textured quad using an explicit UV rect (sign atlas), facing +Z before rotation.
  quad(mat, cx, cy, cz, w, h, uvRect, rotY = 0) {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, [u0, v0, u1, v1] = uvRect;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    g.rotateY(rotY); g.translate(cx, cy, cz);
    this.push(mat, g, '#ffffff');
  }

  collider(cx, cy, cz, hx, hy, hz, rotY = 0) { this.colliders.push({ cx, cy, cz, hx, hy, hz, rotY }); }

  build(name = 'building') {
    const group = new THREE.Group(); group.name = name;
    for (const [mat, geos] of this.buckets) {
      const g = mergeGeometries(geos, false);
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !mat.transparent; m.receiveShadow = true;
      group.add(m);
    }
    this.buckets.clear();
    return group;
  }
}

// Deterministic RNG per building so layouts are stable between sessions and players.
export function rng(seed) {
  // mix the seed (murmur3 finaliser) so consecutive seeds give unrelated sequences
  let s = (seed * 2654435761) >>> 0; s ^= s >>> 16; s = Math.imul(s, 0x85ebca6b) >>> 0; s ^= s >>> 13; s = Math.imul(s, 0xc2b2ae35) >>> 0; s ^= s >>> 16; s = s || 1;
  const f = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (a, b) => a + f() * (b - a);
  f.int = (a, b) => Math.floor(f.range(a, b + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}
