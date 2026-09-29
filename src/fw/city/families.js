import * as THREE from 'three';
import { genericBuilding, T } from './archkit.js';
import { rng } from './geom.js';
import { stairwellFor } from './interiors.js';

// ============================================================================
// Building families. Each returns { group, colliders, doors, height, tris, footprint, meta }.
// meta: { family, category, name, interior (layout id or null), floors }
// All names/brands are original to Free World.
// ============================================================================

const BRICKS = ['#a4553f', '#8e4a38', '#b86a4f', '#7a3f31', '#9c6048', '#6e3b2c'];
const STUCCO = ['#e2cfa8', '#d4b98c', '#b9c7cc', '#e0bfa4', '#c4a784', '#d8cbb4', '#a9b89c', '#e3d3a0', '#c98f6e'];
const SIDING = ['#8ea9c0', '#c7b98f', '#96ad86', '#dcd2bd', '#b0957a', '#7f98a6', '#c9b49c', '#a3867a', '#e0d6a8'];
const ROOFS = ['#4a4540', '#5a4a42', '#3d4247', '#6b4a3a', '#4f4a46'];
const TRIMS = ['#f2efe8', '#e8e0d0', '#d8d2c6', '#f7f4ee'];

const out = (res, meta) => { res.meta = { gfh: res.gfh, ...meta }; res.group.userData.meta = res.meta; return res; };

// ---------------------------------------------------------------- residential
export function house(M, atlas, seed, { size = 'medium', name = 'House' } = {}) {
  const r = rng(seed);
  const dims = { small: [9, 8, 1], medium: [11, 9, 2], large: [15, 11, 2] }[size];
  const [w, d, floors] = dims;
  const mat = r.chance(0.55) ? 'siding' : r.chance(0.5) ? 'stucco' : 'brick';
  const wallColor = mat === 'siding' ? r.pick(SIDING) : mat === 'stucco' ? r.pick(STUCCO) : r.pick(BRICKS);
  const trim = r.pick(TRIMS), roof = r.chance(0.5) ? 'gable' : 'hip';
  const doorU = r.pick([-w / 4, 0, w / 5]);
  const res = genericBuilding({
    name, w, d, floors, gfh: 3.0, fh: 2.9, wallMat: mat, wallColor, trimColor: trim, frame: trim, roof, roofColor: r.pick(ROOFS), stairwell: floors > 1 ? stairwellFor('house', w, d, 3.0) : null,
    shutters: r.chance(0.5) ? r.pick(['#2d3b4a', '#3f5a3a', '#5a2f2a', '#303030']) : null, plinthH: 0.5, plinthColor: '#9a948a',
    doors: [{ side: 'front', u: doorU, w: 1.0, h: 2.15, style: 'wood', locked: true, keyId: `key_${name}` }, { side: 'back', u: -w / 4, w: 0.95, h: 2.1, locked: true, keyId: `key_${name}` }],
    winW: 1.2, winH: 1.35, module: 2.8, margin: 0.8, belts: floors > 1,
    extra(B, { S }) {
      // porch with posts, steps and a small roof
      const pw = 3.2, pd = 2.0, pz = d / 2 + pd / 2;
      B.box('wood', doorU, 0.35, pz, pw, 0.12, pd, '#8a7560', { collide: true });
      B.box('concrete', doorU, 0.14, pz + pd / 2 + 0.35, 1.6, 0.28, 0.7, '#b5afa5', { collide: true });
      for (const s of [-1, 1]) B.box('trim', doorU + s * (pw / 2 - 0.12), 1.55, pz + pd / 2 - 0.12, 0.16, 2.4, 0.16, trim);
      B.box('shingle', doorU, 2.85, pz, pw + 0.4, 0.14, pd + 0.4, r.pick(ROOFS));
      // chimney
      B.box('brick', w / 2 - 1.2, 3.0 * floors + 1.6, -d / 4, 0.9, 3.4, 0.9, '#8e4a38');
      // attached garage for medium/large
      if (size !== 'small') {
        const gx = w / 2 + 2.6;
        B.box(mat, gx, 1.5, 0, 5.2, 3.0, d - 1.5, wallColor, { collide: true, tile: 2.4 });
        B.box('metal', gx, 1.15, d / 2 - 0.7, 3.6, 2.3, 0.08, '#e8e6e0', { collide: false });
        for (let y = 0.3; y < 2.3; y += 0.46) B.box('metal', gx, y, d / 2 - 0.66, 3.6, 0.04, 0.06, '#c9c6bf');
        B.gable('shingle', gx, 3.0, 0, 5.2, d - 1.5, 1.4, r.pick(ROOFS), { overhang: 0.35 });
        B.box('concrete', gx, 0.02, d / 2 + 4, 4.2, 0.04, 8, '#b2ada4');           // driveway
      }
      // front path + lawn edge
      B.box('concrete', doorU, 0.02, d / 2 + 4.5, 1.2, 0.04, 5, '#bdb8ae');
      // picket fence along the front edge
      const fz = d / 2 + 7.2;
      for (let x = -w / 2 - 1; x < w / 2 + 1; x += 0.3) if (Math.abs(x - doorU) > 0.8) B.box('wood', x, 0.5, fz, 0.08, 1.0, 0.04, '#f0ede6');
      B.box('wood', 0, 0.8, fz, w + 2, 0.06, 0.06, '#f0ede6');
    },
  }, M, atlas, seed);
  return out(res, { family: 'house', category: 'residential', name, interior: 'house', floors });
}

export function duplex(M, atlas, seed, { name = 'Duplex' } = {}) {
  const r = rng(seed), w = 16, d = 10;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 3.0, fh: 2.9, wallMat: r.chance(0.5) ? 'stucco' : 'siding', wallColor: r.pick([...STUCCO, ...SIDING]), trimColor: '#f2efe8',
    roof: 'gable', roofColor: r.pick(ROOFS), plinthH: 0.5,
    doors: [{ side: 'front', u: -2, w: 1.0, locked: true, keyId: `key_${name}_A` }, { side: 'front', u: 2, w: 1.0, locked: true, keyId: `key_${name}_B` }],
    winW: 1.2, winH: 1.35, module: 2.6,
    extra(B) {
      B.box('trim', 0, 3.0 * 2 / 2 + 0.3, d / 2 + 0.2, 0.3, 6.2, 0.4, '#e6e0d4'); // party-wall pilaster
      for (const u of [-2, 2]) { B.box('concrete', u, 0.2, d / 2 + 0.8, 2.2, 0.4, 1.6, '#b5afa5', { collide: true }); B.box('shingle', u, 2.7, d / 2 + 0.8, 2.4, 0.12, 1.8, '#4a4540'); }
    },
  }, M, atlas, seed);
  return out(res, { family: 'duplex', category: 'residential', name, interior: null, floors: 2 });
}

