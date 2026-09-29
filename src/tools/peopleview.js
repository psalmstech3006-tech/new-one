// Dev page: lineup of generated characters (?n=12&seed=1&role=civilian).
import * as THREE from 'three';
import { buildAvatar, randomDNA } from '../fw/people/avatar.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
const q = new URLSearchParams(location.search), n = +(q.get('n') || 12), seed = +(q.get('seed') || 1), role = q.get('role') || 'civilian';
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
r.setSize(1280, 720, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
const s = new THREE.Scene(); s.background = new THREE.Color('#8fa6b8');
s.add(new THREE.HemisphereLight('#eef4ff', '#6b5a48', 1.2));
const sun = new THREE.DirectionalLight('#fff0dc', 2.2); sun.position.set(2, 4, 5); s.add(sun);
const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#8a857c' })); g.rotation.x = -Math.PI / 2; s.add(g);
const dnas = [];
for (let i = 0; i < n; i++) {
  const dna = randomDNA(seed * 1000 + i, { role: i === n - 1 ? 'police' : i === n - 2 ? 'medic' : i === n - 3 ? 'worker' : role });
  const a = buildAvatar(dna), m = SkeletonUtils.clone(a.scene); m.scale.setScalar(a.scale);
  m.position.set((i - (n - 1) / 2) * 0.62, 0, 0); s.add(m); dnas.push(dna);
}
const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
window.view = (x, y, z, tx, ty, tz) => { cam.position.set(x, y, z); cam.lookAt(tx, ty, tz); r.render(s, cam); };
window.stats = () => dnas.map((d) => `${d.frame} ${d.age}y ${d.height}m b${d.build} ${d.hair} ${d.top}/${d.bottom} ${d.acc.join(',')}`).join('\n');
view(0, 1.2, 9, 0, 0.95, 0);
window.ready = true;
