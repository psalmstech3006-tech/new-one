import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R, L, groups, ALL } from '../physics.js';
import { PropWorld } from '../testmap.js';
import { cityMaterials, SignAtlas } from './materials.js';
import { GeoBuilder, rng } from './geom.js';
import * as F from './families.js';

// ============================================================================
// District 1 — "Harbor Heights" (docs/CITY_SPEC.md §4).
// A planned 3x3 grid of blocks (100 x 80 m lots) with 12 m streets and 4 m sidewalks, an
// industrial fringe east of Harbor Blvd and a rail corridor along the south edge.
// Buildings come from the modular families; exteriors are merged into a few chunk meshes
// per material, colliders go into one compound body per building.
// ============================================================================

export const LOT_Y = 0.15;
const ROAD = 6, WALK = 4;
export const STREETS_NS = [{ name: 'ELM AVE', x: -180 }, { name: 'OAK ST', x: -60 }, { name: 'MARKET ST', x: 60 }, { name: 'HARBOR BLVD', x: 180 }];
export const STREETS_EW = [{ name: '1ST ST', z: -160 }, { name: '2ND ST', z: -60 }, { name: '3RD ST', z: 40 }];
const COLS = [[-170, -70], [-50, 50], [70, 170]];
const ROWS = [[-150, -70], [-50, 30], [50, 130]];
const SOUTH = 134;          // south sidewalk edge / rail fence
const EAST = 330;           // end of the industrial fringe
const RAIL_Z = [138, 142.5];

export class District extends PropWorld {
  constructor(game, tex, { models = {}, props = {} } = {}) {
    super(game, tex);
    this.CM = cityMaterials();
    this.atlas = new SignAtlas({ cols: 8, rows: 32, slotW: 256, slotH: 64 });
    this.buildings = [];
    this.ilamps = [];
    this.noTree = [];
    this.spawns = { player: new THREE.Vector3(-38, LOT_Y + 0.05, -52.6), playerFacing: 0, cars: [], peds: [] };
    this.pedRings = [];
    this.chunks = new Map();
    const t0 = performance.now();
    this.ground();
    this.roads();
    this.blocks();
    this.buildAll();
    this.rail();
    this.parks();
    this.streetFurniture(props);
    this.mergeChunks();
    this.stats = { buildMs: performance.now() - t0 };
  }

