import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initPhysics, Physics, R } from './physics.js';
import { Renderer, TIERS } from './render.js';
import { TestMap } from './testmap.js';
import { Character } from './character.js';
import { Vehicle } from './vehicle.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { DevOverlay } from './overlay.js';
import { Audio } from '../audio.js';
import { loadTextures } from '../assets.js';
import { buildHumanoid, LOOKS } from './humanoid.js';

const $ = (id) => document.getElementById(id);
const status = (t, p) => { $('ldText').textContent = t; if (p != null) $('ldFill').style.width = `${Math.round(p * 100)}%`; };

// Characters: a Tripo-generated rig (`tripo anim rig --spec mixamo`) in
// assets/characters/player.glb is used when present; otherwise the built-in rigged
// humanoid, so the game never depends on a download to start.
async function loadCharacter() {
  if (location.protocol !== 'file:') {
    try {
      const gltf = await new GLTFLoader().loadAsync('assets/characters/player.glb');
      const box = new THREE.Box3().setFromObject(gltf.scene, true);
      const h = box.max.y - box.min.y;
      return { scene: gltf.scene, clips: gltf.animations.filter((c) => /idle|walk|run/i.test(c.name)), scale: h > 0 ? 1.78 / h : 1, url: 'assets/characters/player.glb' };
    } catch { /* fall through to the built-in character */ }
  }
  return buildHumanoid(LOOKS[0]);
}

// Generated vehicle models (processed by tools/process-car.mjs): body LOD0-2 + split wheels.
// Paths are spelled out so the single-file build can embed them.
const VEHICLE_FILES = {
  fw_veh_sedan_meridian: ['assets/vehicles/fw_veh_sedan_meridian_lod0.glb', 'assets/vehicles/fw_veh_sedan_meridian_lod1.glb', 'assets/vehicles/fw_veh_sedan_meridian_lod2.glb'],
  fw_veh_coupe_vento: ['assets/vehicles/fw_veh_coupe_vento_lod0.glb', 'assets/vehicles/fw_veh_coupe_vento_lod1.glb', 'assets/vehicles/fw_veh_coupe_vento_lod2.glb'],
  fw_veh_suv_ridgeback: ['assets/vehicles/fw_veh_suv_ridgeback_lod0.glb', 'assets/vehicles/fw_veh_suv_ridgeback_lod1.glb', 'assets/vehicles/fw_veh_suv_ridgeback_lod2.glb'],
};
const PROP_FILES = {
  bench: 'assets/props/fw_prop_bench_park_a.glb',
  hydrant: 'assets/props/fw_prop_hydrant_a.glb',
  litterbin: 'assets/props/fw_prop_litterbin_a.glb',
  dumpster: 'assets/props/fw_prop_dumpster_a.glb',
  barrier: 'assets/props/fw_prop_barrier_jersey_a.glb',
  trafficlight: 'assets/props/fw_prop_trafficlight_a.glb',
};
async function loadProps() {
  const loader = new GLTFLoader(), out = {};
  await Promise.all(Object.entries(PROP_FILES).map(async ([k, f]) => {
    try {
      const g = await loader.loadAsync(f);
      const size = g.scene.userData.freeWorld?.size || new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()).toArray();
      out[k] = { scene: g.scene, size };
    } catch (e) { console.warn('prop unavailable', k, e); }
  }));
  return out;
}
async function loadVehicleModel(name) {
  const loader = new GLTFLoader();
  const [g0, g1, g2] = await Promise.all(VEHICLE_FILES[name].map((f) => loader.loadAsync(f)));
  const body = [g0, g1, g2].map((g) => g.scene.getObjectByName('body'));
  let mat = null;
  body[0].traverse((o) => { if (o.isMesh && !mat) mat = o.material; });
  for (const b of body.slice(1)) b.traverse((o) => { if (o.isMesh) o.material = mat; });
  const wheels = {};
  for (const n of ['wheel_lf', 'wheel_rf', 'wheel_lr', 'wheel_rr']) wheels[n] = g0.scene.getObjectByName(n);
  const meta = g0.scene.userData.freeWorld || {};
  const box = new THREE.Box3().setFromObject(body[0], true), size = box.getSize(new THREE.Vector3());
  const lf = wheels.wheel_lf.position, lr = wheels.wheel_lr.position;
  return {
    body, wheels,
    handling: {
      dims: [size.x, size.y, size.z], wheelR: meta.wheelRadius || lf.y,
      wheelbase: Math.abs(lf.z - lr.z), track: Math.abs(lf.x - wheels.wheel_rf.position.x),
    },
  };
}

