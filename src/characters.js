import * as THREE from 'three';

const SKIN = ['#f1c7a5', '#d9a47c', '#b07650', '#8a5a3b', '#5e3b26'];
const HAIR = ['#1b1410', '#3b2518', '#6b4a2a', '#b38a4f', '#2a2a2a', '#8c8c8c'];
const TOPS = ['#c0392b', '#2c3e50', '#27ae60', '#8e44ad', '#e0e0e0', '#d35400', '#34495e', '#f1c40f', '#16a085', '#7f8c8d', '#1f1f1f'];
const BOTTOMS = ['#2c3e50', '#1d1d1d', '#4a5a6a', '#6b5b45', '#344b6d', '#7a6a5a'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const matCache = new Map();
const mat = (c) => {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  return matCache.get(c);
};

function part(w, h, d, color, y) {
  // box pivoted at its top so limbs swing from the joint
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(g, mat(color));
  m.castShadow = true;
  m.position.y = y;
  return m;
}

// Builds a stylised humanoid. `look` can override colours.
export function makeHumanoid(look = {}) {
  const skin = look.skin || pick(SKIN), hair = look.hair || pick(HAIR);
  const top = look.top || pick(TOPS), bottom = look.bottom || pick(BOTTOMS);
  const shoes = look.shoes || '#222';
  const root = new THREE.Group();
  const body = new THREE.Group(); // everything above the feet, used for leaning/falling
  root.add(body);

  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const torso = part(0.52, 0.62, 0.28, top, 0.62); hips.add(torso);
  if (look.jacket) { // open jacket over a shirt
    const j1 = part(0.2, 0.64, 0.31, look.jacket, 0.63); j1.position.x = -0.17; hips.add(j1);
    const j2 = part(0.2, 0.64, 0.31, look.jacket, 0.63); j2.position.x = 0.17; hips.add(j2);
    const collar = part(0.56, 0.08, 0.32, look.jacket, 0.66); hips.add(collar);
  }
  if (look.vest) { const v = part(0.56, 0.4, 0.33, look.vest, 0.58); hips.add(v); }
  const pelvis = part(0.5, 0.2, 0.27, bottom, 0.02); hips.add(pelvis);

  const neck = new THREE.Group(); neck.position.y = 0.62; hips.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), mat(skin)); head.position.y = 0.22; head.castShadow = true; neck.add(head);
  const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.32), mat(hair)); hairM.position.y = 0.36; neck.add(hairM);
  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(0.32, look.longHair ? 0.4 : 0.2, 0.08), mat(hair)); hairBack.position.set(0, look.longHair ? 0.18 : 0.26, -0.13); neck.add(hairBack);
  if (look.cap) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.46), mat(look.cap)); c.position.set(0, 0.42, 0.06); neck.add(c); }
  if (look.shades) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.04), mat('#111')); s.position.set(0, 0.26, 0.16); neck.add(s); }
  // eyes
  for (const x of [-0.07, 0.07]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.02), mat('#1a1a1a')); e.position.set(x, 0.25, 0.155); neck.add(e); }

  const armColor = look.jacket || top;
  const lArm = part(0.14, 0.34, 0.14, armColor, 0.58); lArm.position.x = -0.34; hips.add(lArm);
  const rArm = part(0.14, 0.34, 0.14, armColor, 0.58); rArm.position.x = 0.34; hips.add(rArm);
  const lFore = part(0.12, 0.32, 0.12, skin, -0.34); lArm.add(lFore);
  const rFore = part(0.12, 0.32, 0.12, skin, -0.34); rArm.add(rFore);
  const lLeg = part(0.2, 0.46, 0.2, bottom, 0); lLeg.position.x = -0.13; hips.add(lLeg);
  const rLeg = part(0.2, 0.46, 0.2, bottom, 0); rLeg.position.x = 0.13; hips.add(rLeg);
  const lShin = part(0.18, 0.46, 0.18, bottom, -0.46); lLeg.add(lShin);
  const rShin = part(0.18, 0.46, 0.18, bottom, -0.46); rLeg.add(rShin);
  const lFoot = part(0.19, 0.08, 0.3, shoes, -0.44); lFoot.position.z = 0.05; lShin.add(lFoot);
  const rFoot = part(0.19, 0.08, 0.3, shoes, -0.44); rFoot.position.z = 0.05; rShin.add(rFoot);

  // held weapon (hidden unless armed)
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), mat('#1c1c1c')); gunBody.position.z = 0.1; gun.add(gunBody);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), mat('#2a2a2a')); grip.position.set(0, -0.08, 0); gun.add(grip);
  gun.position.set(0, -0.3, 0.05); gun.visible = false; rFore.add(gun);

  root.userData.rig = { body, hips, torso, neck, head, lArm, rArm, lFore, rFore, lLeg, rLeg, lShin, rShin, gun, gunBody };
  return root;
}