export function townhouseRow(M, atlas, seed, { units = 4, name = 'Townhouses' } = {}) {
  const r = rng(seed), uw = 6, w = uw * units, d = 11, floors = 3;
  const colors = Array.from({ length: units }, () => r.pick([...BRICKS, ...STUCCO]));
  const res = genericBuilding({
    name, w, d, floors, gfh: 3.1, fh: 3.0, wallMat: 'brick', wallColor: colors[0], trimColor: '#efe9dd', lintel: '#d9d2c3',
    doors: Array.from({ length: units }, (_, i) => ({ side: 'front', u: -w / 2 + uw * (i + 0.25), w: 1.0, locked: true, keyId: `key_${name}_${i}` })),
    winW: 1.1, winH: 1.6, module: uw / 2, margin: 0, cornice: true, corniceDepth: 0.4,
    wallSplits: { front: Array.from({ length: units - 1 }, (_, i) => -w / 2 + uw * (i + 1)), back: Array.from({ length: units - 1 }, (_, i) => -w / 2 + uw * (i + 1)) },
    wallColorAt: (side, u) => (side === 'front' ? colors[Math.min(units - 1, Math.floor((u + w / 2) / uw))] : side === 'back' ? colors[Math.min(units - 1, Math.floor((w / 2 - u) / uw))] : side === 'left' ? colors[0] : colors[units - 1]),
    extra(B) {
      for (let i = 0; i < units; i++) {
        const x0 = -w / 2 + uw * i;
        // stoop
        B.box('stone', x0 + uw * 0.25, 0.35, d / 2 + 1.1, 1.6, 0.7, 1.8, '#a8a196', { collide: true });
        for (let k = 0; k < 3; k++) B.box('stone', x0 + uw * 0.25, 0.12 + k * 0.23, d / 2 + 2.1 + k * -0.3, 1.6, 0.23, 0.35, '#a8a196');
        if (i > 0) B.box('trim', x0, 5.3, d / 2 + 0.1, 0.25, 9.6, 0.2, '#e3dccf');
      }
    },
  }, M, atlas, seed);
  return out(res, { family: 'townhouse', category: 'residential', name, interior: null, floors });
}

export function apartmentBlock(M, atlas, seed, { floors = 5, w = 24, d = 16, name = 'Apartments', enterable = true } = {}) {
  const r = rng(seed);
  const mat = r.chance(0.6) ? 'stucco' : 'brick', col = mat === 'brick' ? r.pick(BRICKS) : r.pick(STUCCO);
  const res = genericBuilding({
    name, w, d, floors, gfh: 3.4, fh: 3.0, wallMat: mat, wallColor: col, trimColor: '#ece6da', lintel: mat === 'brick' ? '#d9d2c3' : null, stairwell: enterable ? stairwellFor('apartmentLobby', w, d, 3.4) : null,
    doors: [{ side: 'front', u: 0, w: 1.8, h: 2.5, kind: 'double', style: 'glass', label: `${name} lobby` }],
    balconies: (f, i, n) => (i + f) % 2 === 0 && i !== Math.floor(n / 2), module: 3.2, winW: 1.5,
    signs: [{ text: name.toUpperCase(), y: 3.0, w: 4, h: 0.5, style: { bg: '#20262e', font: 'bold 64px Georgia, serif' } }],
    extra(B) { // entrance canopy
      B.box('concrete', 0, 2.95, d / 2 + 1.1, 4.2, 0.22, 2.2, '#dcd6cb');
      for (const s of [-1, 1]) B.box('metal', s * 1.9, 1.45, d / 2 + 2.05, 0.1, 2.9, 0.1, '#3a3d42');
    },
  }, M, atlas, seed);
  return out(res, { family: 'apartment', category: 'residential', name, interior: enterable ? 'apartmentLobby' : null, floors });
}

export function walkup(M, atlas, seed, { floors = 4, name = 'Walk-up' } = {}) {
  const r = rng(seed), w = 12, d = 18;
  const res = genericBuilding({
    name, w, d, floors, wallMat: 'brick', wallColor: r.pick(BRICKS), lintel: '#cfc6b4', waterTank: r.chance(0.6), trimColor: '#cfc8bb',
    fireEscape: { side: 'front', u: 3 }, doors: [{ side: 'front', u: -3.5, locked: true, keyId: `key_${name}` }], module: 2.9,
  }, M, atlas, seed);
  return out(res, { family: 'walkup', category: 'residential', name, interior: null, floors });
}

export function luxuryResidence(M, atlas, seed, { name = 'Residence' } = {}) {
  const r = rng(seed), w = 20, d = 14;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 3.6, fh: 3.4, wallMat: 'stucco', wallColor: '#f1ece2', trimColor: '#ffffff', frame: '#2b2e33', roof: 'flat', cornice: false, parapet: 0.3, bulkhead: false,
    winW: 2.4, winH: 2.2, sillH: 0.5, module: 3.6, glass: '#7f98ab', belts: false, plinthColor: '#c9c3b8',
    doors: [{ side: 'front', u: -4, w: 1.6, h: 2.6, kind: 'double', style: 'glass', locked: true, keyId: `key_${name}` }],
    extra(B) {
      B.box('concrete', 3, 3.6 + 3.4 + 0.5, 1, 12, 0.3, 11, '#e9e4da');              // cantilevered roof plate
      B.box('wood', 6, 1.8, d / 2 + 0.2, 6, 3.4, 0.08, '#8a6a4a');                  // timber cladding panel
      B.box('concrete', 0, 0.05, d / 2 + 6, w + 6, 0.1, 10, '#c8c2b8');              // terrace
      B.box('tile', -5, 0.12, d / 2 + 6, 7, 0.1, 4, '#5fa8c9');                      // pool
    },
  }, M, atlas, seed);
  return out(res, { family: 'luxury', category: 'residential', name, interior: null, floors: 2 });
}

