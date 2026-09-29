import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initPhysics, Physics, R } from './physics.js';
import { Renderer, TIERS } from './render.js';
import { TestMap } from './testmap.js';
import { District } from './city/district.js';
import { CityRuntime } from './city/runtime.js';
import { Character } from './character.js';
import { Vehicle } from './vehicle.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { DevOverlay } from './overlay.js';
import { Audio } from '../audio.js';
import { loadTextures } from '../assets.js';
import { buildAvatar, randomDNA, defaultDNA } from './people/avatar.js';
import { Creator, loadDNA } from './people/creator.js';
import { Net, resolveServer } from './net/client.js';
import { Chat } from './net/chat.js';
import { Voice } from './net/voice.js';
import { Population } from './people/population.js';
import { Conversations } from './people/conversation.js';

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
  return buildAvatar(loadDNA() || defaultDNA());
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
  const useTest = new URLSearchParams(location.search).get('map') === 'test';
  status(useTest ? 'Building proving ground' : 'Building Harbor Heights', 0.35);
  await new Promise((r) => setTimeout(r, 30));
  let map;
  if (useTest) { map = new TestMap(game, tex); map.placeModelProps(props); }
  else map = new District(game, tex, { props });
  const city = useTest ? null : new CityRuntime(game, map, tierName);
  status('Loading character', 0.5);
  const charAsset = await loadCharacter();
  status('Spawning', 0.8);

  const player = new Character(game, charAsset, map.spawns.player, { player: true, facing: map.spawns.playerFacing ?? Math.PI });
  // key ring: your home and your apartment (property ownership grants keys in the economy phase)
  player.keys = new Set(['key_Home', 'key_apt_201']);
  // generated sedan when available (falls back to the procedural sedan)
  // procedural placeholders are swapped for generated models when those loaded
  const GEN = { sedan: ['meridian', 'fw_veh_sedan_meridian'], coupe: ['vento', 'fw_veh_coupe_vento'], suv: ['ridgeback', 'fw_veh_suv_ridgeback'], patrol: ['patrol', 'fw_veh_sedan_meridian'] };
  const pick = (t) => (GEN[t] && game.models[GEN[t][1]] ? GEN[t][0] : t === 'patrol' ? 'sedan' : t);
  const vehicles = map.spawns.cars.map(([t, p, h, c]) => new Vehicle(game, pick(t), p, h, c || '#1f3f66'));
  // city: scheduled residents with simulation tiers; proving ground: simple patrol walkers
  const population = city ? new Population(game, map, tierName, { budget: renderer.tier.peds + 4 }) : null;
  if (population) population.doors = city.doors;
  // NPC conversations are text-only and client-local; they read the simulation, never drive it
  const conv = population ? new Conversations({
    population, district: map, player, getHour: () => timeOfDay,
    onOpen: () => { input.enabled = false; document.exitPointerLock?.(); },
    onClose: () => { input.enabled = true; $('view').requestPointerLock?.(); },
  }) : null;
  const npcs = population ? population.chars : map.spawns.peds.slice(0, renderer.tier.peds).map((sp, i) => {
    const p = sp.pos || sp;
    const n = new Character(game, buildAvatar(randomDNA(7000 + i, { role: i % 11 === 5 ? 'worker' : 'civilian' })), p, { facing: i % 2 ? 0 : Math.PI });
    n.ai = { dir: sp.dir ?? (i % 2 ? 1 : -1), wait: Math.random() * 3, gait: Math.random() < 0.85 ? 'walk' : 'run' };
    if (sp.ring != null) { n.ai.ring = map.pedRings[sp.ring]; n.ai.next = sp.dir > 0 ? (sp.seg + 1) % 4 : sp.seg; }
    return n;
  });
  const cam = new CameraRig(renderer.camera, physics);
  cam.yaw = player.facing;
  const input = new Input($('view'));
  input.sens = Number(localStorage.getItem('fw-sens') || 1);
  const overlay = new DevOverlay();
  const creator = new Creator({
    onChange: (asset) => player.setModel(asset),
    onClose: () => { input.enabled = true; $('view').requestPointerLock?.(); },
    onSave: (dna) => net?.send({ t: 'dna', dna }),
  });
  const openCreator = () => { if (current || player.state !== 'loco') return; creator.show(); input.enabled = false; document.exitPointerLock?.(); };
  const audio = new Audio();
  renderer.setTime(17.25);
  renderer.prepareMaterials();

  let timeOfDay = 17.25, firstPerson = false, walkToggle = false, cullT = 0;
  let moveCmd = { dir: new THREE.Vector3(), gait: 'run', jump: false, aimYaw: null };
  const stats = { cpuMs: 0, physMs: 0, physSteps: 0, renderMs: 0, aiMs: 0, animMs: 0, bodies: 0, colliders: 0, npcs: npcs.length, vehicles: vehicles.length, texMB: null, renderer };
  // ---- multiplayer (only when a server is configured: ?server=host:port, or served by the game server)
  let localEmote = null;
  const url = await resolveServer();
  const chat = new Chat({ onSend: (text, shout) => net?.send({ t: 'chat', text, shout }), onOpen: () => { input.enabled = false; }, onClose: () => { input.enabled = true; } });
  const net = url ? new Net(url, {
    game, player, dna: player.asset.dna || loadDNA(),
    getLocal: () => {
      if (current) { const t = current.position, q = current.quaternion; return { x: t.x, y: t.y, z: t.z, f: Math.atan2(current.forward.x, current.forward.z), sp: current.speed, st: 'drive', v: { k: current.type, c: current.color, q: [q.x, q.y, q.z, q.w] } }; }
      const p = player.focus; return { x: p.x, y: p.y, z: p.z, f: player.facing, sp: player.speed, st: player.state, e: localEmote?.e || '' };
    },
    onChat: (m) => chat.add(m.name, m.text, m.shout),
    onShoved: (m) => { if (!current && player.state === 'loco') { player.knock(new THREE.Vector3(m.vx, 1.2, m.vz)); audio.punch(); } },
    onStatus: (t) => { stats.net = t; chat.status(t); },
    onHour: (h) => { if (Math.abs(((h - timeOfDay + 36) % 24) - 12) < 11.9) timeOfDay = h; },
  }) : null;
  if (city && net) city.onTeleport = () => net.send({ t: 'respawn' });
  if (net) player.onTeleport = () => net.send({ t: 'respawn' });
  const voice = net ? new Voice(net, { camera: renderer.camera, hud: $('voice') }) : null;
  if (net) { net.voice = voice; $('voice').hidden = false; $('voice').onclick = () => voice.toggle(); }

  // ------------------------------------------------------------ fixed-step control
  physics.onFixed((dt) => {
    for (const v of vehicles) v._preVel = v.body.linvel();
    player.fixedUpdate(dt, moveCmd);
    const t0 = performance.now();
    if (population) population.fixed(dt, vehicles, player);
    else for (const n of npcs) {
      if (n.state !== 'loco') continue;
      const ai = n.ai;
      // sidewalk loops around the blocks (city) or a straight patrol (proving ground),
      // with pauses; step aside from fast cars
      ai.wait -= dt;
      const p = n.position;
      let dir;
      if (ai.ring) {
        const t = ai.ring[ai.next], to = new THREE.Vector3(t[0] - p.x, 0, t[1] - p.z);
        if (to.length() < 1.0) ai.next = (ai.next + ai.dir + 4) % 4;
        dir = ai.wait > 0 ? new THREE.Vector3() : to.normalize();
      } else {
        dir = new THREE.Vector3(0, 0, ai.wait > 0 ? 0 : ai.dir);
        if (p.z > 46) ai.dir = -1; if (p.z < -46) ai.dir = 1;
      }
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
        if (c.state !== 'loco' || c.inactive || (c === player && current)) continue;
        const local = c.position.sub(vp).applyQuaternion(inv);
        if (Math.abs(local.x) < W / 2 + 0.3 && Math.abs(local.z) < Lh / 2 + 0.3 && local.y > -1.2 && local.y < 1.2) {
          const lift = Math.min(4, sp * 0.3);
          c.knock(vel.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, lift, 0)));
          population?.panic(c.position, 22);
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
    if (hadLock && !paused && started && !window.__fwNoAutoPause && !creator.open && !chat.isOpen && !conv?.active) setPaused(true);
    hadLock = false;
  });
  $('btnResume').onclick = () => setPaused(false);
  if ($('btnChar')) $('btnChar').onclick = () => { setPaused(false); openCreator(); };
  $('optTier').onchange = (e) => { localStorage.setItem('fw-tier', e.target.value); location.reload(); };
  $('optSens').value = input.sens;
  $('optSens').oninput = (e) => { input.sens = Number(e.target.value); localStorage.setItem('fw-sens', e.target.value); };

  let started = false;
  status('Ready — click to play', 1);
  $('loading').classList.add('ready');
  $('loading').onclick = () => { $('loading').hidden = true; started = true; input.enabled = true; audio.init(); voice?.unlock(); $('view').requestPointerLock?.(); };
  window.__fw = { get time() { return timeOfDay; }, get voice() { return voice; }, conv, THREE, player, vehicles, npcs, population, cam, physics, renderer, map, city, input, creator, openCreator, get net() { return net; }, chat, get current() { return current; }, get paused() { return paused; }, get started() { return started; }, get moveCmd() { return moveCmd; }, enter, exit, charUrl: charAsset.url,
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
      if (input.hit('KeyP')) openCreator();
      if (input.hit('KeyY') && net) chat.open();
      if (input.hit('KeyM') && voice) voice.toggle();
      if (input.hit('KeyX') && !current) { localEmote = { e: input.down('ShiftLeft') ? 'cheer' : 'wave', t: 2.5 }; net?.send({ t: 'emote', e: localEmote.e }); }
      if (input.hit('KeyV')) firstPerson = !firstPerson;
      if (input.hit('KeyQ')) cam.swapShoulder();
      if (input.wheel) cam.cycleDistance();
      if (input.hit('CapsLock', 'AltLeft')) walkToggle = !walkToggle;
      if (input.hit('KeyT')) timeOfDay = (timeOfDay + (input.down('ShiftLeft') ? -1 : 1) + 24) % 24;
      if (input.hit('KeyF', 'Enter')) { if (current) exit(); else if (player.state === 'loco') enter(); }
      if (input.hit('KeyH') && !current) player.knock(cam.flatForward.multiplyScalar(-5).add(new THREE.Vector3(0, 2, 0)));
      if (input.hit('KeyG') && !current) {
        // shove the nearest pedestrian
        const n = npcs.filter((n) => n.state === 'loco' && !n.inactive).sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
        const rp = net?.nearestRemote(player.position);
        if (rp && (!n || rp.char.position.distanceTo(player.position) < n.position.distanceTo(player.position))) { net.send({ t: 'shove', id: rp.id, hard: input.down('ShiftLeft') }); player.speed *= 0.5; audio.punch(); }
        else if (n && n.position.distanceTo(player.position) < 1.8) { const d = n.position.sub(player.position).setY(0).normalize(); n.knock(d.multiplyScalar(input.down('ShiftLeft') ? 5 : 2.2)); player.speed *= 0.5; audio.punch(); population?.panic(n.position, 14); }
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
        const cityHint = city ? city.interact(player, { use: input.hit('KeyE'), lock: input.hit('KeyK') }) : '';
        let talkHint = '';
        if (!cityHint && conv && !conv.active) { const c = conv.candidate(); if (c) { talkHint = conv.prompt(c); if (input.hit('KeyE')) conv.start(c); } }
        hint(cityHint || talkHint || (near ? `Press F to enter the ${near.H.name}` : ''));
      }
      cam.setState(firstPerson ? 'first' : current ? 'vehicle' : input.rmb ? 'aim' : city?.inside ? 'interior' : moveCmd.gait === 'sprint' && player.speed > 5 ? 'sprint' : 'explore');
    }
    input.end();

    if (!paused) physics.update(started ? dt : 0);
    stats.physMs = physics.ms; stats.physSteps = physics.steps;
    const a0 = performance.now();
    for (const v of vehicles) v.sync(dt);
    if (current) player.body.setNextKinematicTranslation(current.position.add(new THREE.Vector3(0, -0.5, 0)));
    player.sync(dt);
    if (localEmote) { localEmote.t -= dt; if (net) net.animateEmote(player, localEmote); if (localEmote.t <= 0) localEmote = null; }
    if (net) { net.update(dt); stats.remote = net.remotes.size; stats.rtt = net.rtt; }
    if (voice && render) { voice.update(dt, net.remotes, (current ? current.position : player.position)); stats.voice = `${voice.state}, ${voice.peers.size} peers`; }
    for (const n of npcs) if (!n.inactive) n.sync(dt);
    conv?.update();
    if (population) { population.update(dt, timeOfDay, current ? current.position : player.position); population.aware(player); stats.npcs = `${population.stats.embodied} embodied / ${population.stats.outdoors} outdoors / ${population.stats.residents} residents`; }
    stats.animMs = performance.now() - a0;
    map.update(renderer.night || 0);
    if (city) { city.update(dt, current ? current.position : player.position); stats.city = city.stats; }
    // distance budget: far characters/props are hidden, only nearby ones cast shadows
    cullT -= dt;
    if (cullT <= 0 && render) {
      cullT = 0.25;
      const cp = renderer.camera.position, shadowR = renderer.tier.shadows ? (renderer.tierName === 'high' ? 45 : 30) : 0;
      for (const c of npcs) { const d = c.root.position.distanceTo(cp); c.model.visible = d < renderer.tier.far * 0.35; if (c.shadowOn !== d < shadowR) { c.shadowOn = d < shadowR; c.model.traverse((o) => { if (o.isMesh) o.castShadow = c.shadowOn; }); } }
      for (const pr of map.props) { if (!pr.mesh) continue; const d = pr.mesh.position.distanceTo(cp); pr.mesh.visible = d < renderer.tier.far * 0.4; const sh = d < shadowR + 10; if (pr.shadowOn !== sh) { pr.shadowOn = sh; pr.mesh.traverse((o) => { if (o.isMesh) o.castShadow = sh; }); } }
    }
    timeOfDay = (timeOfDay + dt / 120) % 24; // 1 game hour = 2 real minutes
    renderer.setTime(timeOfDay);

    const headPos = current ? current.seatWorld().add(new THREE.Vector3(0, 0.75, 0)) : player.position.add(new THREE.Vector3(0, 1.66, 0)).addScaledVector(cam.flatForward, 0.15);
    let camDist = 5;
    if (creator.open) { const f = new THREE.Vector3(Math.sin(player.facing), 0, Math.cos(player.facing)), pp = player.position; renderer.camera.position.copy(pp).addScaledVector(f, 2.6).add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(new THREE.Vector3(f.z, 0, -f.x), -0.7); renderer.camera.lookAt(pp.x, pp.y + 1.0, pp.z); }
    else if (window.__fwCamOverride) { const o = window.__fwCamOverride; renderer.camera.position.set(o[0], o[1], o[2]); renderer.camera.lookAt(o[3], o[4], o[5]); }
    else camDist = cam.update(dt, { pos: player.focus, vehicle: current, exclude: current ? current.collider : player.collider, headPos });
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
    if (city && $('street')) { const where = city.inside ? city.inside.b.meta.name : map.streetAt(current ? current.position : player.position); if ($('street').textContent !== where) $('street').textContent = where; }
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
