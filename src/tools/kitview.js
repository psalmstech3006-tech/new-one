// Dev page: renders architecture-kit buildings for visual review.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { cityMaterials, SignAtlas } from '../fw/city/materials.js';
import { genericBuilding } from '../fw/city/archkit.js';
import * as F from '../fw/city/families.js';
import { buildInterior } from '../fw/city/interiors.js';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
r.setSize(1280, 720, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true;
const s = new THREE.Scene();
const sky = new Sky(); sky.scale.setScalar(2000); sky.material.uniforms.sunPosition.value.set(0.6, 0.35, 0.5); s.add(sky);
const pm = new THREE.PMREMGenerator(r); const es = new THREE.Scene(); const sk2 = new Sky(); sk2.scale.setScalar(500); sk2.material.uniforms.sunPosition.value.set(0.6, 0.35, 0.5); es.add(sk2);
s.environment = pm.fromScene(es).texture; s.environmentIntensity = 0.45;
s.add(new THREE.HemisphereLight('#dfe8ff', '#6b5a48', 0.35));
const sun = new THREE.DirectionalLight('#fff0dc', 2.2); sun.position.set(40, 60, 30); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, far: 300 }); s.add(sun);
const M = cityMaterials(), atlas = new SignAtlas();
const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#777' })); g.rotation.x = -Math.PI / 2; g.receiveShadow = true; s.add(g);
const which = new URLSearchParams(location.search).get('set') || 'core';
const list = [];
const add = (res, x, z, ry = 0) => { res.group.position.set(x, 0, z); res.group.rotation.y = ry; s.add(res.group); list.push(res); };
if (which === 'core') {
  add(genericBuilding({ name: 'mix', w: 22, d: 14, floors: 4, gfh: 4.2, wallMat: 'brick', wallColor: '#a4553f', ground: 'storefront', lintel: '#d9d2c3',
    shops: [{ u0: -11, u1: -0.2, name: 'CORNER MARKET', style: { bg: '#1f5a3a' }, awning: '#2f7a4f' }, { u0: 0.2, u1: 11, name: 'BEAN THERE CAFE', style: { bg: '#5a2f1f' }, awning: '#8a3d22' }],
    doors: [{ side: 'front', u: -5, w: 1.8, h: 2.6, kind: 'double' }, { side: 'front', u: 5, w: 1.8, h: 2.6, kind: 'double' }],
    balconies: (f, i) => i % 2 === 1, fireEscape: { side: 'right', u: 0 } }, M, atlas, 3), -20, 0);
  add(genericBuilding({ name: 'house', w: 11, d: 9, floors: 2, gfh: 3.0, fh: 2.9, wallMat: 'siding', wallColor: '#9fb6c8', roof: 'gable', roofColor: '#4a4540', shutters: '#2d3b4a', plinthH: 0.5,
    doors: [{ side: 'front', u: -1.5 }] }, M, atlas, 5), 10, 0);
  add(genericBuilding({ name: 'walkup', w: 12, d: 16, floors: 5, wallMat: 'brick', wallColor: '#6e3b2c', lintel: '#cfc6b4', waterTank: true, fireEscape: { side: 'front', u: 3 }, doors: [{ side: 'front', u: -3.5 }] }, M, atlas, 9), 30, -2);
} else {
  const fams = F.catalog();
  const built = which.split(',').map((k) => { const res = fams[k](M, atlas, 11); const bb = new THREE.Box3().setFromObject(res.group); return { res, bb }; });
  const total = built.reduce((a, b) => a + (b.bb.max.x - b.bb.min.x) + 6, -6);
  let x = -total / 2;
  const q = new URLSearchParams(location.search), cut = q.get('cut');
  for (const { res, bb } of built) {
    add(res, x - bb.min.x, 0);
    const inn = q.get('interior') || cut ? buildInterior(res, M, atlas) : null;
    if (inn) { inn.group.position.copy(res.group.position); s.add(inn.group); res.inner = inn; }
    if (cut) res.group.visible = false;
    x += bb.max.x - bb.min.x + 6;
  }
}
window.stats = () => list.map((l) => `${l.group.name} @${l.group.position.x.toFixed(1)}: ${Math.round(l.tris)} tris, ${l.group.children.length} meshes, ${l.colliders.length} colliders, ${l.doors.length} doors` + (l.inner ? ` | interior ${Math.round(l.inner.tris)} tris, ${l.inner.colliders.length} col, ${l.inner.doors.length} doors, ${l.inner.interactables.length} acts, ${l.inner.lights.length} lights` : '')).join('\n');
const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
window.view = (x, y, z, tx, ty, tz) => { cam.position.set(x, y, z); cam.lookAt(tx, ty, tz); r.render(s, cam); };
view(10, 14, 52, 5, 6, 0);
window.ready = true;