// ---------------------------------------------------------------- commercial
// Main-street mixed-use block: storefronts below, apartments above.
export function mixedUse(M, atlas, seed, { shops, floors = 3, w = 22, d = 16, name = 'Main St block' } = {}) {
  const r = rng(seed), gfh = 4.2;
  const shopSpecs = shops.map((s, i) => ({ ...s, u0: -w / 2 + (w / shops.length) * i + 0.15, u1: -w / 2 + (w / shops.length) * (i + 1) - 0.15 }));
  const res = genericBuilding({
    name, w, d, floors, gfh, fh: 3.1, wallMat: r.chance(0.65) ? 'brick' : 'stucco', wallColor: r.pick([...BRICKS, ...STUCCO]), lintel: '#d9d2c3', trimColor: '#e5ded0',
    ground: 'storefront', shops: shopSpecs, clearGlass: true,
    doors: [...shopSpecs.map((s) => ({ side: 'front', u: (s.u0 + s.u1) / 2 + (s.doorOffset ?? 0), w: 1.8, h: 2.6, kind: 'double', style: 'glass', label: s.name, interactive: s.interior !== false })),
      { side: 'back', u: 0, w: 1.0, locked: true, keyId: 'key_service' }],
    balconies: r.chance(0.4) ? (f, i) => i % 3 === 1 : null, fireEscape: r.chance(0.5) ? { side: 'back', u: 0 } : null, waterTank: r.chance(0.3),
    module: 3.0,
  }, M, atlas, seed);
  return out(res, { family: 'mixedUse', category: 'commercial', name, interior: 'shops', shops: shopSpecs, floors, gfh });
}

export function convenienceStore(M, atlas, seed, { name = 'QuikStop 24/7' } = {}) {
  const w = 16, d = 12;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 4.4, wallMat: 'stucco', wallColor: '#e9e4d8', trimColor: '#c8342a', ground: 'storefront', bandColor: '#c8342a', clearGlass: true,
    shops: [{ u0: -w / 2 + 0.2, u1: w / 2 - 0.2, name, style: { bg: '#c8342a', fg: '#ffffff', accent: '#ffd23f' } }],
    doors: [{ side: 'front', u: -2.5, w: 1.8, h: 2.6, kind: 'double', style: 'glass', label: name }, { side: 'back', u: 4, locked: true, keyId: 'key_service' }],
    cornice: false, parapet: 1.2, bulkhead: false,
  }, M, atlas, seed);
  return out(res, { family: 'convenience', category: 'commercial', name, interior: 'convenience', floors: 1 });
}

export function supermarket(M, atlas, seed, { name = 'FreshWay Market' } = {}) {
  const w = 44, d = 32;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 7, wallMat: 'concrete', wallColor: '#d6d1c6', ground: 'storefront', bandColor: '#2f7a4f', parapet: 1.6, bulkhead: false,
    shops: [{ u0: -10, u1: 10, name, style: { bg: '#2f7a4f', fg: '#fff', accent: '#f2c230' } }],
    doors: [{ side: 'front', u: -4, w: 2.4, h: 3, kind: 'double', style: 'glass' }, { side: 'front', u: 4, w: 2.4, h: 3, kind: 'double', style: 'glass' }, { side: 'back', u: 0, kind: 'roller', w: 4, h: 4 }],
    blankSides: ['left', 'right'], winW: 2, module: 5,
  }, M, atlas, seed);
  return out(res, { family: 'supermarket', category: 'commercial', name, interior: null, floors: 1 });
}

export function bank(M, atlas, seed, { name = 'Harbor Savings Bank' } = {}) {
  const w = 20, d = 18;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 5, fh: 4, wallMat: 'stone', wallColor: '#e3dccd', trimColor: '#efe9dc', frame: '#3a3d42', lintel: '#cfc6b4', transom: true,
    doors: [{ side: 'front', u: 0, w: 2.0, h: 3.2, kind: 'double', style: 'glass', label: name }], winW: 1.6, winH: 2.6, sillH: 1.0, module: 3.4,
    signs: [{ text: name.toUpperCase(), y: 8.2, w: 10, h: 0.9, style: { bg: '#e3dccd', fg: '#2a2f38', font: 'bold 64px Georgia, serif' } }],
    extra(B) {
      // classical portico: steps + columns + pediment
      for (let k = 0; k < 4; k++) B.box('stone', 0, 0.12 + k * 0.24, d / 2 + 3.2 - k * 0.45, 14 - k * 0.3, 0.24, 1.2 + k * 0.9, '#d9d2c3', { collide: true });
      for (let i = 0; i < 6; i++) { const x = -6 + i * 2.4; B.cyl('stone', x, 1.0, d / 2 + 1.6, 0.4, 7.4, '#efe9dc', { seg: 16, collide: true }); B.box('stone', x, 8.5, d / 2 + 1.6, 1.0, 0.25, 1.0, '#e6dfd0'); }
      B.box('stone', 0, 8.85, d / 2 + 1.6, 15, 0.5, 2.4, '#e6dfd0');
      B.gable('stone', 0, 9.1, d / 2 + 1.6, 15, 2.4, 1.6, '#e6dfd0', { overhang: 0.1 });
    },
  }, M, atlas, seed);
  return out(res, { family: 'bank', category: 'commercial', name, interior: 'bank', floors: 2 });
}

export function hotel(M, atlas, seed, { name = 'The Harborview Hotel', floors = 8 } = {}) {
  const w = 26, d = 18;
  const res = genericBuilding({
    name, w, d, floors, gfh: 4.6, fh: 3.1, wallMat: 'stucco', wallColor: '#e6d7c0', trimColor: '#f4efe6', frame: '#5a4a3a',
    ground: 'storefront', shops: [{ u0: -w / 2 + 0.3, u1: w / 2 - 0.3, name: name.toUpperCase(), style: { bg: '#3b2a1e', fg: '#f2d8a0', font: 'bold 60px Georgia, serif' } }],
    doors: [{ side: 'front', u: 0, w: 2.4, h: 3.0, kind: 'double', style: 'glass' }], balconies: (f, i) => true, module: 3.2, winW: 1.4, allBelts: false,
    extra(B) { B.box('metal', 0, 4.2, d / 2 + 3, 8, 0.25, 6, '#2b2520'); for (const s of [-1, 1]) B.box('metal', s * 3.8, 2.1, d / 2 + 5.8, 0.12, 4.2, 0.12, '#c9a14a'); },
  }, M, atlas, seed);
  return out(res, { family: 'hotel', category: 'commercial', name, interior: null, floors });
}

