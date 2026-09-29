import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Built-in rigged humanoid so the game never depends on a network download.
// Skeleton uses Mixamo bone names — the same layout `tripo anim rig --spec mixamo`
// produces — so generated characters are drop-in replacements.
// Everything is one skinned mesh with vertex colours: one draw call per character.

const BONES = [
  // name, parent, rest position (world, metres; character faces +Z, its left is +X)
  ['Hips', null, [0, 0.95, 0]],
  ['Spine', 'Hips', [0, 1.05, 0]],
  ['Spine1', 'Spine', [0, 1.17, 0]],
  ['Spine2', 'Spine1', [0, 1.29, 0]],
  ['Neck', 'Spine2', [0, 1.47, 0]],
  ['Head', 'Neck', [0, 1.55, 0.01]],
  ['HeadTop_End', 'Head', [0, 1.77, 0.01]],
  ['LeftShoulder', 'Spine2', [0.07, 1.42, 0]],
  ['LeftArm', 'LeftShoulder', [0.19, 1.41, -0.01]],
  ['LeftForeArm', 'LeftArm', [0.23, 1.14, -0.02]],
  ['LeftHand', 'LeftForeArm', [0.25, 0.89, 0.0]],
  ['LeftHandEnd', 'LeftHand', [0.255, 0.79, 0.01]],
  ['RightShoulder', 'Spine2', [-0.07, 1.42, 0]],
  ['RightArm', 'RightShoulder', [-0.19, 1.41, -0.01]],
  ['RightForeArm', 'RightArm', [-0.23, 1.14, -0.02]],
  ['RightHand', 'RightForeArm', [-0.25, 0.89, 0.0]],
  ['RightHandEnd', 'RightHand', [-0.255, 0.79, 0.01]],
  ['LeftUpLeg', 'Hips', [0.1, 0.92, 0]],
  ['LeftLeg', 'LeftUpLeg', [0.105, 0.5, 0.01]],
  ['LeftFoot', 'LeftLeg', [0.11, 0.08, -0.01]],
  ['LeftToeBase', 'LeftFoot', [0.11, 0.025, 0.12]],
  ['RightUpLeg', 'Hips', [-0.1, 0.92, 0]],
  ['RightLeg', 'RightUpLeg', [-0.105, 0.5, 0.01]],
  ['RightFoot', 'RightLeg', [-0.11, 0.08, -0.01]],
  ['RightToeBase', 'RightFoot', [-0.11, 0.025, 0.12]],
];

export const LOOKS = [
  { skin: '#c68f6a', hair: '#1d1510', top: '#2d3f5c', sleeves: 'long', bottom: '#3a3d44', shoes: '#191919', accent: '#d9d4c8' },
  { skin: '#8d5a3c', hair: '#0f0c0a', top: '#8a2f2a', sleeves: 'short', bottom: '#2c3e5c', shoes: '#e8e6e0', accent: '#1a1a1a' },
  { skin: '#e7bfa0', hair: '#6b4a2b', top: '#d8d2c4', sleeves: 'short', bottom: '#5a4a38', shoes: '#4a3121', accent: '#394a2c' },
  { skin: '#5e3b27', hair: '#0b0908', top: '#3f5c38', sleeves: 'long', bottom: '#1f1f22', shoes: '#2b2b2b', accent: '#c9a14a' },
  { skin: '#d6a47f', hair: '#2a1d14', top: '#e0a13a', sleeves: 'short', bottom: '#33465e', shoes: '#f2f2f2', accent: '#222' },
  { skin: '#a8714d', hair: '#3a2a1f', top: '#1d1d20', sleeves: 'long', bottom: '#6d6a62', shoes: '#141414', accent: '#b43a2e' },
];

const V = (a) => new THREE.Vector3(...a);

// A tapered capsule-like limb from a to b with elliptical cross-section.
function limb(a, b, r0, r1, flat = 1, segs = 12) {
  const len = a.distanceTo(b);
  const pts = [];
  const cap = 5;
  for (let i = 0; i <= cap; i++) { const t = (i / cap) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(t) * r1, len + Math.cos(t) * r1 * 0.9)); }
  pts.reverse();
  const top = [];
  for (let i = 0; i <= cap; i++) { const t = (i / cap) * Math.PI / 2; top.push(new THREE.Vector2(Math.sin(t) * r0, -Math.cos(t) * r0 * 0.9)); }
  const profile = [...top, ...pts.reverse()].sort((p, q) => p.y - q.y);
  const g = new THREE.LatheGeometry(profile, segs);
  g.scale(1, 1, flat);
  // lathe runs along +Y from a; orient toward b
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}
function ellipsoid(c, rx, ry, rz, seg = 16) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  g.scale(rx, ry, rz); g.translate(c[0], c[1], c[2]);
  return g;
}
function roundedBox(c, w, h, d, r = 0.02) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 2, 4);
  // push vertices outward toward a rounded box
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const inner = new THREE.Vector3(THREE.MathUtils.clamp(v.x, -w / 2 + r, w / 2 - r), THREE.MathUtils.clamp(v.y, -h / 2 + r, h / 2 - r), THREE.MathUtils.clamp(v.z, -d / 2 + r, d / 2 - r));
    const dir = v.clone().sub(inner); if (dir.lengthSq() > 0) v.copy(inner.add(dir.normalize().multiplyScalar(r)));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.translate(c[0], c[1], c[2]);
  return g;
}