  // ------------------------------------------------------------ helpers
  staticBody(list, x = 0, y = 0, z = 0, rotY = 0) { return this.game.physics.staticCompound(list, x, y, z, rotY); }
  // Collect a built group's meshes into world-space chunk buckets (merged later).
  addToChunks(group) {
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (!o.isMesh) return;
      const wp = new THREE.Vector3(); o.geometry.computeBoundingSphere(); wp.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const key = `${Math.floor((wp.x + 200) / 120)}:${Math.floor((wp.z + 180) / 105)}`;
      if (!this.chunks.has(key)) this.chunks.set(key, new Map());
      const b = this.chunks.get(key);
      if (!b.has(o.material)) b.set(o.material, []);
      b.get(o.material).push(o.geometry.clone().applyMatrix4(o.matrixWorld));
      o.geometry.dispose();
    });
  }
  mergeChunks() {
    const C = this.CM, FLAT = new Set([C.asphalt, C.paving, C.paint, C.grass, C.carpet, C.tile, C.frame, C.trim, C.glass, C.glassLit, C.plastic, C.chrome, C.light, C.screen, C.fabric, this.atlas.material]);
    let calls = 0, tris = 0;
    this.chunkMeshes = [];
    for (const [key, byMat] of this.chunks) for (const [mat, geos] of byMat) {
      const g = mergeGeometries(geos, false); geos.forEach((q) => q.dispose());
      if (!g) continue;
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.name = `chunk ${key}`;
      m.castShadow = !mat.transparent && !FLAT.has(mat); m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.game.scene.add(m); this.chunkMeshes.push(m);
      calls++; tris += g.attributes.position.count / 3;
    }
    this.chunks.clear();
    this.drawCalls = calls; this.tris = tris;
  }

  // ------------------------------------------------------------ ground + roads
  ground() {
    const { scene, physics } = this.game, M = this.M;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), M.grass.clone());
    grass.material.map = M.grass.map.clone(); grass.material.map.repeat.set(480, 480); grass.material.map.needsUpdate = true;
    grass.rotation.x = -Math.PI / 2; grass.position.y = -0.03; grass.receiveShadow = true; scene.add(grass);
    physics.staticBox(0, -0.5, 0, 1200, 0.5, 1200, 0, 1.0);
    // asphalt base under the whole street grid and the industrial yard
    const B = new GeoBuilder(this.CM);
    B.plane('asphalt', (-190 + EAST) / 2, 0, (-170 + 136) / 2, EAST + 190, 306, '#5a5a5c', { tile: 8 });
    this.addToChunks(B.build('asphalt'));
  }

  roads() {
    const B = new GeoBuilder(this.CM), P = (x, z, w, d, c = '#f2f0e8') => B.box('paint', x, 0.006, z, w, 0.012, d, c);
    const zN = -166, zS = SOUTH, xW = -186;
    const nsIntersections = (x) => STREETS_EW.map((s) => s.z);
    // N-S streets: double yellow centre line, parking-lane lines, broken at intersections
    for (const s of STREETS_NS) {
      const stops = [zN, ...STREETS_EW.map((e) => e.z), zS].sort((a, b) => a - b);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i] + (i === 0 ? 0 : ROAD + 4), b = stops[i + 1] - (i + 1 === stops.length - 1 ? 0 : ROAD + 4);
        if (b - a < 1) continue;
        P(s.x - 0.12, (a + b) / 2, 0.12, b - a, '#e0b528'); P(s.x + 0.12, (a + b) / 2, 0.12, b - a, '#e0b528');
        for (const sg of [-1, 1]) P(s.x + sg * 3.7, (a + b) / 2, 0.12, b - a);
        // stop lines at the approach ends
        if (i > 0) P(s.x + 1.9, a - 0.3 + 0.3, 3.6, 0.4); if (i + 1 < stops.length - 1) P(s.x - 1.9, b, 3.6, 0.4);
      }
    }
    for (const s of STREETS_EW) {
      const stops = [xW, ...STREETS_NS.map((e) => e.x), EAST].sort((a, b) => a - b);
      for (let i = 0; i < stops.length - 1; i++) {
        const a = stops[i] + (i === 0 ? 0 : ROAD + 4), b = stops[i + 1] - (i + 1 === stops.length - 1 ? 0 : ROAD + 4);
        if (b - a < 1) continue;
        P((a + b) / 2, s.z - 0.12, b - a, 0.12, '#e0b528'); P((a + b) / 2, s.z + 0.12, b - a, 0.12, '#e0b528');
        for (const sg of [-1, 1]) P((a + b) / 2, s.z + sg * 3.7, b - a, 0.12);
        if (i > 0) P(a, s.z - 1.9, 0.4, 3.6); if (i + 1 < stops.length - 1) P(b, s.z + 1.9, 0.4, 3.6);
      }
    }
    // zebra crossings on every approach of every intersection
    this.intersections = [];
    for (const a of STREETS_NS) for (const e of STREETS_EW) {
      this.intersections.push({ x: a.x, z: e.z, ns: a.name, ew: e.name });
      for (const sg of [-1, 1]) {
        for (let k = -5; k <= 5; k += 1.1) { P(a.x + k, e.z + sg * (ROAD + 2), 0.55, 3); P(a.x + sg * (ROAD + 2), e.z + k, 3, 0.55); }
      }
    }
    this.addToChunks(B.build('markings'));
  }

  // raised blocks: sidewalk ring (paving) around each lot, kerb edge = slab edge
  blocks() {
    const B = new GeoBuilder(this.CM), cols = [];
    const slab = (x0, x1, z0, z1) => {
      B.box('paving', (x0 + x1) / 2, LOT_Y / 2, (z0 + z1) / 2, x1 - x0, LOT_Y, z1 - z0, '#c9c4ba', { tile: 2 });
      cols.push({ cx: (x0 + x1) / 2, cy: LOT_Y / 2, cz: (z0 + z1) / 2, hx: (x1 - x0) / 2, hy: LOT_Y / 2, hz: (z1 - z0) / 2 });
      B.box('concrete', (x0 + x1) / 2, LOT_Y / 2, z0 + 0.1, x1 - x0, LOT_Y + 0.01, 0.2, '#b5b0a6'); B.box('concrete', (x0 + x1) / 2, LOT_Y / 2, z1 - 0.1, x1 - x0, LOT_Y + 0.01, 0.2, '#b5b0a6');
      B.box('concrete', x0 + 0.1, LOT_Y / 2, (z0 + z1) / 2, 0.2, LOT_Y + 0.01, z1 - z0, '#b5b0a6'); B.box('concrete', x1 - 0.1, LOT_Y / 2, (z0 + z1) / 2, 0.2, LOT_Y + 0.01, z1 - z0, '#b5b0a6');
    };
    this.lots = [];
    for (const [x0, x1] of COLS) for (const [z0, z1] of ROWS) {
      slab(x0 - WALK, x1 + WALK, z0 - WALK, z1 + (z1 === 130 ? WALK : WALK));
      this.lots.push({ x0, x1, z0, z1 });
      // pedestrian loop on the sidewalk centre line
      const i = 1.7;
      this.pedRings.push([[x0 - i, z0 - i], [x1 + i, z0 - i], [x1 + i, z1 + i], [x0 - i, z1 + i]]);
    }
    // sidewalk on the east side of Harbor Blvd (with driveway gaps into the yard)
    const gaps = [-118, -58, 2, 62, 112];
    let z = -154;
    for (const g of [...gaps, SOUTH + 6]) { if (g - 6 - z > 1) slab(186, 190, z, g - 6); z = g + 6; }
    this.pedRings.push([[188, -150], [188, 130], [188, -150], [188, 130]]);
    this.addToChunks(B.build('blocks'));
    this.staticBody(cols);
    // lot surfaces (grass/paving/parking) are laid by the zone builders
    this.surf = new GeoBuilder(this.CM);
  }

  surface(mat, x0, x1, z0, z1, color, y = LOT_Y) { this.surf.box(mat, (x0 + x1) / 2, y + 0.006, (z0 + z1) / 2, x1 - x0, 0.012, z1 - z0, color, { tile: mat === 'grass' ? 3 : 4 }); }
  paint(x, z, w, d, color = '#f2f0e8', y = LOT_Y) { this.surf.box('paint', x, y + 0.016, z, w, 0.006, d, color); }
  parkingBays(x0, x1, z, n, dir = 1, color = '#f2f0e8', y = LOT_Y) {
    const step = (x1 - x0) / n;
    for (let i = 0; i <= n; i++) this.paint(x0 + i * step, z + dir * 2.6, 0.12, 5.2, color, y);
    this.paint((x0 + x1) / 2, z, x1 - x0, 0.12, color, y);
  }

  // ------------------------------------------------------------ buildings
  toWorld(b, [lx, ly, lz]) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return new THREE.Vector3(b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c); }
  place(res, x, z, rot = 0, y = LOT_Y) {
    const g = res.group; g.position.set(x, y, z); g.rotation.y = rot;
    const rec = { res, meta: res.meta, x, y, z, rot, footprint: res.footprint, id: this.buildings.length, doors: res.doors, center: new THREE.Vector3(x, y, z) };
    rec.body = this.staticBody(res.colliders, x, y, z, rot);
    this.addToChunks(g);
    this.buildings.push(rec);
    return rec;
  }

  buildAll() {
    const CM = this.CM, A = this.atlas;
    let seed = 100;
    const S = () => seed++;
    // ---- NW: suburban houses facing 1st St (north) and 2nd St (south)
    {
      const [x0, x1] = COLS[0], [z0, z1] = ROWS[0];
      const south = ['houseM', 'houseS', 'duplex', 'houseL', 'houseS', 'houseM'];
      const north = ['houseS', 'houseM', 'houseS', 'duplex', 'houseM', 'houseS'];
      const cat = F.catalog();
      const row = (list, facingSouth) => {
        let x = x0 + 2;
        list.forEach((k, i) => {
          const name = facingSouth && i === 0 ? 'Home' : k === 'duplex' ? 'Duplex' : `House ${Math.abs(Math.round(x))}`;
          const res = k.startsWith('house') ? F.house(CM, A, S(), { size: { houseS: 'small', houseM: 'medium', houseL: 'large' }[k], name }) : F.duplex(CM, A, S(), { name });
          const [w, d] = res.footprint, ext = k === 'houseS' || k === 'duplex' ? 0 : 5.2;
          const cx = x + w / 2 + 0.5, cz = facingSouth ? z1 - d / 2 - 7.8 : z0 + d / 2 + 7.8;
          const rec = this.place(res, cx, cz, facingSouth ? 0 : Math.PI);
          if (name === 'Home') this.home = rec;
          // front yard + back garden lawns
          const lx0 = x, lx1 = x + w + ext + 2;
          this.surface('grass', lx0, lx1, facingSouth ? cz - d / 2 - 8 : cz + d / 2 - 0.2, facingSouth ? z1 : cz - d / 2 + 0.2 + 0, '#5d8a42');
          this.surface('grass', lx0, lx1, facingSouth ? (z0 + z1) / 2 + 0.5 : z0, facingSouth ? cz - d / 2 : (z0 + z1) / 2 - 0.5, '#5d8a42');
          this.trees.push([x + 1.5, facingSouth ? cz - d / 2 - 4 : cz + d / 2 + 4, 0.9 + Math.random() * 0.4]);
          x = lx1 + 1;
        });
      };
      this.trees = [];
      row(south, true); row(north, false);
    }
    // ---- N-centre: townhouses on 1st St, apartments + corner shop on 2nd St
    {
      const [, z1] = ROWS[0], z0 = ROWS[0][0];
      for (const [i, x] of [-36, -8, 20].entries()) this.place(F.townhouseRow(CM, A, S(), { name: `Hillcrest Row ${i + 1}` }), x, z0 + 5.5 + 3, Math.PI);
      this.place(F.walkup(CM, A, S(), { name: '1st St Walk-up' }), 42, z0 + 9 + 1, Math.PI);
      this.place(F.apartmentBlock(CM, A, S(), { name: 'Harbor View Apartments', floors: 5 }), -34, z1 - 8 - 2.5, 0);
      this.place(F.apartmentBlock(CM, A, S(), { name: 'Oakwood Court', floors: 4, enterable: false }), 2, z1 - 8 - 2.5, 0);
      this.place(F.convenienceStore(CM, A, S(), { name: 'QuikStop 24/7' }), 40, z1 - 6 - 0.5, 0);
      this.surface('paving', -50, 50, z0 + 20, z1 - 21, '#b9b3a8');
      this.surface('asphalt', 24, 50, z1 - 36, z1 - 13, '#4a4a4c'); this.parkingBays(26, 48, z1 - 24.5, 8, 1);
      this.spawns.cars.push(['coupe', new THREE.Vector3(30, LOT_Y, z1 - 21.5), 0, '#8e1b1b']);
    }
    // ---- NE: school campus with football pitch + basketball court
    {
      const [x0, x1] = COLS[2], [z0, z1] = ROWS[0];
      this.school = this.place(F.school(CM, A, S()), 110, z1 - 9 - 6, 0);
      this.surface('paving', x0, x1, z1 - 28, z1, '#c2bcb1');
      this.sportsPitch(128, -123, 58, 36, true);
      this.court(80, -123, Math.PI / 2);
    }
    // ---- W-middle: Harbor Park with library + community centre
    {
      const [x0, x1] = COLS[0], [z0, z1] = ROWS[1];
      this.surface('grass', x0, x1, z0, z1, '#5f8c45');
      this.place(F.library(CM, A, S()), -150, z0 + 9 + 1.5, Math.PI);
      this.place(F.communityCentre(CM, A, S()), -150, z1 - 8 - 3, 0);
      this.sportsPitch(-100, -9, 48, 30, false);
      this.court(-150, -12, 0);
      this.parkPaths(x0, x1, z0, z1);
    }
    // ---- centre: Main Street commercial (shops face 2nd St; hotel/cinema face 3rd St)
    {
      const [z0, z1] = ROWS[1];
      const shops = [
        [{ name: 'BEAN THERE CAFE', style: { bg: '#5a2f1f' }, awning: '#8a3d22' }, { name: 'THREADLINE', style: { bg: '#1c1c1c' }, awning: '#333' }],
        [{ name: 'HARBOR PHARMACY', style: { bg: '#2f7a4f', accent: '#ffffff' }, awning: '#2f7a4f' }, { name: 'VOLT MOBILE', style: { bg: '#0f2438', fg: '#5fd1ff' } }],
        [{ name: 'MAIN ST DINER', style: { bg: '#8a1f1f', fg: '#ffe9b0' }, awning: '#c8342a' }, { name: 'LOOM & LACE', style: { bg: '#5a3a6a' }, awning: '#5a3a6a' }],
      ];
      shops.forEach((sh, i) => this.place(F.mixedUse(CM, A, S(), { shops: sh, name: `Main St ${100 + i * 20}`, floors: 3 + (i % 2) }), -38 + i * 24, z0 + 8 + 0.5, Math.PI));
      this.place(F.bank(CM, A, S()), 37, z0 + 9 + 5.5, Math.PI);
      this.place(F.hotel(CM, A, S(), { floors: 8 }), -30, z1 - 9 - 6.5, 0);
      this.place(F.mixedUse(CM, A, S(), { name: 'Main St 150', shops: [{ name: 'HARBOR GRILL', style: { bg: '#3a2418' }, awning: '#6b3a22' }, { name: 'CORNER MARKET', style: { bg: '#1f5a3a' } }, { name: 'PAGE TURNERS', style: { bg: '#2f3a5a' } }], w: 24 }), 2, z1 - 8 - 0.5, 0);
      this.place(F.cinema(CM, A, S()), 34, z1 - 15 - 3.8, 0);
      // rear service lot
      this.surface('asphalt', -50, 18, z0 + 17, z1 - 26, '#4a4a4c'); this.parkingBays(-46, -6, z0 + 22, 14, 1);
      this.spawns.cars.push(['sedan', new THREE.Vector3(-30, LOT_Y, z0 + 24.5), Math.PI, '#1f3f66'], ['suv', new THREE.Vector3(-18, LOT_Y, z0 + 24.5), Math.PI, '#2b2b2b']);
    }
    // ---- E-middle: civic centre
    {
      const [x0] = COLS[2], [z0, z1] = ROWS[1];
      this.police = this.place(F.policeStation(CM, A, S()), x0 + 11 + 5, -30, -Math.PI / 2);
      this.clinic = this.place(F.clinic(CM, A, S()), 140, z0 + 11 + 6.2, Math.PI);
      this.place(F.fireStation(CM, A, S()), 152, z1 - 10 - 10.2, 0);
      this.place(F.cityHall(CM, A, S()), 110, z1 - 11 - 5.6, 0);
      this.surface('paving', x0, 170, z0, z1, '#cfc9be');
      this.spawns.cars.push(['patrol', new THREE.Vector3(x0 + 3.5, LOT_Y, -22), Math.PI, null], ['patrol', new THREE.Vector3(x0 + 3.5, LOT_Y, -38), Math.PI, null]);
    }
    // ---- SW: mall + surface parking + gas station
    {
      const [x0, x1] = COLS[0], [z0, z1] = ROWS[2];
      this.mall = this.place(F.mall(CM, A, S()), -126, z1 - 22 - 2, Math.PI);
      this.surface('asphalt', x0, -94, z0, z1 - 46, '#4a4a4c');
      for (const z of [z0 + 4, z0 + 17, z0 + 28]) this.parkingBays(x0 + 4, -98, z, 26, z === z0 + 4 ? 1 : z === z0 + 17 ? -1 : 1);
      this.parkingBays(x0 + 4, -98, z0 + 17, 26, 1);
      this.gas = this.place(F.gasStation(CM, A, S()), -81, z0 + 38, Math.PI);
      this.surface('concrete', -94, x1, z0, z1, '#b8b3aa');
      this.spawns.cars.push(['coupe', new THREE.Vector3(-140, LOT_Y, z0 + 20), 0, '#c7c2b3'], ['sedan', new THREE.Vector3(-128.5, LOT_Y, z0 + 14), Math.PI, '#6b6f75'], ['suv', new THREE.Vector3(-110, LOT_Y, z0 + 31), 0, '#314a2e']);
    }
    // ---- S-centre: offices + parking structure + dealership
    {
      const [z0, z1] = ROWS[2];
      this.tower = this.place(F.officeTower(CM, A, S(), { floors: 16 }), -25, z0 + 16 + 1, Math.PI);
      this.office = this.place(F.officeLowrise(CM, A, S()), 25, z0 + 9 + 1.5, Math.PI);
      this.place(F.parkingGarage(CM, A, S()), 25, z1 - 15 - 5, 0);
      this.place(F.dealership(CM, A, S()), -37, z1 - 18, -Math.PI / 2);
      this.surface('paving', -50, 50, z0, z1, '#c9c4ba');
    }
    // ---- SE: transit — train station (platform on the rail side) + bus station
    {
      const [x0, x1] = COLS[2], [z0] = ROWS[2];
      this.station = this.place(F.trainStation(CM, A, S()), 120, SOUTH - 17 - 1, Math.PI);
      this.place(F.busStation(CM, A, S()), 120, z0 + 5 + 3, 0);
      this.surface('asphalt', x0, x1, z0 + 14, z0 + 34, '#4a4a4c');
      this.surface('paving', x0, x1, z0 + 34, SOUTH - 4, '#cbc5ba');
    }
    // ---- East fringe: industrial yard facing Harbor Blvd
    {
      this.place(F.warehouse(CM, A, S()), 190 + 13 + 4, -120, -Math.PI / 2, 0);
      this.place(F.factory(CM, A, S()), 190 + 15 + 3, -58, -Math.PI / 2, 0);
      this.workshop = this.place(F.workshop(CM, A, S()), 190 + 8 + 4, 2, -Math.PI / 2, 0);
      this.gym = this.place(F.gym(CM, A, S()), 190 + 9 + 4, 32, -Math.PI / 2, 0);
      this.place(F.constructionSite(CM, A, S()), 190 + 9 + 6, 76, -Math.PI / 2, 0);
      this.place(F.warehouse(CM, A, S(), { name: 'Pier 9 Cold Storage', w: 44, d: 28 }), 290, -110, -Math.PI / 2, 0);
      this.place(F.warehouse(CM, A, S(), { name: 'Tidewater Freight', w: 36, d: 24 }), 290, -40, -Math.PI / 2, 0);
      this.spawns.cars.push(['suv', new THREE.Vector3(226, 0, 12), 0, '#6b5a3a']);
    }
    this.addToChunks(this.surf.build('surfaces'));
    // player's first car at the kerb in front of the cafe
    this.spawns.cars.push(['sedan', new THREE.Vector3(-30, 0, -55.3), Math.PI / 2, '#1f3f66']);
    this.spawns.cars.push(['coupe', new THREE.Vector3(-8, 0, -55.3), Math.PI / 2, '#c7c2b3']);
    // pedestrians spread around the block loops
    const r = rng(9);
    for (let i = 0; i < 40; i++) {
      const ring = this.pedRings[i % 9], seg = r.int(0, 3), t = r();
      const a = ring[seg], b = ring[(seg + 1) % 4];
      this.spawns.peds.push({ pos: new THREE.Vector3(a[0] + (b[0] - a[0]) * t, LOT_Y + 0.05, a[1] + (b[1] - a[1]) * t), ring: i % 9, seg, dir: r.chance(0.5) ? 1 : -1 });
    }
  }

  sportsPitch(cx, cz, w, d, track) {
    this.noTree.push([cx - w / 2 - 10, cx + w / 2 + 10, cz - d / 2 - 10, cz + d / 2 + 10]);
    this.surface('grass', cx - w / 2 - 3, cx + w / 2 + 3, cz - d / 2 - 3, cz + d / 2 + 3, '#4f8a3a');
    for (let i = 0; i < 8; i++) this.surface('grass', cx - w / 2 + (i * w) / 8, cx - w / 2 + ((i + 1) * w) / 8, cz - d / 2, cz + d / 2, i % 2 ? '#4f8a3a' : '#5a9642', LOT_Y + 0.002);
    const P = (x, z, a, b) => this.paint(x, z, a, b, '#f4f4f0', LOT_Y + 0.004);
    P(cx, cz - d / 2, w, 0.12); P(cx, cz + d / 2, w, 0.12); P(cx - w / 2, cz, 0.12, d); P(cx + w / 2, cz, 0.12, d); P(cx, cz, 0.12, d);
    for (const s of [-1, 1]) { P(cx + s * (w / 2 - 8), cz, 0.12, 20); P(cx + s * (w / 2 - 4), cz - 10, 8, 0.12); P(cx + s * (w / 2 - 4), cz + 10, 8, 0.12); }
    for (let a = 0; a < 24; a++) { const t = (a / 24) * Math.PI * 2; P(cx + Math.cos(t) * 5, cz + Math.sin(t) * 5, 0.3, 0.3); }
    const B = this.surf;
    for (const s of [-1, 1]) {
      const gx = cx + s * (w / 2 + 0.3);
      for (const k of [-1, 1]) B.box('metal', gx, LOT_Y + 1.2, cz + k * 3.66, 0.12, 2.44, 0.12, '#f4f4f0', { collide: true });
      B.box('metal', gx, LOT_Y + 2.44, cz, 0.12, 0.12, 7.44, '#f4f4f0');
      B.box('fabric', gx + s * 0.8, LOT_Y + 1.2, cz, 0.02, 2.4, 7.3, '#e8e8e8');
    }
    if (track) {
      const tw = 6;
      this.surface('asphalt', cx - w / 2 - 3 - tw, cx + w / 2 + 3 + tw, cz - d / 2 - 3 - tw, cz - d / 2 - 3, '#a0493a', LOT_Y - 0.001);
      this.surface('asphalt', cx - w / 2 - 3 - tw, cx + w / 2 + 3 + tw, cz + d / 2 + 3, cz + d / 2 + 3 + tw, '#a0493a', LOT_Y - 0.001);
      this.surface('asphalt', cx - w / 2 - 3 - tw, cx - w / 2 - 3, cz - d / 2 - 3, cz + d / 2 + 3, '#a0493a', LOT_Y - 0.001);
      this.surface('asphalt', cx + w / 2 + 3, cx + w / 2 + 3 + tw, cz - d / 2 - 3, cz + d / 2 + 3, '#a0493a', LOT_Y - 0.001);
      for (let l = 1; l < 5; l++) { this.paint(cx, cz - d / 2 - 3 - l * 1.2, w + 6 + tw * 2, 0.06, '#ffffff'); this.paint(cx, cz + d / 2 + 3 + l * 1.2, w + 6 + tw * 2, 0.06, '#ffffff'); }
    }
  }

  court(cx, cz, rot) {
    const L2 = 14, W2 = 7.5, B = this.surf;
    this.noTree.push([cx - 16, cx + 16, cz - 16, cz + 16]);
    const rx = (lx, lz) => [cx + lx * Math.cos(rot) + lz * Math.sin(rot), cz - lx * Math.sin(rot) + lz * Math.cos(rot)];
    const along = Math.abs(Math.cos(rot)) > 0.5;
    this.surface('asphalt', cx - (along ? L2 + 1 : W2 + 1), cx + (along ? L2 + 1 : W2 + 1), cz - (along ? W2 + 1 : L2 + 1), cz + (along ? W2 + 1 : L2 + 1), '#3f6a8a', LOT_Y + 0.001);
    const P = (lx, lz, a, b) => { const [x, z] = rx(lx, lz); this.paint(x, z, along ? a : b, along ? b : a, '#f4f4f0', LOT_Y + 0.004); };
    P(0, -W2, 2 * L2, 0.08); P(0, W2, 2 * L2, 0.08); P(-L2, 0, 0.08, 2 * W2); P(L2, 0, 0.08, 2 * W2); P(0, 0, 0.08, 2 * W2);
    for (const s of [-1, 1]) {
      P(s * (L2 - 2.9), 0, 5.8, 0.08); P(s * (L2 - 2.9), -2.45, 5.8, 0.08); P(s * (L2 - 2.9), 2.45, 5.8, 0.08); P(s * (L2 - 5.8), 0, 0.08, 4.9);
      const [hx, hz] = rx(s * (L2 + 0.4), 0), [bx, bz] = rx(s * (L2 - 1.2), 0), [rimx, rimz] = rx(s * (L2 - 1.55), 0);
      B.cyl('metal', hx, LOT_Y, hz, 0.1, 3.4, '#2f3337', { seg: 8, collide: true });
      B.box('plastic', bx, LOT_Y + 3.35, bz, along ? 0.05 : 1.8, 1.05, along ? 1.8 : 0.05, '#f4f4f0');
      const rim = new THREE.TorusGeometry(0.23, 0.02, 6, 16); rim.rotateX(Math.PI / 2); rim.translate(rimx, LOT_Y + 3.05, rimz); B.push('metal', rim, '#e8601c');
    }
  }

  parkPaths(x0, x1, z0, z1) {
    // diagonal + ring paths, fountain, benches and trees
    const B = this.surf;
    const path = (ax, az, bx, bz, w = 3) => {
      const len = Math.hypot(bx - ax, bz - az), g = new THREE.PlaneGeometry(w, len); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(bx - ax, bz - az));
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * len / 3);
      g.translate((ax + bx) / 2, LOT_Y + 0.02, (az + bz) / 2); B.push('paving', g, '#d4ccbc');
    };
    const fx = -100, fz = 20;
    path(-130, z1, fx, fz); path(x1, z1, fx, fz); path(fx, fz, -70, fz); path(fx, fz, fx, z1);
    path(-130, z0, -130, z1); path(-130, -35, -70, -35);
    B.cyl('stone', fx, LOT_Y, fz, 4, 0.7, '#cfc8bb', { seg: 32, collide: true });
    B.cyl('tile', fx, LOT_Y + 0.45, fz, 3.6, 0.3, '#5fa8c9', { seg: 32 });
    B.cyl('stone', fx, LOT_Y, fz, 0.6, 2.4, '#cfc8bb', { seg: 12 }); B.cyl('stone', fx, LOT_Y + 2.4, fz, 1.2, 0.2, '#cfc8bb', { seg: 16 });
    this.parkBenches = [[fx - 6, fz, Math.PI / 2], [fx + 6, fz, -Math.PI / 2], [fx, fz + 6, Math.PI], [-128, -10, -Math.PI / 2], [-128, 5, -Math.PI / 2]];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const tx = fx - 25 + Math.cos(a) * 46 * 0.9, tz = -10 + Math.sin(a) * 34 * 0.95;
      if (tx > x0 + 2 && tx < x1 - 2 && tz > z0 + 2 && tz < z1 - 2 && Math.abs(tz - fz) > 3) this.trees.push([tx, tz, 1 + Math.random() * 0.5]);
    }
  }

  // ------------------------------------------------------------ rail corridor + parked train
  rail() {
    const B = new GeoBuilder(this.CM), x0 = -190, x1 = EAST + 4, len = x1 - x0, cx = (x0 + x1) / 2;
    B.box('concrete', cx, 0.1, (RAIL_Z[0] + RAIL_Z[1]) / 2, len, 0.2, 9, '#7a746a', { tile: 3 });
    const sleepers = [];
    for (const z of RAIL_Z) {
      for (const s of [-0.72, 0.72]) B.box('chrome', cx, 0.29, z + s, len, 0.14, 0.08, '#8f8a84');
      for (let x = x0; x < x1; x += 0.65) { const g = new THREE.BoxGeometry(0.24, 0.1, 2.6); g.translate(x, 0.22, z); sleepers.push(g); }
    }
    B.push('wood', mergeGeometries(sleepers), '#5a4a3a');
    // fence along the south sidewalk edge, open where the station platform is
    for (const [a, b] of [[x0, 74], [166, x1]]) {
      for (let x = a; x <= b; x += 3) B.box('metal', x, 1.0, SOUTH + 0.2, 0.06, 2.0, 0.06, '#5a5f66');
      for (const y of [0.3, 1.1, 1.9]) B.box('metal', (a + b) / 2, y, SOUTH + 0.2, b - a, 0.03, 0.03, '#6b7075');
      B.collider((a + b) / 2, 1.0, SOUTH + 0.2, (b - a) / 2, 1.0, 0.05);
    }
    // parked commuter train on the platform track (3 cars)
    const tz = RAIL_Z[0];
    for (let i = 0; i < 3; i++) {
      const x = 96 + i * 21.5;
      B.box('metal', x, 2.25, tz, 20.6, 3.3, 3.0, '#d8dde2', { collide: true });
      B.box('metal', x, 3.95, tz, 20.2, 0.3, 2.7, '#9aa3ab');
      B.box('paint', x, 1.2, tz - 1.505, 20.6, 0.4, 0.01, '#1f6fb2'); B.box('paint', x, 1.2, tz + 1.505, 20.6, 0.4, 0.01, '#1f6fb2');
      for (const s of [-1, 1]) {
        B.box('glassLit', x, 2.6, tz + s * 1.51, 18, 0.9, 0.02, '#4a5a6a');
        for (const dx of [-5, 5]) B.box('metal', x + dx, 2.0, tz + s * 1.52, 1.3, 2.4, 0.02, '#1f6fb2');
      }
      for (const dx of [-7, 7]) { B.box('metal', x + dx, 0.55, tz, 2.4, 0.5, 2.4, '#2a2a2a'); for (const s of [-0.72, 0.72]) B.cyl('metal', x + dx, 0.4, tz + s, 0.4, 0.12, '#333', { seg: 10 }); }
    }
    const g = B.build('rail');
    this.addToChunks(g);
    this.staticBody(B.colliders);
  }

  parks() { /* laid in buildAll (surfaces + trees) */ }

  // ------------------------------------------------------------ street furniture
  streetFurniture(models) {
    const { scene, physics } = this.game, w = physics.world;
    // --- trees (instanced trunk + two canopy variants)
    for (const s of STREETS_NS) for (let z = -150; z < 130; z += 18) if (!STREETS_EW.some((e) => Math.abs(z - e.z) < 14)) for (const sd of [-1, 1]) if (s.x + sd * 7 > -186 && s.x + sd * 7 < 186) this.trees.push([s.x + sd * 7.0, z + (sd > 0 ? 9 : 0), 0.8 + Math.random() * 0.35]);
    for (const e of STREETS_EW) for (let x = -170; x < 170; x += 20) if (!STREETS_NS.some((s) => Math.abs(x - s.x) < 14)) for (const sd of [-1, 1]) if (e.z + sd * 7 > -166) this.trees.push([x + (sd > 0 ? 10 : 0), e.z + sd * 7.0, 0.8 + Math.random() * 0.35]);
    const doorsW = this.buildings.flatMap((b) => b.doors.map((d) => this.toWorld(b, [d.hinge[0] + d.u[0] * d.w / 2, 0, d.hinge[2] + d.u[2] * d.w / 2])));
    const keep = this.trees.filter(([x, z]) => !this.buildings.some((b) => { const [bw, bd] = b.footprint; const r = Math.max(bw, bd) / 2 + 1; return Math.abs(x - b.x) < r && Math.abs(z - b.z) < r; })
      && !doorsW.some((p) => Math.hypot(p.x - x, p.z - z) < 3.5) && !this.noTree.some(([a, b2, c2, d2]) => x > a && x < b2 && z > c2 && z < d2));
    const trunkG = new THREE.CylinderGeometry(0.14, 0.2, 3.2, 7); trunkG.translate(0, 1.6, 0);
    const crownG = new THREE.IcosahedronGeometry(2.2, 1); crownG.scale(1, 1.15, 1); crownG.translate(0, 4.6, 0);
    const pos = crownG.attributes.position; for (let i = 0; i < pos.count; i++) { const n = 1 + (Math.sin(pos.getX(i) * 3.1) + Math.cos(pos.getZ(i) * 2.7)) * 0.08; pos.setXYZ(i, pos.getX(i) * n, pos.getY(i), pos.getZ(i) * n); }
    crownG.computeVertexNormals();
    const white = (g) => g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    white(trunkG); white(crownG);
    const trunks = new THREE.InstancedMesh(trunkG, this.CM.wood, keep.length), crowns = new THREE.InstancedMesh(crownG, this.CM.leaves, keep.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), cols = [];
    keep.forEach(([x, z, s], i) => {
      const y = LOT_Y; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
      m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4);
      trunks.setColorAt(i, c.set('#5a4636')); crowns.setColorAt(i, c.setHSL(0.24 + Math.random() * 0.08, 0.45, 0.26 + Math.random() * 0.08));
      cols.push({ cx: x, cy: y + 1.6 * s, cz: z, hx: 0.2 * s, hy: 1.6 * s, hz: 0.2 * s });
    });
    for (const im of [trunks, crowns]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
    this.staticBody(cols);
    this.treeCount = keep.length;

    // --- street lamps (instanced, breakable)
    const lampSpots = [];
    for (const s of STREETS_NS) for (let z = -148; z < 130; z += 32) if (!STREETS_EW.some((e) => Math.abs(z - e.z) < 12)) { if (s.x > -180) lampSpots.push([s.x - 6.6, z, Math.PI / 2]); lampSpots.push([s.x + 6.6, z + 16, -Math.PI / 2]); }
    for (const e of STREETS_EW) for (let x = -168; x < 172; x += 32) if (!STREETS_NS.some((s) => Math.abs(x - s.x) < 12)) { if (e.z > -160) lampSpots.push([x, e.z - 6.6, 0]); lampSpots.push([x + 16, e.z + 6.6, Math.PI]); }
    const lampG = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.11, 6, 8).translate(0, 3, 0),
      new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6).rotateZ(Math.PI / 2).translate(0.85, 5.9, 0),
      new THREE.BoxGeometry(0.7, 0.14, 0.32).translate(1.65, 5.85, 0),
      new THREE.CylinderGeometry(0.18, 0.2, 0.4, 8).translate(0, 0.2, 0),
    ].map((g) => g.toNonIndexed()));
    const bulbG = new THREE.BoxGeometry(0.56, 0.04, 0.26).translate(1.65, 5.77, 0);
    white(lampG); white(bulbG);
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff4d8', emissive: '#ffcf85', emissiveIntensity: 0 });
    this.lampPoles = new THREE.InstancedMesh(lampG, this.CM.metal, lampSpots.length);
    this.lampBulbs = new THREE.InstancedMesh(bulbG, this.lampMat, lampSpots.length);
    lampSpots.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot); m4.compose(new THREE.Vector3(x, LOT_Y, z), q, new THREE.Vector3(1, 1, 1));
      this.lampPoles.setMatrixAt(i, m4); this.lampBulbs.setMatrixAt(i, m4); this.lampPoles.setColorAt(i, c.set('#3f444a'));
      const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, LOT_Y + 3, z).setRotation(q));
      const col = physics.own(w.createCollider(R.ColliderDesc.cylinder(3, 0.1).setDensity(300).setCollisionGroups(groups(L.PROP, ALL)).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body), { kind: 'lamp' });
      const prop = { idx: i, body, kind: 'lamp', collider: col, instanced: true };
      physics.handles.get(col.handle).prop = prop;
      this.ilamps.push(prop);
    });
    for (const im of [this.lampPoles, this.lampBulbs]) { im.castShadow = true; scene.add(im); }
    this.lampPoles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.lampBulbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // --- street name blades + traffic lights at intersections
    const B = new GeoBuilder(this.CM);
    for (const it of this.intersections) {
      const px = it.x + 7.6, pz = it.z - 7.6;
      if (px > 190) continue;
      B.cyl('metal', px, LOT_Y, pz, 0.05, 3.2, '#2f5a3a', { seg: 8 });
      const r1 = this.atlas.add(it.ns, { bg: '#1f5a3a', fg: '#ffffff', font: 'bold 44px Arial, sans-serif' }), r2 = this.atlas.add(it.ew, { bg: '#1f5a3a', fg: '#ffffff', font: 'bold 44px Arial, sans-serif' });
      for (const s of [1, -1]) { B.quad(this.atlas.material, px + 0.03 * s, LOT_Y + 3.0, pz, 1.6, 0.4, r1, s > 0 ? Math.PI / 2 : -Math.PI / 2); B.quad(this.atlas.material, px, LOT_Y + 3.35, pz + 0.03 * s, 1.6, 0.4, r2, s > 0 ? 0 : Math.PI); }
    }
    this.addToChunks(B.build('signs'));
    const add = (m, x, z, rot, opt) => models[m] && this.addModelProp(models[m], new THREE.Vector3(x, LOT_Y, z), rot, opt);
    for (const it of this.intersections) {
      if (it.x > 170 || it.x < -170) continue;
      add('trafficlight', it.x - 7.2, it.z - 7.2, Math.PI);
      add('trafficlight', it.x + 7.2, it.z + 7.2, 0);
    }
    // hydrants, bins, benches, dumpsters
    for (const lot of this.lots) {
      add('hydrant', lot.x0 - 3.3, lot.z0 + 3, 0);
      add('litterbin', lot.x1 + 3.2, lot.z1 - 3, 0, { mass: 25 });
      add('litterbin', (lot.x0 + lot.x1) / 2 + 6, lot.z0 - 3.2, 0, { mass: 25 });
    }
    for (const x of [-26, -2, 22]) add('bench', x, -50.5, Math.PI, { mass: 60 });
    for (const [x, z, r] of this.parkBenches) add('bench', x, z, r, { mass: 60 });
    for (let i = 0; i < 3; i++) add('dumpster', -48 + i * 2.2, -24, 0, { mass: 700 });
    add('dumpster', 214, -95, Math.PI / 2, { mass: 700 }); add('dumpster', 214, -91, Math.PI / 2, { mass: 700 });
    for (let i = 0; i < 4; i++) add('barrier', 212 + i * 3.1, 106, 0, { mass: 900 });
  }

  // ------------------------------------------------------------ runtime
  update(night) {
    super.update(night);
    this.lampMat.emissiveIntensity = night * 6;
    for (const m of this.CM.nightGlow) m.emissiveIntensity = night * 0.9;
    this.atlas.material.emissiveIntensity = 0.15 + night * 0.9;
    let dirty = false;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (const p of this.ilamps) {
      if (!p.broken || (p.body.isSleeping() && !p.dirty)) continue;
      const t = p.body.translation(), r = p.body.rotation();
      q.set(r.x, r.y, r.z, r.w);
      const base = new THREE.Vector3(0, -3, 0).applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
      m4.compose(base, q, new THREE.Vector3(1, 1, 1));
      this.lampPoles.setMatrixAt(p.idx, m4); this.lampBulbs.setMatrixAt(p.idx, m4);
      p.dirty = false; dirty = true;
    }
    if (dirty) { this.lampPoles.instanceMatrix.needsUpdate = true; this.lampBulbs.instanceMatrix.needsUpdate = true; }
  }

  breakLamp(prop, vel) {
    if (prop.broken) return;
    prop.broken = true;
    prop.body.setBodyType(R.RigidBodyType.Dynamic, true);
    prop.body.setLinvel({ x: vel.x * 0.4, y: 1, z: vel.z * 0.4 }, true);
    prop.body.setAngvel({ x: vel.z * 0.3, y: 0, z: -vel.x * 0.3 }, true);
    prop.dirty = true;
  }

  // Street name lookup for the HUD (nearest street centre line).
  streetAt(p) {
    let best = null, bd = 1e9;
    for (const s of STREETS_NS) { const d = Math.abs(p.x - s.x); if (d < bd && p.z > -170 && p.z < SOUTH) { bd = d; best = s.name; } }
    for (const s of STREETS_EW) { const d = Math.abs(p.z - s.z); if (d < bd && p.x > -190 && p.x < EAST) { bd = d; best = s.name; } }
    return bd < 30 ? best : p.x > 186 ? 'HARBOR INDUSTRIAL' : 'HARBOR HEIGHTS';
  }
}
