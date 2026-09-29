import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { R, L, groups, ALL } from './physics.js';

// ---------------------------------------------------------------- procedural PBR textures
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseFill(g, s, base, amp, grain = 1) {
  const img = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const n = (Math.random() - 0.5) * amp * (Math.random() < 0.02 * grain ? 3 : 1);
    img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
// Height canvas -> tangent-space normal map
function normalFrom(heightCanvas, strength = 2) {
  const s = heightCanvas.width, src = heightCanvas.getContext('2d').getImageData(0, 0, s, s).data;
  return canvasTex(s, (g) => {
    const img = g.createImageData(s, s);
    const h = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
      img.data[i] = (-dx / len * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / len * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / len * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
}
function heightCanvas(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c; }

export function makeMaterials(tex) {
  const asphaltH = heightCanvas(512, (g, s) => { noiseFill(g, s, [128, 128, 128], 120, 2); });
  const asphalt = new THREE.MeshStandardMaterial({
    map: tex?.asphalt?.userData.generated ? tex.asphalt : canvasTex(512, (g, s) => {
      noiseFill(g, s, [58, 58, 60], 26, 2);
      g.globalAlpha = 0.08; for (let i = 0; i < 40; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#777'; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 60, 10 + Math.random() * 40, Math.random() * 3, 0, 7); g.fill(); }
    }),
    normalMap: normalFrom(asphaltH, 3), roughness: 0.88, metalness: 0,
  });
  asphalt.normalScale.set(0.6, 0.6);
  const concreteH = heightCanvas(256, (g, s) => { noiseFill(g, s, [128, 128, 128], 60); g.fillStyle = '#303030'; g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s); });
  const concrete = new THREE.MeshStandardMaterial({
    map: canvasTex(256, (g, s) => { noiseFill(g, s, [168, 164, 156], 22); g.fillStyle = 'rgba(70,68,64,0.8)'; g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s); }),
    normalMap: normalFrom(concreteH, 4), roughness: 0.92,
  });
  const brickH = heightCanvas(512, (g, s) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, s, s); g.fillStyle = '#5a5a5a';
    for (let y = 0; y < s; y += 16) { g.fillRect(0, y, s, 3); for (let x = (y / 16) % 2 ? 0 : 16; x < s; x += 32) g.fillRect(x, y, 3, 16); }
  });
  const brick = new THREE.MeshStandardMaterial({
    map: canvasTex(512, (g, s) => {
      g.fillStyle = '#b8ab98'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < s; x += 32) {
        const r = 120 + Math.random() * 40, gg = 58 + Math.random() * 22, b = 44 + Math.random() * 16;
        g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(x + 3, y + 3, 29, 13);
      }
    }),
    normalMap: normalFrom(brickH, 5), roughness: 0.9,
  });
  const facade = new THREE.MeshStandardMaterial({
    map: canvasTex(512, (g, s) => {
      noiseFill(g, s, [214, 206, 190], 12);
      for (const [x, y] of [[48, 60], [288, 60], [48, 316], [288, 316]]) {
        g.fillStyle = '#e9e4da'; g.fillRect(x - 10, y - 10, 196, 196);
        const gr = g.createLinearGradient(x, y, x + 176, y + 176); gr.addColorStop(0, '#5f7f99'); gr.addColorStop(1, '#1c2733');
        g.fillStyle = gr; g.fillRect(x, y, 176, 176);
        g.fillStyle = '#e9e4da'; g.fillRect(x + 84, y, 8, 176); g.fillRect(x, y + 84, 176, 8);
      }
    }),
    roughness: 0.7, metalness: 0.05, emissive: '#ffffff', emissiveIntensity: 0,
    emissiveMap: canvasTex(128, (g, s) => { g.fillStyle = '#000'; g.fillRect(0, 0, s, s); for (const [x, y] of [[12, 15], [72, 15], [12, 79], [72, 79]]) if (Math.random() < 0.65) { g.fillStyle = '#ffc97a'; g.fillRect(x, y, 44, 44); } }),
  });
  const grass = new THREE.MeshStandardMaterial({ map: canvasTex(256, (g, s) => { noiseFill(g, s, [72, 104, 52], 50, 3); }), roughness: 1 });
  const paintW = new THREE.MeshStandardMaterial({ color: '#e8e6df', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const paintY = new THREE.MeshStandardMaterial({ color: '#e0b528', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const metal = new THREE.MeshStandardMaterial({ color: '#4a4f55', roughness: 0.4, metalness: 0.8 });
  const orange = new THREE.MeshStandardMaterial({ color: '#f06a1a', roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.4 });
  const binG = new THREE.MeshStandardMaterial({ color: '#2f5a3a', roughness: 0.55 });
  const wood = new THREE.MeshStandardMaterial({ map: canvasTex(128, (g, s) => { noiseFill(g, s, [150, 110, 70], 30); g.fillStyle = 'rgba(60,40,20,0.6)'; for (let y = 0; y < s; y += 16) g.fillRect(0, y, s, 2); }), roughness: 0.85 });
  const barrel = new THREE.MeshStandardMaterial({ color: '#2d5f9e', roughness: 0.35, metalness: 0.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff4d8', emissive: '#ffcf85', emissiveIntensity: 0 });
  return { asphalt, concrete, brick, facade, grass, paintW, paintY, metal, orange, white, binG, wood, barrel, lamp };
}

function setRepeat(mat, x, y) {
  const m = mat.clone();
  for (const k of ['map', 'normalMap', 'emissiveMap']) if (m[k]) { m[k] = m[k].clone(); m[k].needsUpdate = true; m[k].repeat.set(x, y); }
  return m;
}

// UV-scaled box so tiling textures stay at world scale
function worldBox(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}

export class TestMap {
  constructor(game, tex) {
    this.game = game;
    const M = (this.M = makeMaterials(tex));
    const scene = game.scene, phys = game.physics, w = phys.world;
    this.props = [];
    this.lamps = [];
    this.spawns = { player: new THREE.Vector3(6, 0, -8), cars: [], peds: [] };

    // ground: asphalt apron + grass
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), setRepeat(M.grass, 120, 120));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(360, 240), setRepeat(M.asphalt, 72, 48));
    apron.rotation.x = -Math.PI / 2; apron.receiveShadow = true; scene.add(apron);
    phys.staticBox(0, -0.5, 0, 300, 0.5, 300, 0, 1.0);

    // markings: drag strip lanes, skidpad ring, parking bays
    const marks = [], yel = [];
    const line = (x, z, len, rot, wdt = 0.15, list = marks) => { const g = new THREE.PlaneGeometry(wdt, len); g.rotateX(-Math.PI / 2); g.rotateY(rot); g.translate(x, 0.01, z); list.push(g); };
    for (let z = -100; z < 100; z += 6) line(0, z + 1.5, 3, 0, 0.15, yel);
    line(-5.5, 0, 200, 0); line(5.5, 0, 200, 0);
    const ring = (cx, cz, r) => { for (let a = 0; a < 64; a++) { const t = (a / 64) * Math.PI * 2, t2 = ((a + 1) / 64) * Math.PI * 2; const x = cx + Math.cos((t + t2) / 2) * r, z = cz + Math.sin((t + t2) / 2) * r; line(x, z, r * (t2 - t) + 0.02, -(t + t2) / 2, 0.2); } };
    ring(-90, 40, 25); ring(-90, 40, 32);
    for (let i = 0; i < 10; i++) line(40 + i * 3, -60, 5, 0);
    scene.add(new THREE.Mesh(mergeGeometries(marks), M.paintW), new THREE.Mesh(mergeGeometries(yel), M.paintY));

    // ramps and speed bumps (static)
    const staticMesh = (geo, mat, pos, quat) => {
      const m = new THREE.Mesh(geo, mat); m.position.copy(pos); if (quat) m.quaternion.copy(quat); m.castShadow = m.receiveShadow = true; scene.add(m);
      geo.computeBoundingBox(); const s = new THREE.Vector3(); geo.boundingBox.getSize(s);
      const b = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(quat || new THREE.Quaternion()));
      w.createCollider(R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2).setFriction(1).setCollisionGroups(groups(L.WORLD, ALL)), b);
      return m;
    };
    const rampQ = (deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -deg * Math.PI / 180);
    staticMesh(worldBox(8, 0.5, 14, 4), M.concrete, new THREE.Vector3(60, 1.4, 20), rampQ(12));
    staticMesh(worldBox(8, 0.5, 10, 4), M.concrete, new THREE.Vector3(60, 0.9, 60), rampQ(-9).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)));
    for (const z of [-40, -30]) staticMesh(new THREE.CylinderGeometry(0.35, 0.35, 10, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), M.paintY, new THREE.Vector3(0, -0.2, z));

    // street block with kerbs, sidewalks and buildings along a street at x=20..
    this.buildStreet(scene, phys, M);

    // dynamic props
    for (let i = 0; i < 12; i++) this.addProp('cone', new THREE.Vector3(-3 + (i % 2) * 6, 0, -70 + i * 6));
    for (let i = 0; i < 8; i++) this.addProp('cone', new THREE.Vector3(-90 + Math.cos(i) * 28.5, 0, 40 + Math.sin(i) * 28.5));
    for (let i = 0; i < 6; i++) this.addProp('bin', new THREE.Vector3(24.8, 0.15, -30 + i * 9));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3 - y; x++) this.addProp('crate', new THREE.Vector3(30 + x * 1.05 + y * 0.5, y * 1.0 + 0.5, 40));
    for (let i = 0; i < 5; i++) this.addProp('barrel', new THREE.Vector3(-20 + i * 1.2, 0.45, 40));

    this.spawns.cars = [
      ['coupe', new THREE.Vector3(2.5, 0, -80), 0, '#c7c2b3'],
      ['sedan', new THREE.Vector3(-2.5, 0, -80), 0, '#1f3f66'],
      ['suv', new THREE.Vector3(12, 0, -20), Math.PI / 2, '#2b2b2b'],
      ['coupe', new THREE.Vector3(43, 0, -60), Math.PI, '#8e1b1b'],
    ];
    this.spawns.peds = [];
    for (let i = 0; i < 16; i++) this.spawns.peds.push(new THREE.Vector3(26.5 + (i % 2) * 1.5, 0.15, -40 + i * 5.5));
  }

  buildStreet(scene, phys, M) {
    // sidewalk (raised 0.15 m kerb) along x = 23..29, z = -50..50
    const sw = new THREE.Mesh(worldBox(6, 0.15, 100, 2), M.concrete); sw.position.set(26, 0.075, 0); sw.receiveShadow = true; scene.add(sw);
    phys.staticBox(26, 0.075, 0, 3, 0.075, 50);
    const kerb = new THREE.Mesh(worldBox(0.25, 0.17, 100, 1), M.concrete); kerb.position.set(23.1, 0.085, 0); scene.add(kerb);
    // buildings behind the sidewalk
    const defs = [[-42, 16, 14, 'brick'], [-24, 14, 22, 'facade'], [-6, 18, 10, 'brick'], [12, 12, 26, 'facade'], [30, 16, 16, 'brick'], [44, 10, 12, 'facade']];
    for (const [z, len, h, kind] of defs) {
      const mat = kind === 'brick' ? M.brick : M.facade;
      const m = new THREE.Mesh(worldBox(12, h, len, kind === 'brick' ? 2.5 : 6), mat);
      m.position.set(35, h / 2 + 0.15, z); m.castShadow = m.receiveShadow = true; scene.add(m);
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.5, len + 0.6), M.concrete); cornice.position.set(35, h + 0.4, z); cornice.castShadow = true; scene.add(cornice);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, len * 0.7), new THREE.MeshStandardMaterial({ color: ['#7a1d1d', '#1d4d7a', '#2f6b3a'][Math.floor(Math.random() * 3)], roughness: 0.7 }));
      awning.position.set(28.4, 3.2, z); awning.rotation.z = 0.25; awning.castShadow = true; scene.add(awning);
      phys.staticBox(35, h / 2 + 0.15, z, 6, h / 2, len / 2);
    }
    // breakaway lamp posts: kinematic until hit hard, then they become dynamic
    for (let z = -45; z <= 45; z += 15) this.addLamp(new THREE.Vector3(23.6, 0.15, z));
  }

  addLamp(pos) {
    const w = this.game.physics.world, M = this.M;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 6, 10), M.metal); pole.position.y = 3; pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 8), M.metal); arm.rotation.z = Math.PI / 2; arm.position.set(-0.75, 5.9, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.3), M.metal); head.position.set(-1.5, 5.85, 0);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.24), M.lamp); bulb.position.set(-1.5, 5.77, 0);
    g.add(pole, arm, head, bulb);
    this.game.scene.add(g);
    const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 3, pos.z));
    const col = this.game.physics.own(w.createCollider(R.ColliderDesc.cylinder(3, 0.1).setDensity(300)
      .setCollisionGroups(groups(L.PROP, ALL)).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), body), { kind: 'lamp' });
    const prop = { mesh: g, body, offsetY: -3, kind: 'lamp', collider: col, light: bulb };
    this.game.physics.handles.get(col.handle).prop = prop;
    this.props.push(prop);
    this.lamps.push(prop);
  }

  addProp(kind, pos) {
    const w = this.game.physics.world, M = this.M;
    let mesh, desc, oy = 0;
    if (kind === 'cone') {
      mesh = new THREE.Group();
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.7, 16), M.orange); c.position.y = 0.37;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), M.orange); b.position.y = 0.02;
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.1, 16), M.white); s.position.y = 0.42;
      mesh.add(c, b, s); desc = R.ColliderDesc.cone(0.36, 0.2).setTranslation(0, 0.36, 0).setMass(3);
    } else if (kind === 'bin') {
      mesh = new THREE.Group();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.95, 0.7), M.binG); b.position.y = 0.48;
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.76), M.binG); l.position.y = 0.98;
      mesh.add(b, l); desc = R.ColliderDesc.cuboid(0.3, 0.5, 0.35).setTranslation(0, 0.5, 0).setMass(18);
    } else if (kind === 'crate') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), M.wood); desc = R.ColliderDesc.cuboid(0.5, 0.5, 0.5).setMass(28);
    } else {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20), M.barrel); desc = R.ColliderDesc.cylinder(0.45, 0.3).setMass(40);
    }
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (!mesh.isGroup) { const g = new THREE.Group(); g.add(mesh); mesh = g; }
    this.game.scene.add(mesh);
    const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCanSleep(true).setAngularDamping(0.3));
    w.createCollider(desc.setFriction(0.7).setRestitution(0.15).setCollisionGroups(groups(L.PROP, ALL)), body);
    this.props.push({ mesh, body, offsetY: oy, kind });
  }

  update(night) {
    for (const p of this.props) {
      if (p.body.isSleeping() && !p.dirty) continue;
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      p.mesh.position.set(t.x, t.y, t.z).add(new THREE.Vector3(0, p.offsetY, 0).applyQuaternion(p.mesh.quaternion));
      p.dirty = false;
    }
    this.M.lamp.emissiveIntensity = night * 6;
    this.M.facade.emissiveIntensity = night * 1.4;
  }

  // Knock a lamp post loose when a vehicle hits it
  breakLamp(prop, vel) {
    if (prop.broken) return;
    prop.broken = true;
    prop.body.setBodyType(R.RigidBodyType.Dynamic, true);
    prop.body.setLinvel({ x: vel.x * 0.4, y: 1, z: vel.z * 0.4 }, true);
    prop.body.setAngvel({ x: vel.z * 0.3, y: 0, z: -vel.x * 0.3 }, true);
    prop.dirty = true;
  }
}
