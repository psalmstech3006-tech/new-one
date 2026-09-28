import * as THREE from 'three';
import { mergeGeometries as mergeRaw } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// mergeGeometries needs all-indexed or all-non-indexed input; normalise first.
const mergeGeometries = (list) => mergeRaw(list.map((g) => (g.index ? g.toNonIndexed() : g)));
import { windowEmissive } from './assets.js';

// City layout: a GRID x GRID set of blocks separated by roads.
export const GRID = 9;
export const CELL = 80;
export const ROAD = 16;
export const HALF = (GRID * CELL) / 2;
export const LANE = 4;
export const WORLD_EDGE = HALF + 60;
export const roadCenter = (i) => -HALF + i * CELL; // i = 0..GRID

let seed = 1337;
export const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// --- collision ---------------------------------------------------------
// Static obstacles are axis-aligned boxes in a coarse spatial hash.
const HASH = 20;
const hash = new Map();
export const colliders = [];
function addCollider(minX, minZ, maxX, maxZ, height = 50, kind = 'building') {
  const c = { minX, minZ, maxX, maxZ, height, kind, box: new THREE.Box3(new THREE.Vector3(minX, 0, minZ), new THREE.Vector3(maxX, height, maxZ)) };
  colliders.push(c);
  for (let x = Math.floor(minX / HASH); x <= Math.floor(maxX / HASH); x++)
    for (let z = Math.floor(minZ / HASH); z <= Math.floor(maxZ / HASH); z++) {
      const k = x * 10007 + z;
      if (!hash.has(k)) hash.set(k, []);
      hash.get(k).push(c);
    }
}
export function nearbyColliders(x, z, r) {
  const set = new Set();
  for (let hx = Math.floor((x - r) / HASH); hx <= Math.floor((x + r) / HASH); hx++)
    for (let hz = Math.floor((z - r) / HASH); hz <= Math.floor((z + r) / HASH); hz++) {
      const l = hash.get(hx * 10007 + hz);
      if (l) for (const c of l) set.add(c);
    }
  return set;
}
// Push a circle out of static obstacles. Returns the collision normal or null.
export function resolveCircle(pos, r, y = 0) {
  let normal = null;
  for (const c of nearbyColliders(pos.x, pos.z, r + 1)) {
    if (y > c.height) continue;
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    let dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      let d = Math.sqrt(d2);
      if (d < 1e-4) { // centre inside the box: push out along the shallowest axis
        const opts = [[pos.x - c.minX, -1, 0], [c.maxX - pos.x, 1, 0], [pos.z - c.minZ, 0, -1], [c.maxZ - pos.z, 0, 1]].sort((a, b) => a[0] - b[0]);
        dx = opts[0][1]; dz = opts[0][2]; d = 1;
        pos.x += dx * (opts[0][0] + r); pos.z += dz * (opts[0][0] + r);
      } else {
        dx /= d; dz /= d;
        pos.x = cx + dx * r; pos.z = cz + dz * r;
      }
      normal = { x: dx, z: dz };
    }
  }
  const lim = WORLD_EDGE - 2;
  if (Math.abs(pos.x) > lim) { pos.x = Math.sign(pos.x) * lim; normal = { x: -Math.sign(pos.x), z: 0 }; }
  if (Math.abs(pos.z) > lim) { pos.z = Math.sign(pos.z) * lim; normal = { x: 0, z: -Math.sign(pos.z) }; }
  return normal;
}

// --- layout queries ------------------------------------------------------
export function blockAt(x, z) {
  const bx = Math.floor((x + HALF) / CELL), bz = Math.floor((z + HALF) / CELL);
  if (bx < 0 || bz < 0 || bx >= GRID || bz >= GRID) return null;
  const x0 = roadCenter(bx) + ROAD / 2, z0 = roadCenter(bz) + ROAD / 2;
  const x1 = x0 + CELL - ROAD, z1 = z0 + CELL - ROAD;
  if (x < x0 || x > x1 || z < z0 || z > z1) return null;
  return { bx, bz, x0, z0, x1, z1 };
}
export const groundY = (x, z) => (blockAt(x, z) ? 0.2 : 0);
export const nearestRoadIndex = (v) => Math.max(0, Math.min(GRID, Math.round((v + HALF) / CELL)));
export const isOnRoad = (x, z) => !blockAt(x, z) && Math.abs(x) < HALF + ROAD / 2 && Math.abs(z) < HALF + ROAD / 2;

