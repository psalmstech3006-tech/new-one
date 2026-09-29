import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BONES, CLIPS, limb, ellipsoid, roundedBox } from '../humanoid.js';
import { rng as makeRng } from '../city/geom.js';

// ============================================================================
// Character generation. A character is described by serialisable "DNA" (what the
// creator edits, what the server stores, what other players receive) and built into
// one skinned mesh on the shared Mixamo-named rig, so a Tripo-rigged body can later
// replace the procedural one without touching animation or gameplay code.
// ============================================================================

export const SKIN_TONES = ['#f3d5bf', '#e8bf9f', '#d9a57e', '#c68f6a', '#a8714d', '#8d5a3c', '#6e4630', '#5e3b27', '#4a2e1e'];
export const HAIR_COLORS = ['#0f0c0a', '#1d1510', '#2a1d14', '#3a2a1f', '#6b4a2b', '#8a5a33', '#b07a45', '#d1b07a', '#e3d3b0', '#9a9a9a', '#d8d8d8', '#7a2a1e'];
export const HAIR_STYLES = ['buzz', 'short', 'side', 'curly', 'afro', 'long', 'ponytail', 'bun', 'bob', 'bald'];
export const FACIAL = ['none', 'stubble', 'moustache', 'beard'];
export const TOPS = ['tee', 'longsleeve', 'hoodie', 'shirt', 'jacket', 'suit', 'tank', 'dress', 'police', 'medic', 'hivis'];
export const BOTTOMS = ['jeans', 'trousers', 'shorts', 'skirt'];
export const SHOES = ['sneakers', 'boots', 'dress', 'heels'];
export const ACCESSORIES = ['glasses', 'sunglasses', 'cap', 'beanie', 'backpack', 'watch', 'bag', 'earrings'];
const CLOTH = ['#1d1d20', '#2d3f5c', '#8a2f2a', '#3f5c38', '#d8d2c4', '#e0a13a', '#5a4a38', '#6d6a62', '#f2f2f2', '#b43a2e', '#2f6b8a', '#6a3a6a', '#c9a14a', '#3a4550', '#e8c9a0', '#1f4f3a', '#a0495a', '#44506a'];
const DENIM = ['#2c3e5c', '#33465e', '#3a4a6a', '#1f2a3a', '#5a6a80'];

export function defaultDNA() {
  return { v: 1, frame: 'm', age: 30, height: 1.78, build: 0.45, muscle: 0.4, skin: SKIN_TONES[3], hair: 'short', hairColor: HAIR_COLORS[1], facial: 'none',
    top: 'longsleeve', topColor: '#2d3f5c', bottom: 'jeans', bottomColor: '#3a3d44', shoes: 'sneakers', shoesColor: '#191919', acc: [] };
}

// Varied population: frames, ages, body types, skin tones, hair and outfits by role.
export function randomDNA(seed, { role = 'civilian' } = {}) {
  const r = makeRng(seed), frame = r.chance(0.5) ? 'f' : 'm', age = Math.round(18 + Math.pow(r(), 1.3) * 62);
  const hairPool = frame === 'f' ? ['long', 'ponytail', 'bun', 'bob', 'curly', 'afro', 'short', 'side'] : ['buzz', 'short', 'side', 'curly', 'afro', 'bald', 'short', 'long'];
  let hair = r.pick(hairPool); if (frame === 'm' && age > 50 && r.chance(0.35)) hair = 'bald';
  const hairColor = age > 60 ? r.pick(['#9a9a9a', '#d8d8d8', '#b8b8b8']) : age > 48 && r.chance(0.4) ? '#8a8a8a' : r.pick(HAIR_COLORS.slice(0, 9));
  const dna = {
    v: 1, frame, age, height: +(frame === 'f' ? 1.58 + r() * 0.2 : 1.68 + r() * 0.24).toFixed(2),
    build: +Math.min(1, Math.max(0, r() * 0.8 + (age > 40 ? 0.15 : 0))).toFixed(2), muscle: +(r() * 0.8).toFixed(2),
    skin: r.pick(SKIN_TONES), hair, hairColor, facial: frame === 'm' && age > 20 ? r.pick(['none', 'none', 'stubble', 'moustache', 'beard']) : 'none',
    top: r.pick(frame === 'f' ? ['tee', 'longsleeve', 'hoodie', 'shirt', 'jacket', 'dress', 'tank'] : ['tee', 'longsleeve', 'hoodie', 'shirt', 'jacket', 'suit', 'tank']),
    topColor: r.pick(CLOTH), bottom: r.pick(frame === 'f' ? ['jeans', 'trousers', 'skirt', 'shorts'] : ['jeans', 'trousers', 'shorts', 'jeans']),
    bottomColor: r.pick([...DENIM, ...CLOTH.slice(0, 8)]), shoes: r.pick(frame === 'f' ? ['sneakers', 'boots', 'heels', 'dress'] : ['sneakers', 'boots', 'dress']), shoesColor: r.pick(['#191919', '#e8e6e0', '#4a3121', '#2b2b2b', '#8a2f2a']),
    acc: ACCESSORIES.filter(() => r.chance(0.14)),
  };
  if (dna.top === 'suit') { dna.bottom = 'trousers'; dna.bottomColor = dna.topColor; dna.shoes = 'dress'; }
  if (dna.top === 'dress') dna.bottom = 'skirt', dna.bottomColor = dna.topColor;
  if (role === 'police') Object.assign(dna, { top: 'police', topColor: '#1c2a4a', bottom: 'trousers', bottomColor: '#1c2a4a', shoes: 'boots', shoesColor: '#111', acc: ['cap'] });
  if (role === 'medic') Object.assign(dna, { top: 'medic', topColor: '#2f7a8a', bottom: 'trousers', bottomColor: '#2f7a8a', shoes: 'sneakers', acc: [] });
  if (role === 'worker') Object.assign(dna, { top: 'hivis', topColor: '#f2c230', bottom: 'jeans', shoes: 'boots', shoesColor: '#4a3121' });
  return dna;
}