export function buildHumanoid(look = LOOKS[0]) {
  const bones = {}, list = [];
  const world = {};
  for (const [name, parent, pos] of BONES) {
    const b = new THREE.Bone(); b.name = 'mixamorig' + name;
    world[name] = V(pos);
    if (parent) { b.position.copy(world[name]).sub(world[parent]); bones[parent].add(b); } else b.position.copy(world[name]);
    bones[name] = b; list.push(b);
  }
  const idx = Object.fromEntries(BONES.map(([n], i) => [n, i]));
  const parts = [];
  const add = (geo, bone, color) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const n = g.attributes.position.count, col = new THREE.Color(color);
    const colors = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { colors.set([col.r, col.g, col.b], i * 3); si[i * 4] = idx[bone]; sw[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    parts.push(g);
  };
  const W = world, L = look;
  // torso: pelvis (trousers), abdomen + chest (top), with a belt
  add(ellipsoid([0, 0.94, 0], 0.165, 0.11, 0.11), 'Hips', L.bottom);
  add(limb(W.Spine.clone().setY(1.0), W.Spine1, 0.15, 0.145, 0.68), 'Spine', L.top);
  add(limb(W.Spine1, W.Spine2.clone().setY(1.35), 0.15, 0.175, 0.62), 'Spine1', L.top);
  add(ellipsoid([0, 1.37, -0.005], 0.19, 0.105, 0.115), 'Spine2', L.top);
  add(limb(V([0, 0.99, 0]), V([0, 1.02, 0]), 0.158, 0.158, 0.7), 'Hips', L.accent); // belt
  // neck + head (skin), hair cap, ears, nose, eyes, brows
  add(limb(W.Neck.clone().setY(1.44), W.Head, 0.052, 0.05, 1), 'Neck', L.skin);
  add(ellipsoid([0, 1.645, 0.012], 0.092, 0.118, 0.108), 'Head', L.skin);
  add(ellipsoid([0, 1.585, 0.045], 0.075, 0.055, 0.07), 'Head', L.skin); // jaw
  const hair = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55); hair.scale(0.098, 0.115, 0.114); hair.translate(0, 1.655, 0.0);
  add(hair, 'Head', L.hair);
  add(ellipsoid([0, 1.64, -0.055], 0.088, 0.09, 0.06), 'Head', L.hair); // back of head
  for (const s of [-1, 1]) {
    add(ellipsoid([s * 0.093, 1.635, 0.0], 0.014, 0.028, 0.02), 'Head', L.skin);
    add(ellipsoid([s * 0.034, 1.66, 0.103], 0.013, 0.009, 0.006, 8), 'Head', '#1a1612');
    add(ellipsoid([s * 0.035, 1.683, 0.1], 0.022, 0.005, 0.008, 8), 'Head', L.hair);
  }
  add(limb(V([0, 1.655, 0.108]), V([0, 1.615, 0.125]), 0.013, 0.016, 1, 8), 'Head', L.skin);
  add(ellipsoid([0, 1.587, 0.105], 0.02, 0.006, 0.006, 8), 'Head', '#8a4f45');
  // arms: shoulder cap, upper arm (sleeve), forearm (sleeve or skin), hands
  for (const [s, side] of [[1, 'Left'], [-1, 'Right']]) {
    add(ellipsoid([s * 0.17, 1.4, -0.01], 0.07, 0.06, 0.07), `${side}Shoulder`, L.top);
    add(limb(W[`${side}Arm`], W[`${side}ForeArm`], 0.052, 0.042), `${side}Arm`, L.top);
    add(limb(W[`${side}ForeArm`], W[`${side}Hand`], 0.042, 0.034), `${side}ForeArm`, L.sleeves === 'long' ? L.top : L.skin);
    if (L.sleeves === 'long') add(limb(W[`${side}Hand`].clone().add(V([0, 0.03, 0])), W[`${side}Hand`], 0.031, 0.03), `${side}ForeArm`, L.skin);
    add(roundedBox([W[`${side}Hand`].x + s * 0.004, 0.84, 0.0], 0.03, 0.1, 0.075, 0.014), `${side}Hand`, L.skin);
    add(limb(V([W[`${side}Hand`].x - s * 0.005, 0.86, 0.035]), V([W[`${side}Hand`].x - s * 0.01, 0.815, 0.045]), 0.011, 0.01, 1, 6), `${side}Hand`, L.skin); // thumb
    // legs: thigh + shin (trousers), shoe
    add(limb(W[`${side}UpLeg`], W[`${side}Leg`], 0.085, 0.06, 0.95), `${side}UpLeg`, L.bottom);
    add(limb(W[`${side}Leg`], W[`${side}Foot`].clone().setY(0.1), 0.058, 0.045, 0.95), `${side}Leg`, L.bottom);
    add(roundedBox([s * 0.11, 0.045, 0.045], 0.095, 0.085, 0.27, 0.035), `${side}Foot`, L.shoes);
    add(roundedBox([s * 0.11, 0.012, 0.045], 0.1, 0.024, 0.28, 0.01), `${side}Foot`, '#e9e6de'); // sole
  }
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'body';
  const skeleton = new THREE.Skeleton(list);
  const root = new THREE.Group();
  root.add(bones.Hips);
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  return { scene: root, clips: CLIPS, scale: 1, url: 'built-in' };
}