export function gasStation(M, atlas, seed, { name = 'Horizon Fuel' } = {}) {
  const r = rng(seed);
  const res = genericBuilding({
    name, w: 12, d: 9, floors: 1, gfh: 3.8, wallMat: 'stucco', wallColor: '#f2efe8', ground: 'storefront', bandColor: '#1f6fb2', cornice: false, parapet: 0.8, bulkhead: false, clearGlass: true,
    shops: [{ u0: -5.8, u1: 5.8, name: name.toUpperCase() + ' MART', style: { bg: '#1f6fb2', fg: '#fff', accent: '#ffb000' } }],
    doors: [{ side: 'front', u: 3, w: 1.8, h: 2.5, kind: 'double', style: 'glass' }],
    extra(B, { atlas: A }) {
      // forecourt canopy + pump islands in front of the shop
      const cz = 14;
      B.box('metal', 0, 5.4, cz, 22, 0.8, 12, '#f4f4f0');
      B.box('trim', 0, 5.4, cz + 6.02, 22, 0.8, 0.05, '#1f6fb2'); B.box('trim', 0, 5.4, cz - 6.02, 22, 0.8, 0.05, '#1f6fb2');
      B.box('light', 0, 4.97, cz, 20, 0.06, 10, '#ffffff');
      for (const x of [-7, 0, 7]) {
        B.box('metal', x, 2.5, cz, 0.5, 5, 0.5, '#e8e8e4', { collide: true });
        B.box('concrete', x, 0.1, cz, 1.4, 0.2, 5, '#c9c5bc', { collide: true });
        for (const s of [-1, 1]) { B.box('plastic', x, 0.95, cz + s * 1.4, 0.9, 1.5, 0.6, '#1f6fb2', { collide: true }); B.box('screen', x, 1.3, cz + s * 1.72, 0.5, 0.35, 0.02, '#ffffff'); }
      }
      // tall price sign
      B.box('metal', 12, 4, 20, 0.35, 8, 0.35, '#8c9196', { collide: true });
      if (A) { const rect = A.add('FUEL  3.49', { bg: '#1f6fb2', fg: '#fff', accent: '#ffb000' }); B.quad(A.material, 12, 7.2, 20.2, 3.2, 1.6, rect, 0); }
    },
  }, M, atlas, seed);
  return out(res, { family: 'gas', category: 'commercial', name, interior: 'convenience', floors: 1 });
}

export function mall(M, atlas, seed, { name = 'Harbor Heights Mall' } = {}) {
  const w = 70, d = 44;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 6, fh: 5.5, wallMat: 'concrete', wallColor: '#e2ddd2', trimColor: '#f2eee6', ground: 'storefront', bandColor: '#333a44', clearGlass: true,
    shops: [
      { u0: -34, u1: -18, name: 'THREADLINE', style: { bg: '#1c1c1c', fg: '#fff' } },
      { u0: -8, u1: 8, name: name.toUpperCase(), style: { bg: '#2a3a5a', fg: '#fff', accent: '#f2a33a' } },
      { u0: 18, u1: 34, name: 'VOLT ELECTRONICS', style: { bg: '#0f2438', fg: '#5fd1ff' } },
    ],
    doors: [{ side: 'front', u: 0, w: 3.2, h: 3.2, kind: 'double', style: 'glass', label: name }, { side: 'front', u: -26, w: 1.8, h: 2.6, kind: 'double', style: 'glass' }, { side: 'front', u: 26, w: 1.8, h: 2.6, kind: 'double', style: 'glass' }],
    blankSides: ['left', 'right', 'back'], winW: 3.2, winH: 3.0, module: 6, parapet: 1.4,
    extra(B) {
      // glazed entrance atrium volume projecting from the facade
      B.box('glass', 0, 6, d / 2 + 2.2, 16, 12, 0.1, '#93aabb');
      for (let x = -8; x <= 8; x += 2) B.box('frame', x, 6, d / 2 + 2.25, 0.12, 12, 0.14, '#3a3d42');
      for (let y = 0.1; y <= 12; y += 3) B.box('frame', 0, y, d / 2 + 2.25, 16, 0.12, 0.14, '#3a3d42');
      B.box('concrete', 0, 12.2, d / 2 + 1.1, 17, 0.4, 2.6, '#d6d1c6');
      for (const s of [-1, 1]) B.box('glass', s * 8, 6, d / 2 + 1.1, 0.1, 12, 2.2, '#93aabb');
    },
  }, M, atlas, seed);
  return out(res, { family: 'mall', category: 'commercial', name, interior: 'mall', floors: 2 });
}

export function dealership(M, atlas, seed, { name = 'Summit Motors' } = {}) {
  const w = 30, d = 20;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 6.5, wallMat: 'metal', wallColor: '#c9ccd0', ground: 'storefront', bandColor: '#1a1d22', parapet: 0.6, bulkhead: false,
    shops: [{ u0: -14.5, u1: 14.5, name: name.toUpperCase(), style: { bg: '#1a1d22', fg: '#e8e8e8', accent: '#c8342a' } }],
    doors: [{ side: 'front', u: 8, w: 2.0, h: 2.8, kind: 'double', style: 'glass' }, { side: 'right', u: 0, kind: 'roller', w: 4, h: 4 }],
  }, M, atlas, seed);
  return out(res, { family: 'dealership', category: 'commercial', name, interior: null, floors: 1 });
}

// ---------------------------------------------------------------- public
export function school(M, atlas, seed, { name = 'Harbor Heights High School' } = {}) {
  const w = 48, d = 18;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 3.8, fh: 3.6, wallMat: 'brick', wallColor: '#9c5a45', trimColor: '#e8e0cf', lintel: '#e8e0cf', winW: 2.4, winH: 1.9, module: 3.6, transom: true,
    doors: [{ side: 'front', u: 0, w: 2.2, h: 2.8, kind: 'double', style: 'glass', label: name }, { side: 'back', u: -12, w: 1.8, h: 2.6, kind: 'double' }],
    signs: [{ text: name.toUpperCase(), y: 8.3, w: 16, h: 1.0, style: { bg: '#7a1f24', fg: '#f4e6c0', font: 'bold 56px Georgia, serif' } }],
    extra(B) {
      B.box('concrete', 0, 3.9, d / 2 + 2, 8, 0.3, 4, '#e2dccf');
      for (const s of [-1, 1]) B.box('brick', s * 3.8, 1.95, d / 2 + 3.8, 0.5, 3.9, 0.5, '#9c5a45', { collide: true });
      B.box('metal', w / 2 - 3, 5, d / 2 + 6, 0.12, 10, 0.12, '#bfc3c7', { collide: true });  // flagpole (plain pennant)
      B.box('fabric', w / 2 - 2.3, 9.2, d / 2 + 6, 1.4, 0.9, 0.02, '#1f4f8a');
    },
  }, M, atlas, seed);
  return out(res, { family: 'school', category: 'public', name, interior: 'school', floors: 2 });
}