// Special locations
export const PLACES = {
  hospital: new THREE.Vector3(roadCenter(2) + ROAD / 2 + 2, 0, roadCenter(6) + 8),
  police: new THREE.Vector3(roadCenter(6) + ROAD / 2 + 2, 0, roadCenter(3) + 8),
  garage: new THREE.Vector3(roadCenter(8) - 4, 0, roadCenter(8) + 40),
  home: new THREE.Vector3(roadCenter(4) + 4, 0, roadCenter(4) + 20),
};

// --- building the scene -------------------------------------------------
function boxUV(w, h, d, tile) {
  // BoxGeometry with UVs scaled so textures tile at world scale.
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // faces: +x,-x,+y,-y,+z,-z (4 verts each)
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile);
  }
  return g;
}

export class World {
  constructor(scene, tex, quality) {
    this.scene = scene;
    this.tex = tex;
    this.streetLights = [];
    this.parkedSpots = [];
    this.buildSky();
    this.buildGround();
    this.buildBlocks();
    this.buildProps(quality);
    this.buildLandmarks();
  }

  buildSky() {
    const s = this.scene;
    this.skyUniforms = {
      topColor: { value: new THREE.Color('#3b5b8f') },
      horizonColor: { value: new THREE.Color('#f4a259') },
      sunDir: { value: new THREE.Vector3(0.3, 0.2, -1).normalize() },
      sunColor: { value: new THREE.Color('#ffd28a') },
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          float h = clamp(vDir.y, -0.1, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(max(h,0.0), 0.55));
          float sd = max(dot(vDir, sunDir), 0.0);
          col += sunColor * (pow(sd, 900.0) * 3.0 + pow(sd, 12.0) * 0.35);
          // soft clouds
          vec2 uv = vDir.xz / (vDir.y + 0.25) * 2.0;
          float c = 0.0; float a = 0.5; vec2 q = uv;
          for (int i=0;i<4;i++){ vec2 f = fract(q); vec2 i2 = floor(q); f = f*f*(3.0-2.0*f);
            float n = mix(mix(hash(i2),hash(i2+vec2(1,0)),f.x), mix(hash(i2+vec2(0,1)),hash(i2+vec2(1,1)),f.x), f.y);
            c += n*a; a *= 0.5; q *= 2.1; }
          c = smoothstep(0.55, 0.85, c) * smoothstep(0.0, 0.25, vDir.y);
          col = mix(col, mix(horizonColor*1.1, vec3(1.0), 0.35) + sunColor*pow(sd,4.0)*0.4, c*0.75);
          // stars
          float night = 1.0 - smoothstep(0.0, 0.25, length(topColor));
          col += vec3(step(0.9975, hash(floor(vDir.xz*400.0 + vDir.y*50.0)))) * night * smoothstep(0.1,0.4,vDir.y);
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    sky.renderOrder = -1;
    this.sky = sky;
    s.add(sky);

    this.hemi = new THREE.HemisphereLight('#bcd4ff', '#5a4a3a', 0.8);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffd6a0', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -90; sc.right = sc.top = 90; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    s.add(this.sun, this.sun.target);
    s.fog = new THREE.Fog('#e0a070', 120, 700);
  }

  // time: 0..24 hours
  setTime(hours, center) {
    const t = (hours / 24) * Math.PI * 2 - Math.PI / 2; // 6:00 => sunrise
    const sunDir = new THREE.Vector3(Math.cos(t) * 0.8, Math.sin(t), -0.45).normalize();
    const elev = sunDir.y;
    const day = THREE.MathUtils.smoothstep(elev, -0.15, 0.35);
    const golden = Math.exp(-Math.pow(elev / 0.18, 2)); // strongest near horizon
    const top = new THREE.Color('#0b1024').lerp(new THREE.Color('#3f76c4'), day);
    const hor = new THREE.Color('#141a30').lerp(new THREE.Color('#a9cbe8'), day).lerp(new THREE.Color('#f59a4c'), golden * 0.85);
    this.skyUniforms.topColor.value.copy(top);
    this.skyUniforms.horizonColor.value.copy(hor);
    this.skyUniforms.sunDir.value.copy(sunDir.y > -0.2 ? sunDir : sunDir.clone().negate());
    this.skyUniforms.sunColor.value.set(elev > -0.2 ? '#ffc478' : '#8fa8ff').multiplyScalar(elev > -0.2 ? 1 : 0.25);
    this.scene.fog.color.copy(hor).lerp(top, 0.25);
    this.scene.fog.near = 90 + day * 60;
    this.scene.fog.far = 450 + day * 350;

    const lightDir = elev > 0 ? sunDir : new THREE.Vector3(-sunDir.x, -sunDir.y, sunDir.z); // moon
    this.sun.position.copy(center).addScaledVector(lightDir, 200);
    this.sun.target.position.copy(center);
    this.sun.intensity = elev > 0 ? 0.4 + 2.4 * day : 0.25;
    this.sun.color.set('#ffffff').lerp(new THREE.Color('#ff9c50'), golden).lerp(new THREE.Color('#7f9cff'), elev > 0 ? 0 : 1);
    this.hemi.intensity = 0.25 + 0.75 * day;
    this.hemi.color.copy(top).lerp(new THREE.Color('#ffffff'), 0.5);
    this.sky.position.copy(center);

    const night = 1 - day;
    this.night = night;
    for (const m of this.nightMaterials) m.emissiveIntensity = night * m.userData.nightMax;
  }

  buildGround() {
    const s = this.scene, t = this.tex;
    const size = WORLD_EDGE * 2;
    // road surface covers the whole city
    const asph = t.asphalt.clone(); asph.needsUpdate = true; asph.repeat.set(size / 12, size / 12);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + ROAD, HALF * 2 + ROAD), new THREE.MeshStandardMaterial({ map: asph, roughness: 0.92, color: '#b8b8b8' }));
    asph.repeat.set((HALF * 2 + ROAD) / 10, (HALF * 2 + ROAD) / 10);
    road.rotation.x = -Math.PI / 2; road.receiveShadow = true;
    s.add(road);
    // outskirts grass + beach + ocean
    const grassT = t.grass.clone(); grassT.needsUpdate = true; grassT.repeat.set(size / 8, size / 8);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: grassT, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.12; grass.receiveShadow = true;
    s.add(grass);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(size + 80, size + 80), new THREE.MeshStandardMaterial({ color: '#d8c38e', roughness: 1 }));
    sand.rotation.x = -Math.PI / 2; sand.position.y = -0.3; s.add(sand);
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: '#1f5d7a', roughness: 0.15, metalness: 0.4 }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = -0.5; s.add(this.water);

    // lane markings
    const dashes = [], edges = [];
    for (let i = 0; i <= GRID; i++) {
      const c = roadCenter(i);
      for (let j = 0; j < GRID; j++) {
        const a = roadCenter(j) + ROAD / 2 + 2, b = roadCenter(j + 1) - ROAD / 2 - 2;
        for (let p = a; p < b; p += 6) {
          const len = Math.min(3, b - p);
          const g1 = new THREE.PlaneGeometry(0.25, len); g1.rotateX(-Math.PI / 2); g1.translate(c, 0.02, p + len / 2); dashes.push(g1);
          const g2 = new THREE.PlaneGeometry(len, 0.25); g2.rotateX(-Math.PI / 2); g2.translate(p + len / 2, 0.02, c); dashes.push(g2);
        }
        // solid edge lines
        for (const o of [-ROAD / 2 + 0.6, ROAD / 2 - 0.6]) {
          const e1 = new THREE.PlaneGeometry(0.18, b - a); e1.rotateX(-Math.PI / 2); e1.translate(c + o, 0.02, (a + b) / 2); edges.push(e1);
          const e2 = new THREE.PlaneGeometry(b - a, 0.18); e2.rotateX(-Math.PI / 2); e2.translate((a + b) / 2, 0.02, c + o); edges.push(e2);
        }
        // crosswalk stripes near each intersection
        for (const end of [roadCenter(j) + ROAD / 2 + 0.8, roadCenter(j + 1) - ROAD / 2 - 0.8]) {
          for (let k = -ROAD / 2 + 1.2; k < ROAD / 2 - 1; k += 1.4) {
            const z1 = new THREE.PlaneGeometry(0.7, 1.6); z1.rotateX(-Math.PI / 2); z1.translate(c + k, 0.021, end); edges.push(z1);
            const z2 = new THREE.PlaneGeometry(1.6, 0.7); z2.rotateX(-Math.PI / 2); z2.translate(end, 0.021, c + k); edges.push(z2);
          }
        }
      }
    }
    s.add(new THREE.Mesh(mergeGeometries(dashes), new THREE.MeshStandardMaterial({ color: '#e8c33a', roughness: 0.8 })));
    s.add(new THREE.Mesh(mergeGeometries(edges), new THREE.MeshStandardMaterial({ color: '#e6e6e0', roughness: 0.8 })));
  }

  buildBlocks() {
    const t = this.tex;
    const walkT = t.sidewalk.clone(); walkT.needsUpdate = true;
    const brickEm = windowEmissive('brick'), glassEm = windowEmissive('glass');
    const mats = {
      walk: new THREE.MeshStandardMaterial({ map: walkT, roughness: 0.95 }),
      brick: new THREE.MeshStandardMaterial({ map: t.brick, roughness: 0.85, emissive: '#ffffff', emissiveMap: brickEm, emissiveIntensity: 0 }),
      glass: new THREE.MeshStandardMaterial({ map: t.glass, roughness: 0.25, metalness: 0.35, emissive: '#ffffff', emissiveMap: glassEm, emissiveIntensity: 0 }),
      plaster: new THREE.MeshStandardMaterial({ map: t.brick, color: '#f1dcc0', roughness: 0.9, emissive: '#ffffff', emissiveMap: brickEm, emissiveIntensity: 0 }),
      roof: new THREE.MeshStandardMaterial({ color: '#4a4a4f', roughness: 0.9 }),
      grass: new THREE.MeshStandardMaterial({ map: t.grass, roughness: 1 }),
    };
    mats.brick.userData.nightMax = 1.2; mats.glass.userData.nightMax = 1.0; mats.plaster.userData.nightMax = 1.1;
    this.nightMaterials = [mats.brick, mats.glass, mats.plaster];
    const geo = { walk: [], brick: [], glass: [], plaster: [], roof: [], grass: [] };
    const center = (GRID - 1) / 2;
    this.parks = [];

    for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
      const x0 = roadCenter(bx) + ROAD / 2, z0 = roadCenter(bz) + ROAD / 2, w = CELL - ROAD;
      const cx = x0 + w / 2, cz = z0 + w / 2;
      const g = boxUV(w, 0.2, w, 4); g.translate(cx, 0.1, cz); geo.walk.push(g);
      const distC = Math.hypot(bx - center, bz - center);
      const isPark = (bx === 2 && bz === 6) ? false : rand() < 0.1 && distC > 1.5;
      if (isPark) {
        const gp = boxUV(w - 8, 0.05, w - 8, 6); gp.translate(cx, 0.23, cz); geo.grass.push(gp);
        this.parks.push({ cx, cz, w: w - 8 });
        continue;
      }
      // downtown towers in the centre, low-rise brick towards the edges
      const downtown = distC < 2.2;
      const splits = downtown ? (rand() < 0.5 ? 1 : 2) : (rand() < 0.3 ? 2 : 3);
      const inner = w - 6, cell = inner / splits;
      for (let i = 0; i < splits; i++) for (let j = 0; j < splits; j++) {
        if (!downtown && rand() < 0.12) continue; // empty lot / parking
        const bw = cell - 2 - rand() * 3, bd = cell - 2 - rand() * 3;
        const px = x0 + 3 + cell * (i + 0.5), pz = z0 + 3 + cell * (j + 0.5);
        let h, kind;
        if (downtown) { h = 40 + rand() * 90 * (1 - distC / 3); kind = 'glass'; }
        else { h = 8 + Math.floor(rand() * 5) * 4; kind = rand() < 0.6 ? 'brick' : 'plaster'; }
        const tile = kind === 'glass' ? 10 : 8;
        const bg = boxUV(bw, h, bd, tile); bg.translate(px, h / 2 + 0.2, pz);
        // remove the roof from the facade mesh by giving the roof its own cap
        geo[kind].push(bg);
        const rg = new THREE.BoxGeometry(bw + 0.6, 0.6, bd + 0.6); rg.translate(px, h + 0.5, pz); geo.roof.push(rg);
        if (kind === 'glass' && rand() < 0.6) { // setback crown
          const ch = 6 + rand() * 12;
          const cg = boxUV(bw * 0.6, ch, bd * 0.6, tile); cg.translate(px, h + ch / 2 + 0.8, pz); geo.glass.push(cg);
        }
        addCollider(px - bw / 2, pz - bd / 2, px + bw / 2, pz + bd / 2, h + 0.2);
      }
    }
    for (const k of Object.keys(geo)) {
      if (!geo[k].length) continue;
      const m = new THREE.Mesh(mergeGeometries(geo[k]), mats[k]);
      m.castShadow = k !== 'walk' && k !== 'grass';
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  buildProps(quality) {
    const s = this.scene;
    // Streetlights at block corners
    const poleG = [], lampG = [];
    const trunkG = [], leafG = [];
    for (let bx = 0; bx < GRID; bx++) for (let bz = 0; bz < GRID; bz++) {
      const x0 = roadCenter(bx) + ROAD / 2, z0 = roadCenter(bz) + ROAD / 2, w = CELL - ROAD;
      for (const [px, pz] of [[x0 + 1, z0 + w / 2], [x0 + w - 1, z0 + w / 2], [x0 + w / 2, z0 + 1], [x0 + w / 2, z0 + w - 1]]) {
        const p = new THREE.CylinderGeometry(0.12, 0.16, 7, 6); p.translate(px, 3.7, pz); poleG.push(p);
        const dirX = px === x0 + 1 ? -1 : px === x0 + w - 1 ? 1 : 0, dirZ = pz === z0 + 1 ? -1 : pz === z0 + w - 1 ? 1 : 0;
        const arm = new THREE.BoxGeometry(dirX ? 2 : 0.15, 0.15, dirZ ? 2 : 0.15); arm.translate(px + dirX, 7.1, pz + dirZ); poleG.push(arm);
        const l = new THREE.BoxGeometry(0.8, 0.2, 0.8); l.translate(px + dirX * 2, 7.0, pz + dirZ * 2); lampG.push(l);
        this.streetLights.push(new THREE.Vector3(px + dirX * 2, 6.8, pz + dirZ * 2));
        addCollider(px - 0.2, pz - 0.2, px + 0.2, pz + 0.2, 7, 'pole');
      }
      // trees along the sidewalk
      for (let k = 0; k < 4; k++) {
        if (rand() < 0.45) continue;
        const along = 10 + rand() * (w - 20);
        const side = k;
        const px = side === 0 ? x0 + 1.5 : side === 1 ? x0 + w - 1.5 : x0 + along;
        const pz = side === 2 ? z0 + 1.5 : side === 3 ? z0 + w - 1.5 : z0 + along;
        this.addTree(px, pz, trunkG, leafG);
      }
    }
    for (const p of this.parks) for (let i = 0; i < 10; i++) this.addTree(p.cx + (rand() - 0.5) * p.w * 0.9, p.cz + (rand() - 0.5) * p.w * 0.9, trunkG, leafG);
    // palm-ish trees along the coast road
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2, r = HALF + 22;
      this.addTree(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02, trunkG, leafG, true);
    }
    const poles = new THREE.Mesh(mergeGeometries(poleG), new THREE.MeshStandardMaterial({ color: '#3b3f44', metalness: 0.6, roughness: 0.5 }));
    poles.castShadow = true; s.add(poles);
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff4d0', emissive: '#ffd27a', emissiveIntensity: 0 });
    this.lampMat.userData.nightMax = 3;
    this.nightMaterials.push(this.lampMat);
    s.add(new THREE.Mesh(mergeGeometries(lampG), this.lampMat));
    const trunks = new THREE.Mesh(mergeGeometries(trunkG), new THREE.MeshStandardMaterial({ color: '#5b4030', roughness: 1 }));
    const leaves = new THREE.Mesh(mergeGeometries(leafG), new THREE.MeshStandardMaterial({ color: '#3f7a2c', roughness: 0.9, flatShading: true }));
    trunks.castShadow = leaves.castShadow = true;
    s.add(trunks, leaves);

    // A handful of real point lights that follow the player (see updateLights)
    this.dynLights = [];
    const n = quality === 'low' ? 0 : 6;
    for (let i = 0; i < n; i++) { const l = new THREE.PointLight('#ffcf85', 0, 22, 1.6); s.add(l); this.dynLights.push(l); }

    // chain-link fences around a few lots
    const fenceTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
      g.strokeStyle = '#b8bcc0'; g.lineWidth = 2;
      for (let i = -64; i < 128; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    })();
    this.fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 });
  }

  addTree(x, z, trunkG, leafG, palm = false) {
    const h = palm ? 9 + rand() * 3 : 3.5 + rand() * 2;
    const t = new THREE.CylinderGeometry(0.15, 0.25, h, 6); t.translate(x, h / 2 + 0.2, z); trunkG.push(t);
    if (palm) {
      for (let k = 0; k < 6; k++) {
        const f = new THREE.BoxGeometry(0.5, 0.1, 3.2); f.translate(0, 0, 1.6); f.rotateX(0.35); f.rotateY((k / 6) * Math.PI * 2); f.translate(x, h + 0.2, z); leafG.push(f);
      }
    } else {
      const r = 1.6 + rand() * 1.2;
      const l = new THREE.IcosahedronGeometry(r, 0); l.translate(x, h + r * 0.6, z); leafG.push(l);
      const l2 = new THREE.IcosahedronGeometry(r * 0.7, 0); l2.translate(x + r * 0.4, h + r * 1.2, z - r * 0.2); leafG.push(l2);
    }
    addCollider(x - 0.3, z - 0.3, x + 0.3, z + 0.3, h, 'tree');
  }

  buildLandmarks() {
    const s = this.scene;
    const sign = (text, color, pos, rotY = 0) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, 512, 128); g.fillStyle = '#fff'; g.font = 'bold 64px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), emissive: '#ffffff', emissiveIntensity: 0.25, emissiveMap: new THREE.CanvasTexture(c) }));
      m.position.copy(pos); m.rotation.y = rotY; s.add(m);
    };
    sign('ST. ELENA MEDICAL', '#2f7a4f', PLACES.hospital.clone().add(new THREE.Vector3(0, 5, 0)), Math.PI / 2);
    sign('SUNDOWN PD', '#1f3d7a', PLACES.police.clone().add(new THREE.Vector3(0, 5, 0)), Math.PI / 2);
    sign('RUSTY\'S GARAGE', '#8a3d1f', PLACES.garage.clone().add(new THREE.Vector3(0, 5, 6)), Math.PI);

    // Fenced lot next to the garage, like a chop shop yard
    const g = PLACES.garage;
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(20, 3), this.fenceMat);
    fence.material.map.repeat.set(10, 1.5);
    fence.position.set(g.x + 10, 1.7, g.z + 8); s.add(fence);
  }

  updateLights(center) {
    if (!this.dynLights.length) return;
    const near = this.streetLights.map((p) => [p, p.distanceToSquared(center)]).sort((a, b) => a[1] - b[1]);
    const intensity = this.night * 40;
    this.dynLights.forEach((l, i) => { l.position.copy(near[i][0]); l.intensity = intensity; });
  }

  update(t) {
    this.water.material.color.setHSL(0.55, 0.55, 0.22 + Math.sin(t * 0.5) * 0.01);
  }
}