// Pose the rig. state: {speed (m/s), phase, aiming, inCar, dead, deadT, airborne, punch}
export function animateHumanoid(root, s, dt) {
  const r = root.userData.rig;
  const run = Math.min(1, s.speed / 6);
  const amp = s.speed > 0.2 ? 0.5 + run * 0.5 : 0;
  const p = s.phase;
  const sw = Math.sin(p) * amp;
  if (s.dead) {
    // topple over and lie on the ground
    const k = Math.min(1, s.deadT * 2.5);
    r.body.rotation.x = -Math.PI / 2 * k;
    r.body.position.y = 0.15 * k;
    r.lArm.rotation.set(0, 0, -1.2 * k); r.rArm.rotation.set(0, 0, 1.2 * k);
    r.lLeg.rotation.x = 0.2 * k; r.rLeg.rotation.x = -0.1 * k;
    return;
  }
  r.body.rotation.x = 0; r.body.position.y = 0;
  if (s.inCar) {
    r.lLeg.rotation.x = r.rLeg.rotation.x = -1.4;
    r.lShin.rotation.x = r.rShin.rotation.x = 1.4;
    r.lArm.rotation.x = r.rArm.rotation.x = -1.1;
    r.lFore.rotation.x = r.rFore.rotation.x = -0.2;
    r.hips.position.y = 0.5;
    r.gun.visible = false;
    return;
  }
  r.hips.position.y = 0.95 + Math.abs(Math.cos(p)) * 0.05 * amp;
  r.hips.rotation.y = Math.sin(p) * 0.08 * amp;
  r.torso.rotation.x = run * 0.15;
  r.lLeg.rotation.x = sw;
  r.rLeg.rotation.x = -sw;
  r.lShin.rotation.x = Math.max(0, -Math.sin(p - 0.8)) * amp * 1.2;
  r.rShin.rotation.x = Math.max(0, Math.sin(p - 0.8)) * amp * 1.2;
  if (s.airborne) { r.lLeg.rotation.x = -0.6; r.rLeg.rotation.x = 0.3; r.lShin.rotation.x = 0.9; r.rShin.rotation.x = 0.4; }
  r.lArm.rotation.set(-sw * 0.8, 0, -0.08);
  r.lFore.rotation.x = -0.3 - run * 0.9;
  r.rArm.rotation.set(sw * 0.8, 0, 0.08);
  r.rFore.rotation.x = -0.3 - run * 0.9;
  r.gun.visible = !!s.armed;
  if (s.aiming && s.armed) {
    r.rArm.rotation.set(-Math.PI / 2 + (s.aimPitch || 0), 0, 0);
    r.rFore.rotation.x = 0;
    r.lArm.rotation.set(-Math.PI / 2 + (s.aimPitch || 0), 0, 0.45);
    r.lFore.rotation.x = 0;
    r.hips.rotation.y = 0;
  }
  if (s.punch > 0) {
    const k = Math.sin((1 - s.punch / 0.35) * Math.PI);
    r.rArm.rotation.set(-Math.PI / 2 * k, 0, 0); r.rFore.rotation.x = -0.3 * (1 - k);
  }
  if (s.handsUp) { r.lArm.rotation.set(Math.PI, 0, 0.2); r.rArm.rotation.set(Math.PI, 0, -0.2); r.lFore.rotation.x = r.rFore.rotation.x = 0; }
}