export function policeStation(M, atlas, seed, { name = 'Harbor Heights Police Department' } = {}) {
  const w = 30, d = 22;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 4.2, fh: 3.6, wallMat: 'brick', wallColor: '#7c6a5c', trimColor: '#d9d3c8', frame: '#2b2e33', winW: 1.6, module: 3.4,
    doors: [{ side: 'front', u: 0, w: 2.0, h: 2.8, kind: 'double', style: 'glass', label: 'Police' }, { side: 'right', u: -4, locked: true, keyId: 'key_police' }, { side: 'back', u: 6, kind: 'roller', w: 4.5, h: 3.6 }],
    signs: [{ text: 'POLICE', y: 5.4, w: 6, h: 1.0, style: { bg: '#1c2a4a', fg: '#ffffff', accent: '#f2c230' } }],
    extra(B) {
      B.box('concrete', 0, 4.3, d / 2 + 2.2, 9, 0.35, 4.4, '#cfc9be');
      for (const s of [-1, 1]) B.box('concrete', s * 4.2, 2.15, d / 2 + 4.1, 0.45, 4.3, 0.45, '#cfc9be', { collide: true });
      for (const s of [-1, 1]) { B.box('metal', s * 5.2, 1.3, d / 2 + 4.6, 0.12, 2.6, 0.12, '#222'); B.box('light', s * 5.2, 2.7, d / 2 + 4.6, 0.35, 0.35, 0.35, '#5a8cff'); }
    },
  }, M, atlas, seed);
  return out(res, { family: 'police', category: 'public', name, interior: 'police', floors: 2 });
}

export function clinic(M, atlas, seed, { name = 'St. Elena Medical Center' } = {}) {
  const w = 34, d = 22;
  const res = genericBuilding({
    name, w, d, floors: 4, gfh: 4.2, fh: 3.6, wallMat: 'concrete', wallColor: '#eeeae2', trimColor: '#ffffff', frame: '#4a6a8a', glass: '#7fa6c4', winW: 2.2, module: 3.4, allBelts: true,
    doors: [{ side: 'front', u: -6, w: 2.4, h: 2.8, kind: 'double', style: 'glass', label: name }, { side: 'right', u: 4, kind: 'roller', w: 4, h: 3.6 }],
    signs: [{ text: name.toUpperCase(), y: 15.6, w: 18, h: 1.2, style: { bg: '#ffffff', fg: '#1f5f8a', font: 'bold 56px Arial, sans-serif' } }, { text: 'EMERGENCY', side: 'right', u: 4, y: 4.6, w: 5, h: 0.8, style: { bg: '#c8342a', fg: '#fff' } }],
    extra(B) {
      B.box('concrete', -6, 4.4, d / 2 + 3, 10, 0.35, 6, '#e6e2da');                   // drop-off canopy
      for (const s of [-1, 1]) B.box('metal', -6 + s * 4.6, 2.2, d / 2 + 5.7, 0.2, 4.4, 0.2, '#c8ccd0', { collide: true });
      B.box('concrete', w / 2 + 3.5, 4.2, 4, 7, 0.35, 6, '#e6e2da');                  // ambulance bay
    },
  }, M, atlas, seed);
  return out(res, { family: 'clinic', category: 'public', name, interior: 'clinic', floors: 4 });
}

export function fireStation(M, atlas, seed, { name = 'Fire Station 7' } = {}) {
  const w = 24, d = 20;
  const res = genericBuilding({
    name, w, d, floors: 2, gfh: 5.2, fh: 3.4, wallMat: 'brick', wallColor: '#8e3a2e', trimColor: '#e8e0cf', lintel: '#e8e0cf',
    doors: [{ side: 'front', u: -7, kind: 'roller', w: 4.2, h: 4.4 }, { side: 'front', u: -1, kind: 'roller', w: 4.2, h: 4.4 }, { side: 'front', u: 7, w: 1.1, label: name }],
    signs: [{ text: name.toUpperCase(), y: 6.6, w: 10, h: 0.9, style: { bg: '#e8e0cf', fg: '#8e1f1a', font: 'bold 60px Georgia, serif' } }],
    extra(B) { for (const x of [-7, -1]) B.box('paving', x, 0.02, d / 2 + 5, 4.6, 0.04, 10, '#b6b1a8'); },
  }, M, atlas, seed);
  return out(res, { family: 'fire', category: 'public', name, interior: null, floors: 2 });
}

export function cityHall(M, atlas, seed, { name = 'Harbor Heights City Hall' } = {}) {
  const w = 32, d = 22;
  const res = genericBuilding({
    name, w, d, floors: 3, gfh: 5, fh: 4, wallMat: 'stone', wallColor: '#dcd3c2', trimColor: '#efe9dc', frame: '#3a3d42', winW: 1.5, winH: 2.4, module: 3.2, transom: true, allBelts: true,
    doors: [{ side: 'front', u: 0, w: 2.2, h: 3.4, kind: 'double', style: 'glass', label: name }],
    signs: [{ text: 'CITY HALL', y: 14.6, w: 8, h: 0.9, style: { bg: '#dcd3c2', fg: '#2a2f38', font: 'bold 64px Georgia, serif' } }],
    extra(B, { H }) {
      for (let k = 0; k < 5; k++) B.box('stone', 0, 0.12 + k * 0.24, d / 2 + 3.6 - k * 0.5, 16, 0.24, 1.2 + k, '#d2c9b8', { collide: true });
      for (let i = 0; i < 6; i++) B.cyl('stone', -6.25 + i * 2.5, 1.2, d / 2 + 1.8, 0.45, 8.6, '#efe9dc', { seg: 16, collide: true });
      B.box('stone', 0, 10.0, d / 2 + 1.8, 16, 0.6, 2.6, '#e6dfd0');
      // dome drum on the roof
      B.cyl('stone', 0, H + 0.3, 0, 5, 3, '#e6dfd0', { seg: 24 });
      const dome = new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(0, H + 3.3, 0); B.push('metal', dome, '#6d8f7f');
    },
  }, M, atlas, seed);
  return out(res, { family: 'cityhall', category: 'public', name, interior: null, floors: 3 });
}

export function library(M, atlas, seed, { name = 'Harbor Heights Public Library' } = {}) {
  const res = genericBuilding({
    name, w: 24, d: 18, floors: 2, gfh: 4.6, fh: 4, wallMat: 'brick', wallColor: '#b0795d', trimColor: '#efe8d8', lintel: '#efe8d8', winW: 1.6, winH: 2.6, module: 3.2, transom: true,
    doors: [{ side: 'front', u: 0, w: 1.8, h: 2.8, kind: 'double', style: 'wood' }],
    signs: [{ text: 'PUBLIC LIBRARY', y: 9.2, w: 9, h: 0.8, style: { bg: '#efe8d8', fg: '#3a2a1e', font: 'bold 60px Georgia, serif' } }],
  }, M, atlas, seed);
  return out(res, { family: 'library', category: 'public', name, interior: null, floors: 2 });
}