async function main() {
  const tierName = localStorage.getItem('fw-tier') || 'medium';
  $('optTier').value = tierName;
  status('Starting physics', 0.05);
  await initPhysics();
  const renderer = new Renderer($('view'), tierName);
  const physics = new Physics();
  const game = { scene: renderer.scene, physics, renderer, models: {} };
  status('Loading vehicles', 0.1);
  await Promise.all(Object.keys(VEHICLE_FILES).map(async (name) => {
    try { game.models[name] = await loadVehicleModel(name); }
    catch (e) { console.warn('Generated vehicle unavailable, using built-in body:', name, e); }
  }));
  const props = await loadProps();
  status('Loading materials', 0.15);
  const tex = await loadTextures(() => {});
  status('Building proving ground', 0.35);
  const map = new TestMap(game, tex);
  map.placeModelProps(props);
  status('Loading character', 0.5);
  const charAsset = await loadCharacter();
  status('Spawning', 0.8);

  const player = new Character(game, charAsset, map.spawns.player, { player: true, facing: Math.PI });
  // generated sedan when available (falls back to the procedural sedan)
  // procedural placeholders are swapped for generated models when those loaded
  const GEN = { sedan: ['meridian', 'fw_veh_sedan_meridian'], coupe: ['vento', 'fw_veh_coupe_vento'], suv: ['ridgeback', 'fw_veh_suv_ridgeback'], patrol: ['patrol', 'fw_veh_sedan_meridian'] };
  const pick = (t) => (GEN[t] && game.models[GEN[t][1]] ? GEN[t][0] : t === 'patrol' ? 'sedan' : t);
  const vehicles = map.spawns.cars.map(([t, p, h, c]) => new Vehicle(game, pick(t), p, h, c || '#1f3f66'));
  const npcLooks = LOOKS.slice(1).map((l) => buildHumanoid(l));
  const npcs = map.spawns.peds.slice(0, renderer.tier.peds).map((p, i) => {
    const n = new Character(game, npcLooks[i % npcLooks.length], p, { facing: i % 2 ? 0 : Math.PI });
    n.ai = { dir: i % 2 ? 1 : -1, wait: Math.random() * 3, gait: Math.random() < 0.8 ? 'walk' : 'run' };
    return n;
  });
  const cam = new CameraRig(renderer.camera, physics);
  const input = new Input($('view'));
  input.sens = Number(localStorage.getItem('fw-sens') || 1);
  const overlay = new DevOverlay();
  const audio = new Audio();
  renderer.setTime(17.25);
  renderer.prepareMaterials();

  let timeOfDay = 17.25, firstPerson = false, walkToggle = false;
  let moveCmd = { dir: new THREE.Vector3(), gait: 'run', jump: false, aimYaw: null };
  const stats = { cpuMs: 0, physMs: 0, physSteps: 0, renderMs: 0, aiMs: 0, animMs: 0, bodies: 0, colliders: 0, npcs: npcs.length, vehicles: vehicles.length, texMB: null, renderer };

  // ------------------------------------------------------------ fixed-step control
  physics.onFixed((dt) => {
    for (const v of vehicles) v._preVel = v.body.linvel();
    player.fixedUpdate(dt, moveCmd);
    const t0 = performance.now();
    for (const n of npcs) {
      if (n.state !== 'loco') continue;
      const ai = n.ai;
      // simple sidewalk patrol with pauses; step aside from fast cars
      ai.wait -= dt;
      let dir = new THREE.Vector3(0, 0, ai.wait > 0 ? 0 : ai.dir);
      const p = n.position;
      if (p.z > 46) ai.dir = -1; if (p.z < -46) ai.dir = 1;
      if (ai.wait < -8 - Math.random() * 10) ai.wait = 1 + Math.random() * 3;
      for (const v of vehicles) {
        const rel = p.clone().sub(v.position); const vv = v.velocity;
        if (!ai.noDodge && vv.length() > 7 && rel.length() < 10 && rel.normalize().dot(vv.normalize()) > 0.7) { dir = new THREE.Vector3(1, 0, 0); ai.gait = 'sprint'; }
      }
      n.fixedUpdate(dt, { dir, gait: ai.gait, jump: false, aimYaw: null });
    }
    stats.aiMs = performance.now() - t0;
    // vehicle vs pedestrian: solver groups keep cars from stopping dead on people, which
    // also suppresses Rapier contact events, so test each moving car's footprint directly
    for (const v of vehicles) {
      const vel = v.velocity, sp = vel.length();
      if (sp < 1.5) continue;
      const inv = v.quaternion.invert(), vp = v.position, [W, , Lh] = v.H.dims;
      for (const c of [player, ...npcs]) {
        if (c.state !== 'loco' || (c === player && current)) continue;
        const local = c.position.sub(vp).applyQuaternion(inv);
        if (Math.abs(local.x) < W / 2 + 0.3 && Math.abs(local.z) < Lh / 2 + 0.3 && local.y > -1.2 && local.y < 1.2) {
          const lift = Math.min(4, sp * 0.3);
          c.knock(vel.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, lift, 0)));
          if (sp > 7) c.hurt(sp * 4, vel.clone().normalize());
          v.body.setLinvel({ x: vel.x * 0.94, y: vel.y, z: vel.z * 0.94 }, true);
          audio.punch();
        }
      }
    }
  });

  // vehicle ↔ pedestrian / lamp collisions
  physics.contactHandlers.push((h1, h2, started) => {
    if (!started) return;
    const a = physics.owner(h1), b = physics.owner(h2);
    const veh = a instanceof Vehicle ? a : b instanceof Vehicle ? b : null;
    const other = veh === a ? b : a;
    if (!veh || !other) return;
    const vel = veh.velocity;
    if (other?.kind === 'lamp' && other.prop && vel.length() > 3) {
      map.breakLamp(other.prop, veh._preVel || vel);
      const pv = veh._preVel || vel;
      veh.body.setLinvel({ x: pv.x * 0.7, y: pv.y, z: pv.z * 0.7 }, true);
      audio.crash(vel.length());
    }
  });
  // crash forces → deformation + damage
  physics.forceHandlers.push((e) => {
    const c1 = e.collider1(), c2 = e.collider2();
    for (const [h, sign] of [[c1, 1], [c2, -1]]) {
      const v = physics.owner(h);
      if (!(v instanceof Vehicle)) continue;
      const col1 = physics.world.getCollider(c1), col2 = physics.world.getCollider(c2);
      let point = null;
      physics.world.contactPair(col1, col2, (m) => { if (m.numSolverContacts() > 0) point = m.solverContactPoint(0); });
      if (!point) continue;
      const d = e.maxForceDirection();
      const mag = e.totalForceMagnitude() / 60;
      v.impact(new THREE.Vector3(point.x, point.y, point.z), new THREE.Vector3(d.x, d.y, d.z).multiplyScalar(sign), mag);
      if (v.driver === player) { cam.shake = Math.min(1, mag / (v.H.mass * 4)); audio.crash(mag / v.H.mass); }
    }
  });

  // ------------------------------------------------------------ vehicles: enter / exit
  let current = null;
  const enter = () => {
    let best = null, bd = 3.2;
    for (const v of vehicles) { const d = v.doorWorld().distanceTo(player.position); if (d < bd && !v.driver) { bd = d; best = v; } }
    if (!best) return;
    current = best; best.driver = player;
    player.state = 'seated'; player.visible = false; player.collider.setEnabled(false);
    cam.yaw = Math.atan2(best.forward.x, best.forward.z); cam.idleLook = 2;
    hint('');
  };
  const exit = () => {
    const v = current; if (!v) return;
    const spots = [v.doorWorld(), v.position.add(new THREE.Vector3(-(v.H.dims[0] / 2 + 0.6), 0, 0).applyQuaternion(v.quaternion))];
    const spot = spots[0];
    player.body.setTranslation({ x: spot.x, y: Math.max(0, spot.y) + player.halfH + player.radius + 0.1, z: spot.z }, true);
    player.collider.setEnabled(true);
    player.state = 'loco'; player.visible = true; player.speed = 0;
    player.facing = Math.atan2(v.forward.x, v.forward.z);
    v.driver = null; v.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    current = null;
    const sp = v.velocity.length();
    if (sp > 6) player.knock(v.velocity.multiplyScalar(0.9));
  };

  let hintText = '';
  const hint = (t) => { if (t !== hintText) { hintText = t; $('hint').textContent = t; $('hint').style.opacity = t ? 1 : 0; } };

  // ------------------------------------------------------------ pause / settings
  let paused = false;
  const setPaused = (p) => {
    paused = p; $('pause').hidden = !p; input.enabled = !p;
    if (p) { document.exitPointerLock?.(); audio.ctx?.suspend(); } else { audio.init(); audio.ctx?.resume(); $('view').requestPointerLock?.(); }
  };
  // Auto-pause only when a pointer lock we actually held is released (Esc). If the
  // browser refuses the lock, keep playing instead of pausing every frame.
  let hadLock = false;
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) { hadLock = true; return; }
    if (hadLock && !paused && started && !window.__fwNoAutoPause) setPaused(true);
    hadLock = false;
  });
  $('btnResume').onclick = () => setPaused(false);
  $('optTier').onchange = (e) => { localStorage.setItem('fw-tier', e.target.value); location.reload(); };
  $('optSens').value = input.sens;
  $('optSens').oninput = (e) => { input.sens = Number(e.target.value); localStorage.setItem('fw-sens', e.target.value); };

  let started = false;
  status('Ready — click to play', 1);
  $('loading').classList.add('ready');
  $('loading').onclick = () => { $('loading').hidden = true; started = true; input.enabled = true; audio.init(); $('view').requestPointerLock?.(); };
  window.__fw = { player, vehicles, npcs, cam, physics, renderer, map, input, get current() { return current; }, get paused() { return paused; }, get started() { return started; }, get moveCmd() { return moveCmd; }, enter, exit, charUrl: charAsset.url,
    advance(sec) { for (let t = 0; t < sec; t += 1 / 60) { tick(1 / 60, false); input.pressed.clear(); } } };

  // ------------------------------------------------------------ frame loop
  const timer = new THREE.Timer();
  let texT = 0;
  function frame() {
    requestAnimationFrame(frame);
    window.__frames = (window.__frames || 0) + 1;
    try { tick(); } catch (e) { window.__fwErr = (e && e.stack) || String(e); if (!window.__fwErrShown) { window.__fwErrShown = true; console.error(e); } }
  }
  // tick(simDt, render): the frame loop passes neither (real time + render); tests can
  // advance the simulation deterministically with __fw.advance() without a GPU.
  function tick(simDt, render = true) {
    let rawDt;
    if (simDt == null) { timer.update(); rawDt = timer.getDelta(); } else rawDt = simDt;
    const dt = Math.min(rawDt, 0.05);
    const c0 = performance.now();
    if (started && !paused) {
      if (input.hit('Escape')) setPaused(true);
      const look = input.look();
      cam.look(look.x, look.y);
      if (input.hit('F3')) overlay.toggle();
      if (input.hit('KeyV')) firstPerson = !firstPerson;
      if (input.hit('KeyQ')) cam.swapShoulder();
      if (input.wheel) cam.cycleDistance();
      if (input.hit('CapsLock', 'AltLeft')) walkToggle = !walkToggle;
      if (input.hit('KeyT')) timeOfDay = (timeOfDay + (input.down('ShiftLeft') ? -1 : 1) + 24) % 24;
      if (input.hit('KeyF', 'Enter')) { if (current) exit(); else if (player.state === 'loco') enter(); }
      if (input.hit('KeyH') && !current) player.knock(cam.flatForward.multiplyScalar(-5).add(new THREE.Vector3(0, 2, 0)));
      if (input.hit('KeyG') && !current) {
        // shove the nearest pedestrian
        const n = npcs.filter((n) => n.state === 'loco').sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
        if (n && n.position.distanceTo(player.position) < 1.8) { const d = n.position.sub(player.position).setY(0).normalize(); n.knock(d.multiplyScalar(input.down('ShiftLeft') ? 5 : 2.2)); player.speed *= 0.5; audio.punch(); }
      }
      cam.lookBehind = !!current && input.down('KeyC');
      const a = input.axis();
      if (current) {
        current.input = { throttle: Math.max(0, a.y), brake: Math.max(0, -a.y), steer: a.x, handbrake: input.down('Space') };
        if (input.hit('KeyE')) audio.horn();
        moveCmd = { dir: new THREE.Vector3(), gait: 'run', jump: false, aimYaw: null };
      } else {
        const dir = cam.flatForward.multiplyScalar(a.y).addScaledVector(cam.flatRight, a.x);
        const aiming = input.rmb;
        const gait = input.down('ShiftLeft', 'ShiftRight') && !aiming ? 'sprint' : walkToggle ? 'walk' : 'run';
        moveCmd = { dir, gait, jump: input.hit('Space'), aimYaw: aiming ? cam.yaw : null };
        const near = vehicles.find((v) => !v.driver && v.doorWorld().distanceTo(player.position) < 3.2);
        hint(near ? `Press F to enter the ${near.H.name}` : '');
      }
      cam.setState(firstPerson ? 'first' : current ? 'vehicle' : input.rmb ? 'aim' : moveCmd.gait === 'sprint' && player.speed > 5 ? 'sprint' : 'explore');
    }
    input.end();

    if (!paused) physics.update(started ? dt : 0);
    stats.physMs = physics.ms; stats.physSteps = physics.steps;
    const a0 = performance.now();
    for (const v of vehicles) v.sync(dt);
    if (current) player.body.setNextKinematicTranslation(current.position.add(new THREE.Vector3(0, -0.5, 0)));
    player.sync(dt);
    for (const n of npcs) n.sync(dt);
    stats.animMs = performance.now() - a0;
    map.update(renderer.night || 0);
    timeOfDay = (timeOfDay + dt / 120) % 24; // 1 game hour = 2 real minutes
    renderer.setTime(timeOfDay);

    const headPos = current ? current.seatWorld().add(new THREE.Vector3(0, 0.75, 0)) : player.position.add(new THREE.Vector3(0, 1.66, 0)).addScaledVector(cam.flatForward, 0.15);
    const camDist = cam.update(dt, { pos: player.position, vehicle: current, exclude: current ? current.collider : player.collider, headPos });
    player.root.visible = player.visible && !(firstPerson && !current) && camDist > 0.45;

    // HUD
    if (current) {
      $('hudVeh').hidden = false;
      $('spd').textContent = Math.round(Math.abs(current.speed) * 2.237);
      $('gear').textContent = current.speed < -0.5 && current.input.brake > 0 ? 'R' : current.gear;
      $('rpm').style.width = `${(current.rpm / current.H.redline) * 100}%`;
      $('vname').textContent = current.H.name;
      audio.update({ rpm: current.rpm / current.H.redline, throttle: current.input.throttle }, 0);
    } else { $('hudVeh').hidden = true; audio.update(null, 0); }
    $('clock').textContent = `${String(Math.floor(timeOfDay)).padStart(2, '0')}:${String(Math.floor((timeOfDay % 1) * 60)).padStart(2, '0')}`;

    stats.cpuMs = performance.now() - c0;
    if (!render) return;
    const r0 = performance.now();
    renderer.render();
    stats.renderMs = performance.now() - r0;
    renderer.adaptResolution(rawDt * 1000);
    texT -= dt;
    if (texT <= 0) {
      texT = 2;
      stats.bodies = physics.world.bodies.len(); stats.colliders = physics.world.colliders.len();
      const seen = new Set(); let bytes = 0;
      renderer.scene.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'emissiveMap', 'roughnessMap']) { const t = m[k]; if (t && !seen.has(t.source)) { seen.add(t.source); const im = t.image; if (im?.width) bytes += im.width * im.height * 4 * 1.33; } } });
      stats.texMB = bytes / 1048576;
    }
    overlay.update(rawDt, stats);
  }
  frame();
}

// Surface any startup failure on screen instead of leaving the loading bar hanging.
const showError = (msg) => { status('Could not start: ' + msg + '  — try another browser (Chrome/Edge) or reload.'); };
addEventListener('error', (e) => { if (!document.getElementById('loading').hidden) showError(e.message); });
addEventListener('unhandledrejection', (e) => { if (!document.getElementById('loading').hidden) showError(e.reason?.message || String(e.reason)); });
main().catch((e) => { showError(e.message); console.error(e); });