const cache = new Map();
// Build (and cache by DNA) the skinned body. Returns the same asset shape as the built-in humanoid.
export function buildAvatar(dna) {
  const key = JSON.stringify(dna);
  if (cache.has(key)) return cache.get(key);
  const D = { ...defaultDNA(), ...dna };
  const fem = D.frame === 'f', b = D.build, mu = D.muscle, old = Math.max(0, (D.age - 45) / 35);
  const sw = (fem ? 0.9 : 1.0) * (1 + mu * 0.08 + b * 0.04), hw = (fem ? 1.08 : 1.0) * (1 + b * 0.1);
  const world = {}, bones = {}, list = [];
  for (const [name, parent, pos] of BONES) {
    const p = new THREE.Vector3(...pos);
    if (/Shoulder|Arm|Hand/.test(name)) p.x *= sw; else if (/Leg|Foot|Toe/.test(name)) p.x *= hw;
    world[name] = p;
    const bone = new THREE.Bone(); bone.name = 'mixamorig' + name;
    if (parent) { bone.position.copy(p).sub(world[parent]); bones[parent].add(bone); } else bone.position.copy(p);
    bones[name] = bone; list.push(bone);
  }
  const idx = Object.fromEntries(BONES.map(([n], i) => [n, i]));
  const parts = [];
  const add = (geo, bone, color) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count, col = new THREE.Color(color);
    const colors = new Float32Array(n * 3), si = new Uint16Array(n * 4), swt = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { colors.set([col.r, col.g, col.b], i * 3); si[i * 4] = idx[bone]; swt[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(swt, 4));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    parts.push(g);
  };
  const W = world, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const skin = D.skin, top = D.topColor, bot = D.bottomColor;
  const uniform = ['police', 'medic', 'hivis'].includes(D.top);
  const longSleeves = ['longsleeve', 'hoodie', 'shirt', 'jacket', 'suit', 'police', 'medic', 'hivis'].includes(D.top);
  const bare = D.top === 'tank';
  const belly = b * 0.05 + old * 0.015, chest = fem ? 0.012 : mu * 0.02;
  // ---- torso
  add(ellipsoid([0, 0.94, 0], 0.16 * hw, 0.11, 0.105 + belly * 0.4), 'Hips', D.bottom === 'skirt' ? top : bot);
  add(limb(V(0, 1.0, 0), W.Spine1, 0.14 * hw + belly * 0.5, 0.135 + belly * 0.7, 0.66 + belly), 'Spine', top);
  add(limb(W.Spine1, V(0, 1.35, 0), 0.14 + belly * 0.5, 0.17 * sw, 0.6 + chest), 'Spine1', top);
  add(ellipsoid([0, 1.37, -0.005], 0.185 * sw, 0.1, 0.11 + chest), 'Spine2', top);
  if (fem) add(ellipsoid([0, 1.31, 0.05], 0.13 * sw, 0.06, 0.06), 'Spine2', top);
  if (belly > 0.03) add(ellipsoid([0, 1.07, 0.035], 0.125, 0.11, 0.07 + belly * 0.5), 'Spine', top);
  if (!['dress'].includes(D.top)) { const br = 0.148 * hw + belly * 0.3, g = new THREE.CylinderGeometry(br, br, 0.035, 18); g.scale(1, 1, (0.1 + belly * 0.4) / br + 0.02); g.translate(0, 0.995, 0.0); add(g, 'Hips', D.top === 'suit' ? '#1a1a1a' : '#2a2320'); }
  // garment details
  if (D.top === 'hoodie') { add(ellipsoid([0, 1.44, -0.1], 0.12, 0.07, 0.06), 'Spine2', top); add(roundedBox([0, 1.07, 0.1 + belly * 0.5], 0.2, 0.09, 0.02, 0.01), 'Spine', shade(top, -0.12)); }
  if (D.top === 'jacket' || D.top === 'suit') {
    add(roundedBox([0, 1.2, 0.108 + belly * 0.4], 0.07, 0.34, 0.012, 0.005), 'Spine1', D.top === 'suit' ? '#f4f4f2' : '#d8d2c4');
    for (const s of [-1, 1]) add(roundedBox([s * 0.05, 1.35, 0.1], 0.05, 0.12, 0.02, 0.008), 'Spine2', shade(top, -0.15));
    if (D.top === 'suit') add(roundedBox([0, 1.2, 0.12 + belly * 0.4], 0.035, 0.3, 0.01, 0.004), 'Spine1', '#7a1f24');
  }
  if (D.top === 'shirt') for (const s of [-1, 1]) add(roundedBox([s * 0.04, 1.43, 0.07], 0.05, 0.03, 0.03, 0.01), 'Spine2', shade(top, 0.15));
  if (uniform) {
    add(roundedBox([0, 1.2, 0.0], 0.33 * sw, 0.26, 0.24 + belly, 0.05), 'Spine1', D.top === 'hivis' ? '#f2c230' : shade(top, -0.05));
    if (D.top === 'hivis') for (const y of [1.12, 1.26]) add(roundedBox([0, y, 0], 0.34 * sw, 0.025, 0.25 + belly, 0.01), 'Spine1', '#d8dde2');
    if (D.top === 'police') { add(roundedBox([0.07, 1.33, 0.12], 0.05, 0.06, 0.01, 0.004), 'Spine2', '#d4af37'); add(roundedBox([-0.07, 1.33, 0.12], 0.06, 0.02, 0.01, 0.004), 'Spine2', '#f2f2f2'); }
    if (D.top === 'medic') add(roundedBox([0, 1.3, 0.125], 0.06, 0.06, 0.01, 0.004), 'Spine2', '#f2f2f2');
  }
  if (D.top === 'dress') {
    const g = new THREE.CylinderGeometry(0.16 * hw, 0.26 * hw, 0.5, 16, 1, true); g.translate(0, 0.72, 0); add(g, 'Hips', top);
  }
  // ---- neck, head, face
  add(limb(V(0, 1.44, 0), W.Head, 0.052 + mu * 0.008, 0.05, 1), 'Neck', skin);
  add(ellipsoid([0, 1.645, 0.012], fem ? 0.088 : 0.092, fem ? 0.113 : 0.118, 0.106), 'Head', skin);
  add(ellipsoid([0, 1.58, 0.05], fem ? 0.058 : 0.064, 0.048, 0.062), 'Head', skin);
  for (const s of [-1, 1]) {
    add(ellipsoid([s * 0.091, 1.635, 0.0], 0.014, 0.028, 0.02), 'Head', skin);
    add(ellipsoid([s * 0.034, 1.66, 0.101], 0.014, 0.01, 0.006, 8), 'Head', '#f2efe8');
    add(ellipsoid([s * 0.034, 1.66, 0.105], 0.007, 0.007, 0.004, 8), 'Head', '#2a1d14');
    add(ellipsoid([s * 0.035, 1.683 - old * 0.004, 0.1], 0.022, 0.005, 0.008, 8), 'Head', D.hair === 'bald' ? shade(skin, -0.3) : D.hairColor);
    if (D.acc.includes('earrings')) add(ellipsoid([s * 0.093, 1.61, 0.005], 0.007, 0.007, 0.007, 6), 'Head', '#d4af37');
  }
  add(limb(V(0, 1.655, 0.106), V(0, 1.613, 0.124), 0.012, 0.016, 1, 8), 'Head', shade(skin, -0.04));
  add(ellipsoid([0, 1.587, 0.103], 0.021, 0.006, 0.007, 8), 'Head', fem ? '#a0495a' : shade(skin, -0.25));
  hairFor(add, D);
  if (D.facial === 'stubble') add(ellipsoid([0, 1.578, 0.052], 0.066, 0.05, 0.064), 'Head', mix(skin, D.hairColor, 0.22));
  if (D.facial === 'beard') { add(ellipsoid([0, 1.572, 0.055], 0.07, 0.056, 0.066), 'Head', D.hairColor); add(ellipsoid([0, 1.6, 0.1], 0.032, 0.008, 0.01, 8), 'Head', D.hairColor); }
  if (D.facial === 'moustache') add(ellipsoid([0, 1.6, 0.107], 0.03, 0.008, 0.01, 8), 'Head', D.hairColor);
  // ---- accessories
  if (D.acc.includes('glasses') || D.acc.includes('sunglasses')) {
    const lens = D.acc.includes('sunglasses') ? '#111' : '#cfe0ea';
    for (const s of [-1, 1]) add(roundedBox([s * 0.035, 1.66, 0.11], 0.036, 0.026, 0.006, 0.004), 'Head', lens);
    add(roundedBox([0, 1.664, 0.112], 0.1, 0.006, 0.006, 0.002), 'Head', '#222');
    for (const s of [-1, 1]) add(roundedBox([s * 0.088, 1.664, 0.06], 0.004, 0.006, 0.1, 0.002), 'Head', '#222');
  }
  if (D.acc.includes('cap')) { const c = D.top === 'police' ? '#1c2a4a' : shade(top, 0.1); const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.1, 0.07, 0.112); g.translate(0, 1.69, 0.005); add(g, 'Head', c); add(roundedBox([0, 1.695, 0.12], 0.14, 0.012, 0.09, 0.005), 'Head', c); }
  else if (D.acc.includes('beanie')) { const g = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(0.1, 0.1, 0.112); g.translate(0, 1.68, 0); add(g, 'Head', shade(top, -0.1)); }
  if (D.acc.includes('backpack')) add(roundedBox([0, 1.22, -0.2 - belly * 0.3], 0.28, 0.36, 0.14, 0.04), 'Spine1', '#2a2e33');
  if (D.acc.includes('bag')) add(roundedBox([0.26 * sw, 1.02, 0.02], 0.06, 0.2, 0.26, 0.02), 'Spine', '#5a3a24');
  // ---- arms
  const armR = 0.048 + mu * 0.01 + b * 0.008;
  for (const [s, side] of [[1, 'Left'], [-1, 'Right']]) {
    add(ellipsoid([s * 0.165 * sw, 1.4, -0.01], 0.068 + mu * 0.01, 0.06, 0.07), `${side}Shoulder`, bare ? skin : top);
    add(limb(W[`${side}Arm`], W[`${side}ForeArm`], armR + 0.004, armR - 0.006), `${side}Arm`, bare || D.top === 'dress' ? skin : top);
    add(limb(W[`${side}ForeArm`], W[`${side}Hand`], armR - 0.011, armR - 0.016), `${side}ForeArm`, longSleeves ? top : skin);
    if (longSleeves) add(limb(W[`${side}Hand`].clone().add(V(0, 0.03, 0)), W[`${side}Hand`], 0.031, 0.03), `${side}ForeArm`, skin);
    if (side === 'Left' && D.acc.includes('watch')) add(limb(W.LeftHand.clone().add(V(0, 0.05, 0)), W.LeftHand.clone().add(V(0, 0.025, 0)), 0.036, 0.036, 1, 10), 'LeftForeArm', '#c9ccd0');
    add(roundedBox([W[`${side}Hand`].x + s * 0.004, 0.84, 0.0], 0.03, 0.1, 0.075, 0.014), `${side}Hand`, skin);
    add(limb(V(W[`${side}Hand`].x - s * 0.005, 0.86, 0.035), V(W[`${side}Hand`].x - s * 0.01, 0.815, 0.045), 0.011, 0.01, 1, 6), `${side}Hand`, skin);
    // ---- legs + shoes
    const thigh = 0.082 + b * 0.02 + (fem ? 0.006 : 0), shortsLeg = D.bottom === 'shorts' || D.bottom === 'skirt' || D.top === 'dress';
    const knee = W[`${side}Leg`], hip = W[`${side}UpLeg`];
    if (D.bottom === 'shorts') {
      const mid = hip.clone().lerp(knee, 0.55);
      add(limb(hip, mid, thigh, thigh - 0.008, 0.95), `${side}UpLeg`, bot);
      add(limb(mid, knee, thigh - 0.016, 0.056, 0.95), `${side}UpLeg`, skin);
    } else add(limb(hip, knee, thigh, 0.059, 0.95), `${side}UpLeg`, D.bottom === 'skirt' || D.top === 'dress' ? skin : bot);
    add(limb(knee, W[`${side}Foot`].clone().setY(0.1), 0.053, 0.042, 0.95), `${side}Leg`, shortsLeg ? skin : bot);
    const sc = D.shoesColor;
    if (D.shoes === 'boots') { add(limb(V(W[`${side}Foot`].x, 0.24, 0), V(W[`${side}Foot`].x, 0.08, 0), 0.056, 0.056, 1, 10), `${side}Leg`, sc); add(roundedBox([s * 0.11 * hw, 0.05, 0.045], 0.1, 0.1, 0.28, 0.035), `${side}Foot`, sc); }
    else if (D.shoes === 'heels') { add(roundedBox([s * 0.11 * hw, 0.06, 0.06], 0.075, 0.05, 0.22, 0.02), `${side}Foot`, sc); add(roundedBox([s * 0.11 * hw, 0.035, -0.04], 0.02, 0.07, 0.02, 0.005), `${side}Foot`, sc); }
    else { add(roundedBox([s * 0.11 * hw, 0.045, 0.045], 0.095, 0.085, 0.27, 0.035), `${side}Foot`, sc); add(roundedBox([s * 0.11 * hw, 0.012, 0.045], 0.1, 0.024, 0.28, 0.01), `${side}Foot`, D.shoes === 'dress' ? '#222' : '#e9e6de'); }
  }
  if (D.bottom === 'skirt' && D.top !== 'dress') { const g = new THREE.CylinderGeometry(0.165 * hw, 0.23 * hw, 0.36, 16, 1, true); g.translate(0, 0.78, 0); add(g, 'Hips', bot); }
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.SkinnedMesh(geo, mat); mesh.name = 'body';
  const skeleton = new THREE.Skeleton(list);
  const root = new THREE.Group(); root.add(bones.Hips); root.add(mesh); root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  const asset = { scene: root, clips: CLIPS, scale: D.height / 1.78, url: 'built-in', dna: D };
  cache.set(key, asset);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return asset;
}