// ---------------------------------------------------------------- procedural animation clips
function clip(name, period, fn, steps = 24) {
  const tracks = {};
  const times = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * period, ph = (i / steps) * Math.PI * 2;
    times.push(t);
    const pose = fn(ph);
    for (const [bone, val] of Object.entries(pose)) {
      if (bone === 'HipsY') { (tracks[bone] ||= []).push(0, val, 0); continue; }
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(val[0] || 0, val[1] || 0, val[2] || 0, 'XYZ'));
      (tracks[bone] ||= []).push(q.x, q.y, q.z, q.w);
    }
  }
  const out = [];
  for (const [bone, values] of Object.entries(tracks)) {
    if (bone === 'HipsY') {
      const base = [];
      for (let i = 0; i < values.length; i += 3) base.push(0, 0.95 + values[i + 1], 0);
      out.push(new THREE.VectorKeyframeTrack('mixamorigHips.position', times, base));
    } else out.push(new THREE.QuaternionKeyframeTrack(`mixamorig${bone}.quaternion`, times, values));
  }
  return new THREE.AnimationClip(name, period, out);
}

// forward swing of a hanging limb = negative X rotation (character faces +Z)
const walk = clip('Walk', 1.0, (p) => {
  const s = Math.sin(p), c = Math.cos(p);
  return {
    LeftUpLeg: [-0.42 * s, 0, 0], RightUpLeg: [0.42 * s, 0, 0],
    LeftLeg: [Math.max(0, 0.75 * Math.sin(p + 1.9)) + 0.05, 0, 0], RightLeg: [Math.max(0, -0.75 * Math.sin(p + 1.9)) + 0.05, 0, 0],
    LeftFoot: [0.15 * Math.sin(p - 0.6), 0, 0], RightFoot: [-0.15 * Math.sin(p - 0.6), 0, 0],
    LeftArm: [0.32 * s, 0, 0.06], RightArm: [-0.32 * s, 0, -0.06],
    LeftForeArm: [-0.25 + 0.12 * s, 0, 0], RightForeArm: [-0.25 - 0.12 * s, 0, 0],
    Spine: [0.04, 0.07 * s, 0], Spine2: [0, -0.1 * s, 0.02 * c], Head: [0, 0.04 * s, 0],
    HipsY: 0.025 * Math.abs(Math.cos(p)) - 0.012,
  };
});
const run = clip('Run', 0.66, (p) => {
  const s = Math.sin(p);
  return {
    LeftUpLeg: [-0.85 * s - 0.1, 0, 0], RightUpLeg: [0.85 * s - 0.1, 0, 0],
    LeftLeg: [Math.max(0.15, 1.5 * Math.sin(p + 2.1) + 0.3), 0, 0], RightLeg: [Math.max(0.15, -1.5 * Math.sin(p + 2.1) + 0.3), 0, 0],
    LeftFoot: [0.3 * Math.sin(p - 0.5), 0, 0], RightFoot: [-0.3 * Math.sin(p - 0.5), 0, 0],
    LeftArm: [0.7 * s, 0, 0.12], RightArm: [-0.7 * s, 0, -0.12],
    LeftForeArm: [-1.35 + 0.2 * s, 0, 0], RightForeArm: [-1.35 - 0.2 * s, 0, 0],
    Spine: [0.16, 0.12 * s, 0], Spine2: [0.05, -0.18 * s, 0], Head: [-0.12, 0.08 * s, 0],
    HipsY: 0.06 * Math.abs(Math.cos(p)) - 0.05,
  };
});
const idle = clip('Idle', 3.2, (p) => {
  const s = Math.sin(p);
  return {
    Spine2: [0.02 * s, 0, 0], Spine: [0.01, 0, 0], Head: [-0.02 * s, 0.05 * Math.sin(p * 0.5), 0],
    LeftArm: [0.02 * s, 0, 0.08], RightArm: [0.02 * s, 0, -0.08], LeftForeArm: [-0.12, 0, 0], RightForeArm: [-0.12, 0, 0],
    LeftUpLeg: [0, 0, 0.02], RightUpLeg: [0, 0, -0.02], LeftLeg: [0.03, 0, 0], RightLeg: [0.03, 0, 0],
    HipsY: 0.004 * s,
  };
});
const CLIPS = [idle, walk, run];