export function communityCentre(M, atlas, seed, { name = 'Harbor Community Centre' } = {}) {
  const res = genericBuilding({
    name, w: 26, d: 16, floors: 1, gfh: 5.5, wallMat: 'stucco', wallColor: '#e8c9a0', trimColor: '#f6efe2', winW: 2.6, winH: 2.4, module: 4, frame: '#3f6a8a',
    doors: [{ side: 'front', u: -5, w: 1.8, h: 2.6, kind: 'double', style: 'glass' }],
    signs: [{ text: 'COMMUNITY CENTRE', y: 5.0, w: 9, h: 0.8, style: { bg: '#3f6a8a', fg: '#fff' } }],
  }, M, atlas, seed);
  return out(res, { family: 'community', category: 'public', name, interior: null, floors: 1 });
}

export function trainStation(M, atlas, seed, { name = 'Harbor Heights Station' } = {}) {
  const w = 30, d = 16;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 7.5, wallMat: 'brick', wallColor: '#9a6a52', trimColor: '#e8e0cf', frame: '#2f3a44', winW: 2.6, winH: 4.2, sillH: 1.4, module: 4.2, transom: true,
    doors: [{ side: 'front', u: 0, w: 2.6, h: 3.2, kind: 'double', style: 'glass', label: name }, { side: 'back', u: 0, w: 2.6, h: 3.2, kind: 'double', style: 'glass' }],
    signs: [{ text: name.toUpperCase(), y: 7.0, w: 14, h: 1.0, style: { bg: '#1f3a2e', fg: '#f4ead0', font: 'bold 56px Georgia, serif' } }],
    extra(B) {
      // platform + canopy behind the hall, running along the rail line (z negative = track side)
      const pz = -d / 2 - 5, L = 90;
      B.box('concrete', 0, 0.55, pz, L, 1.1, 8, '#b9b4ab', { collide: true });
      B.box('paint', 0, 1.11, pz - 3.6, L, 0.02, 0.4, '#f2c230');
      for (let x = -L / 2 + 5; x <= L / 2 - 5; x += 8) B.box('metal', x, 3.6, pz + 1.5, 0.3, 5, 0.3, '#3a4550', { collide: true });
      B.box('metal', 0, 6.2, pz + 0.5, L - 4, 0.25, 7.5, '#4a5560');
      for (let x = -L / 2 + 8; x <= L / 2 - 8; x += 12) { B.box('wood', x, 1.55, pz + 2.6, 2.2, 0.08, 0.5, '#6b4a2e'); B.box('metal', x, 1.35, pz + 2.6, 2.0, 0.4, 0.06, '#333'); }
      B.box('stone', 0, 0.1, d / 2 + 4, 20, 0.2, 8, '#c9c3b8');                           // forecourt
    },
  }, M, atlas, seed);
  return out(res, { family: 'train', category: 'public', name, interior: 'station', floors: 1 });
}

export function busStation(M, atlas, seed, { name = 'Harbor Transit Center' } = {}) {
  const res = genericBuilding({
    name, w: 18, d: 10, floors: 1, gfh: 4.2, wallMat: 'concrete', wallColor: '#d9d6cf', ground: 'storefront', bandColor: '#1f6fb2', cornice: false, parapet: 0.5, bulkhead: false,
    shops: [{ u0: -8.8, u1: 8.8, name: 'HARBOR TRANSIT CENTER', style: { bg: '#1f6fb2', fg: '#fff' } }],
    doors: [{ side: 'front', u: 0, w: 1.8, h: 2.6, kind: 'double', style: 'glass' }],
    extra(B) {
      for (let i = 0; i < 4; i++) {
        const x = -21 + i * 14, z = 14;
        B.box('metal', x, 2.9, z, 10, 0.18, 3.4, '#4a5560');
        B.box('glass', x, 1.5, z - 1.5, 9.6, 2.6, 0.05, '#aabbc8');
        for (const s of [-1, 1]) B.box('metal', x + s * 4.8, 1.45, z - 1.5, 0.1, 2.9, 0.1, '#3a4550', { collide: true });
        B.box('wood', x, 0.5, z - 1.0, 5, 0.08, 0.5, '#6b4a2e');
        B.box('paint', x, 0.02, z + 3.5, 12, 0.02, 0.25, '#f2c230');
      }
    },
  }, M, atlas, seed);
  return out(res, { family: 'bus', category: 'public', name, interior: null, floors: 1 });
}

// ---------------------------------------------------------------- business / industrial
export function officeLowrise(M, atlas, seed, { name = 'Pier Point Offices', floors = 4 } = {}) {
  const r = rng(seed);
  const res = genericBuilding({
    name, w: 28, d: 18, floors, gfh: 4.2, fh: 3.6, wallMat: r.chance(0.5) ? 'concrete' : 'stone', wallColor: r.pick(['#d8d4cc', '#c9c4b8', '#e2ddd2']), frame: '#2b2e33', glass: '#6f8ea8',
    winW: 2.6, winH: 1.9, sillH: 0.8, module: 3.4, allBelts: true, trimColor: '#e8e4dc',
    doors: [{ side: 'front', u: 0, w: 2.2, h: 2.8, kind: 'double', style: 'glass', label: name }],
    signs: [{ text: name.toUpperCase(), y: 4.6, w: 8, h: 0.7, style: { bg: '#2b2e33', fg: '#e8e4dc' } }],
  }, M, atlas, seed);
  return out(res, { family: 'officeLow', category: 'business', name, interior: 'office', floors });
}

export function officeTower(M, atlas, seed, { name = 'Meridian Tower', floors = 18, w = 28, d = 26 } = {}) {
  const r = rng(seed), podiumH = 9, fh = 3.8, H = podiumH + floors * fh, tint = r.pick(['#5d7f9a', '#6a8a86', '#4f6a86', '#7a8c9c']);
  const res = genericBuilding({
    name, w: w + 6, d: d + 6, floors: 1, gfh: podiumH, wallMat: 'stone', wallColor: '#cfc9bd', ground: 'storefront', frame: '#1f2226', glass: '#7f98ab', bandColor: '#1f2226', clearGlass: true, parapet: 0.4, bulkhead: false, cornice: false,
    shops: [{ u0: -(w + 6) / 2 + 0.5, u1: (w + 6) / 2 - 0.5, name: name.toUpperCase(), style: { bg: '#1f2226', fg: '#d8dde2' } }],
    doors: [{ side: 'front', u: -3, w: 2.4, h: 3.2, kind: 'double', style: 'glass', label: name }],
    blankSides: ['left', 'right', 'back'],
    extra(B) {
      // curtain-wall shaft: glass core + mullion/spandrel grid + crown (few triangles)
      const y0 = podiumH + 0.6;
      B.box('glass', 0, y0 + (H - podiumH) / 2, 0, w, H - podiumH, d, tint);
      const sh = (H - podiumH) / 2, sy = y0 + sh;
      B.collider(0, sy, d / 2, w / 2, sh, 0.15); B.collider(0, sy, -d / 2, w / 2, sh, 0.15); B.collider(w / 2, sy, 0, 0.15, sh, d / 2); B.collider(-w / 2, sy, 0, 0.15, sh, d / 2);
      B.collider(0, H + 0.6, 0, w / 2, 0.2, d / 2);
      for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.75) { B.box('frame', x, y0 + (H - podiumH) / 2, d / 2 + 0.03, 0.1, H - podiumH, 0.12, '#2a2e33'); B.box('frame', x, y0 + (H - podiumH) / 2, -d / 2 - 0.03, 0.1, H - podiumH, 0.12, '#2a2e33'); }
      for (let z = -d / 2; z <= d / 2 + 0.01; z += 1.75) { B.box('frame', w / 2 + 0.03, y0 + (H - podiumH) / 2, z, 0.12, H - podiumH, 0.1, '#2a2e33'); B.box('frame', -w / 2 - 0.03, y0 + (H - podiumH) / 2, z, 0.12, H - podiumH, 0.1, '#2a2e33'); }
      for (let f = 0; f <= floors; f++) { const y = y0 + f * fh; B.box('frame', 0, y, 0, w + 0.2, 0.35, d + 0.2, '#343a40'); }
      B.box('concrete', 0, y0 + floors * fh + 2, 0, w - 4, 4, d - 4, '#3a4046');
      B.box('metal', 0, y0 + floors * fh + 5.5, 0, 0.3, 7, 0.3, '#bfc3c7');
    },
  }, M, atlas, seed);
  res.height = H;
  return out(res, { family: 'officeTower', category: 'business', name, interior: 'officeLobby', floors: floors + 1, tw: w, td: d, officeY: podiumH + 0.6 + 3 * fh + 0.175 });
}

export function warehouse(M, atlas, seed, { name = 'Dockside Logistics', w = 40, d = 26 } = {}) {
  const r = rng(seed);
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 9, wallMat: 'metal', wallColor: r.pick(['#9aa3ab', '#b8b09a', '#8f9a8a', '#a8afb6']), roof: 'gable', roofH: 2.2, roofColor: '#7a8088', cornice: false, belts: false, plinthColor: '#8a857c',
    doors: [{ side: 'front', u: -10, kind: 'roller', w: 5, h: 5.5 }, { side: 'front', u: 0, kind: 'roller', w: 5, h: 5.5 }, { side: 'front', u: 10, kind: 'roller', w: 5, h: 5.5 }, { side: 'right', u: 4, locked: true, keyId: 'key_industrial' }],
    winW: 3.5, winH: 1.0, sillH: 7.0, module: 6,
    signs: [{ text: name.toUpperCase(), y: 7.6, w: 12, h: 1.0, style: { bg: '#2b2e33', fg: '#f2c230' } }],
    extra(B) { B.box('concrete', 0, 0.6, d / 2 + 1.5, w - 4, 1.2, 3, '#b4afa6', { collide: true }); for (const x of [-10, 0, 10]) B.box('plastic', x, 1.6, d / 2 + 0.3, 5.4, 0.8, 0.3, '#222'); },
  }, M, atlas, seed);
  return out(res, { family: 'warehouse', category: 'industrial', name, interior: null, floors: 1 });
}

export function factory(M, atlas, seed, { name = 'Keel & Rivet Works' } = {}) {
  const w = 46, d = 30;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 10, wallMat: 'brick', wallColor: '#7a4a38', trimColor: '#c9bfae', cornice: false, parapet: 0.5, bulkhead: false, belts: false,
    doors: [{ side: 'front', u: 12, kind: 'roller', w: 6, h: 6 }, { side: 'front', u: -6, w: 1.1, locked: true, keyId: 'key_industrial' }], winW: 2.8, winH: 4, sillH: 4.5, module: 4.5,
    signs: [{ text: name.toUpperCase(), y: 9, w: 14, h: 1.0, style: { bg: '#c9bfae', fg: '#3a2418', font: 'bold 60px Georgia, serif' } }],
    extra(B) {
      // saw-tooth north-light roof + chimney
      for (let x = -w / 2 + 3; x < w / 2; x += 6) { B.box('metal', x, 11.4, 0, 6, 0.2, d, '#6d7278'); B.box('glass', x + 2.4, 12.6, 0, 0.1, 2.6, d, '#8aa0b4'); }
      B.cyl('brick', -w / 2 + 4, 10.3, -d / 2 + 4, 1.2, 18, '#6e3b2c', { seg: 14, r2: 0.9 });
      for (let i = 0; i < 3; i++) B.cyl('metal', 10 + i * 4, 0, -d / 2 - 3, 1.6, 7, '#b8bdc2', { seg: 16, collide: true });
    },
  }, M, atlas, seed);
  return out(res, { family: 'factory', category: 'industrial', name, interior: null, floors: 1 });
}

export function workshop(M, atlas, seed, { name = "Rusty's Garage" } = {}) {
  const w = 20, d = 16;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 5.5, wallMat: 'metal', wallColor: '#b8b09a', roof: 'gable', roofH: 1.6, roofColor: '#7a8088', cornice: false, belts: false,
    doors: [{ side: 'front', u: -4.5, kind: 'roller', w: 4.2, h: 4 }, { side: 'front', u: 5, w: 1.1, label: name }],
    signs: [{ text: name.toUpperCase(), y: 5.0, w: 8, h: 0.9, style: { bg: '#8a3d1f', fg: '#fff' } }],
  }, M, atlas, seed);
  return out(res, { family: 'workshop', category: 'industrial', name, interior: 'workshop', floors: 1 });
}

export function gym(M, atlas, seed, { name = 'IronWorks Gym' } = {}) {
  const res = genericBuilding({
    name, w: 22, d: 18, floors: 1, gfh: 6, wallMat: 'concrete', wallColor: '#3b3f45', ground: 'storefront', bandColor: '#f2c230', clearGlass: true, cornice: false, parapet: 0.8, bulkhead: false,
    shops: [{ u0: -10.8, u1: 10.8, name: name.toUpperCase(), style: { bg: '#111', fg: '#f2c230' } }],
    doors: [{ side: 'front', u: -6, w: 1.8, h: 2.6, kind: 'double', style: 'glass' }],
  }, M, atlas, seed);
  return out(res, { family: 'gym', category: 'entertainment', name, interior: 'gym', floors: 1 });
}

export function cinema(M, atlas, seed, { name = 'Starline Cinema' } = {}) {
  const w = 30, d = 30;
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 11, wallMat: 'stucco', wallColor: '#7a2f3a', ground: 'storefront', bandColor: '#1a1a1a', blankSides: ['left', 'right', 'back'], cornice: false, parapet: 0.6, bulkhead: false,
    shops: [{ u0: -14, u1: 14, name: name.toUpperCase(), style: { bg: '#1a1a1a', fg: '#f2d060' } }],
    doors: [{ side: 'front', u: -4, w: 2.2, h: 2.8, kind: 'double', style: 'glass' }, { side: 'front', u: 4, w: 2.2, h: 2.8, kind: 'double', style: 'glass' }],
    extra(B, { atlas: A }) {
      B.box('metal', 0, 5.2, d / 2 + 1.8, 22, 1.6, 3.2, '#1a1a1a');
      B.box('light', 0, 4.35, d / 2 + 1.8, 21, 0.1, 3, '#fff3d6');
      if (A) { const rect = A.add('NOW SHOWING', { bg: '#101010', fg: '#f2d060' }); B.quad(A.material, 0, 5.2, d / 2 + 3.42, 10, 1.3, rect, 0); }
    },
  }, M, atlas, seed);
  return out(res, { family: 'cinema', category: 'entertainment', name, interior: null, floors: 1 });
}

// Open-deck parking structure (3 levels), walkable ramps.
export function parkingGarage(M, atlas, seed, { name = 'Pier Street Parking', w = 36, d = 30, levels = 3 } = {}) {
  const r = rng(seed);
  const res = genericBuilding({
    name, w, d, floors: 1, gfh: 0.5, wallMat: 'concrete', wallColor: '#b9b5ad', blankSides: ['front', 'back', 'left', 'right'], cornice: false, parapet: 0, bulkhead: false, belts: false, plinth: false,
    extra(B) {
      const h = 3.2;
      for (let l = 1; l <= levels; l++) {
        const y = l * h;
        B.box('concrete', 0, y, 0, w, 0.3, d, '#a9a59d', { collide: true });
        for (const s of [-1, 1]) { B.box('concrete', 0, y + 0.6, s * (d / 2 - 0.1), w, 0.9, 0.2, '#c2beb6', { collide: true }); B.box('concrete', s * (w / 2 - 0.1), y + 0.6, 0, 0.2, 0.9, d, '#c2beb6', { collide: true }); }
        for (let x = -w / 2 + 5; x < w / 2 - 4; x += 2.7) B.box('paint', x, y + 0.16, -d / 2 + 3, 0.12, 0.01, 5, '#f0f0f0');
      }
      for (let x = -w / 2 + 1; x <= w / 2 - 1; x += 7) for (let z = -d / 2 + 1; z <= d / 2 - 1; z += 7) B.box('concrete', x, (levels * h) / 2, z, 0.6, levels * h, 0.6, '#b9b5ad', { collide: true });
      B.box('paint', 0, 0.02, 0, w - 2, 0.02, 0.2, '#f2c230');
      // ramps (visual + walkable/drivable slope colliders)
      for (let l = 0; l < levels; l++) {
        const len = 14, ang = Math.atan2(h, len), x = w / 2 - 4, z = (l % 2 ? -1 : 1) * 2;
        const g = new THREE.BoxGeometry(5, 0.3, Math.hypot(len, h)); g.rotateX(l % 2 ? ang : -ang); g.translate(x, l * h + h / 2, z); B.push('concrete', g, '#9f9b93');
      }
    },
    signs: [{ text: 'PARKING', y: 2.2, w: 4, h: 0.8, style: { bg: '#1f6fb2', fg: '#fff' } }],
  }, M, atlas, seed);
  return out(res, { family: 'parking', category: 'business', name, interior: null, floors: levels });
}

export function constructionSite(M, atlas, seed, { name = 'Construction Site' } = {}) {
  const res = genericBuilding({
    name, w: 24, d: 18, floors: 1, gfh: 0.4, wallMat: 'concrete', wallColor: '#b9b5ad', blankSides: ['front', 'back', 'left', 'right'], cornice: false, parapet: 0, bulkhead: false, belts: false, plinth: false,
    extra(B) {
      // concrete frame under construction: slabs + columns + scaffold + crane
      for (let l = 1; l <= 3; l++) { B.box('concrete', 0, l * 3.4, 0, 24, 0.3, 18, '#aeaaa2', { collide: true }); }
      for (let x = -11; x <= 11; x += 5.5) for (let z = -8; z <= 8; z += 5.3) B.box('concrete', x, 5.1, z, 0.5, 10.2, 0.5, '#aeaaa2', { collide: true });
      for (let x = -12; x <= 12; x += 2) for (let y = 0; y < 12; y += 2) { B.box('metal', x, y + 1, 9.6, 0.05, 2, 0.05, '#c0c4c8'); if (x < 12) B.box('metal', x + 1, y + 2, 9.6, 2, 0.05, 0.05, '#c0c4c8'); }
      for (let y = 2; y < 12; y += 2) B.box('wood', 0, y, 10.1, 24, 0.06, 0.9, '#8a7a5a');
      B.box('metal', 16, 15, -6, 1.2, 30, 1.2, '#e6b422', { collide: true });
      B.box('metal', 10, 30, -6, 24, 0.9, 0.9, '#e6b422');
      B.box('metal', 22, 29, -6, 3, 2.4, 2.4, '#5a5f66');
      for (let x = -16; x <= 16; x += 2) B.box('metal', x, 1.0, 13, 0.05, 2, 0.05, '#c0c4c8'), B.box('fabric', x + 1, 1.0, 13, 2, 1.8, 0.02, '#3d6a3d');
    },
    signs: [{ text: 'SITE ENTRANCE - HARD HATS REQUIRED', y: 1.9, w: 7, h: 0.6, style: { bg: '#f2c230', fg: '#111' } }],
  }, M, atlas, seed);
  return out(res, { family: 'construction', category: 'industrial', name, interior: null, floors: 3 });
}

export function catalog() {
  return {
    houseS: (M, A, s) => house(M, A, s, { size: 'small' }), houseM: (M, A, s) => house(M, A, s, { size: 'medium' }), houseL: (M, A, s) => house(M, A, s, { size: 'large' }),
    duplex, townhouses: (M, A, s) => townhouseRow(M, A, s), apartments: (M, A, s) => apartmentBlock(M, A, s), walkup, luxury: luxuryResidence,
    mixed: (M, A, s) => mixedUse(M, A, s, { shops: [{ name: 'THREADLINE', style: { bg: '#1c1c1c' }, awning: '#333' }, { name: 'CORNER CAFE', style: { bg: '#5a2f1f' }, awning: '#8a3d22' }] }),
    convenience: convenienceStore, supermarket, bank, hotel, gas: gasStation, mall, dealership,
    school, police: policeStation, clinic, fire: fireStation, cityhall: cityHall, library, community: communityCentre, train: trainStation, bus: busStation,
    officeLow: officeLowrise, officeTower, warehouse, factory, workshop, gym, cinema, parking: parkingGarage, construction: constructionSite,
  };
}