function hairFor(add, D) {
  const c = D.hairColor, cap = (sy = 0.115, back = true, sc = 1) => {
    const g = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55); g.scale(0.098 * sc, sy, 0.114 * sc); g.translate(0, 1.655, 0); add(g, 'Head', c);
    if (back) add(ellipsoid([0, 1.64, -0.055], 0.088 * sc, 0.09, 0.06), 'Head', c);
  };
  switch (D.hair) {
    case 'bald': break;
    case 'buzz': cap(0.108, false, 0.985); break;
    case 'short': cap(); break;
    case 'side': cap(); add(ellipsoid([0.035, 1.745, 0.06], 0.07, 0.03, 0.05), 'Head', c); break;
    case 'curly': cap(0.12, true, 1.05); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; add(ellipsoid([Math.cos(a) * 0.08, 1.72 + Math.sin(i) * 0.01, Math.sin(a) * 0.08], 0.035, 0.03, 0.035, 8), 'Head', c); } break;
    case 'afro': add(ellipsoid([0, 1.7, -0.01], 0.15, 0.14, 0.15), 'Head', c); break;
    case 'long': cap(); add(roundedBox([0, 1.5, -0.06], 0.2, 0.3, 0.08, 0.04), 'Neck', c); for (const s of [-1, 1]) add(roundedBox([s * 0.095, 1.56, 0.0], 0.03, 0.2, 0.09, 0.015), 'Head', c); break;
    case 'ponytail': cap(); add(limb(new THREE.Vector3(0, 1.66, -0.11), new THREE.Vector3(0, 1.45, -0.14), 0.035, 0.022, 1, 10), 'Head', c); break;
    case 'bun': cap(); add(ellipsoid([0, 1.73, -0.1], 0.055, 0.05, 0.05), 'Head', c); break;
    case 'bob': cap(0.118, true, 1.06); for (const s of [-1, 1]) add(roundedBox([s * 0.098, 1.6, 0.0], 0.03, 0.12, 0.13, 0.015), 'Head', c); add(roundedBox([0, 1.6, -0.09], 0.2, 0.13, 0.04, 0.02), 'Head', c); break;
  }
}
function shade(hex, k) { const c = new THREE.Color(hex); const h = {}; c.getHSL(h); c.setHSL(h.h, h.s, Math.min(1, Math.max(0, h.l + k))); return '#' + c.getHexString(); }
function mix(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }
