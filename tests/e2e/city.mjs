// Buildings: doors, locks, keys, interiors, elevators, streaming/freeing (+ leak check),
// interaction prompts, building + vehicle collision, vehicle camera near walls.
import { openGame, dist } from '../lib.mjs';

export default async function city(browser, url, R) {
  R.suite = 'city';
  const g = await openGame(browser, url + '?server=off');
  const info = await g.ev(() => ({ b: __fw.map.buildings.length, e: __fw.city.enterable.length, d: __fw.city.doors.doors.length }));
  R.check('district built', info.b >= 40 && info.e >= 12, JSON.stringify(info));

  // helper in page: stand in front of a door (outside), facing it
  const atDoor = (label, side = 1.1) => g.ev(([label, side]) => {
    const F = __fw, d = F.city.doors.doors.find((q) => q.label === label && q.interactive);
    if (!d) return null;
    const t = d.center.clone().addScaledVector(d.normal, side);
    const y = t.y - 1.1 + F.player.halfH + F.player.radius + 0.06;
    F.player.body.setTranslation({ x: t.x, y, z: t.z }, true); F.player.body.setNextKinematicTranslation({ x: t.x, y, z: t.z });
    F.cam.yaw = Math.atan2(-d.normal.x * Math.sign(side), -d.normal.z * Math.sign(side)); F.player.facing = F.cam.yaw;
    F.advance(0.4);
    return { open: d.open, locked: d.locked };
  }, [label, side]);
  const doorState = (label) => g.ev((l) => { const d = __fw.city.doors.doors.find((q) => q.label === l); return d && { open: +d.open.toFixed(2), target: d.target, locked: d.locked }; }, label);
  const where = () => g.ev(() => __fw.city.inside ? `${__fw.city.inside.b.meta.name}/${__fw.city.inside.vol.name}` : 'outside');
  const walk = async (sec, keys = ['KeyW']) => { await g.hold(keys); await g.adv(sec); await g.hold([]); await g.adv(0.2); };

  // --- unlocked shop door: prompt, open, walk in, interior detection, auto-close
  await atDoor('BEAN THERE CAFE');
  R.check('door prompt shown', /E: open BEAN THERE CAFE/.test(await g.hint()), await g.hint());
  await g.press('KeyE'); await g.adv(1.2);
  R.check('door opens with E', (await doorState('BEAN THERE CAFE')).open === 1);
  await walk(2.2);
  R.check('walk through open door into interior', /BEAN THERE CAFE/.test(await where()), await where());
  R.check('camera switches to interior mode', await g.ev(() => __fw.cam.state === 'interior'));
  const acts = await g.ev(() => { const a = __fw.city.nearestAct(__fw.player.position); return a?.a.type; });
  await g.ev(() => { const F = __fw, inn = [...F.city.built.values()].find((q) => q.b?.meta?.name === F.city.inside?.b.meta.name); const a = inn.interactables.find((x) => x.type === 'shop'); const w = F.city.world(inn.b, a.x, 0.3, a.z); F.player.body.setTranslation({ x: w.x, y: w.y + 1, z: w.z }, true); F.advance(0.4); });
  R.check('interaction prompt at shop counter', /counter|Cafe/i.test(await g.hint()), await g.hint());
  // walk away: the door auto-closes
  await g.ev(() => { __fw.player.body.setTranslation({ x: -38, y: 1.2, z: -60 }, true); });
  await g.adv(8);
  R.check('door auto-closes when the player leaves', (await doorState('BEAN THERE CAFE')).target === 0 && (await doorState('BEAN THERE CAFE')).open === 0);

  // --- closed door blocks movement
  await atDoor('BEAN THERE CAFE', 1.0);
  const p0 = await g.pos(); await walk(2.5); const p1 = await g.pos();
  R.check('closed door blocks the player', !/BEAN/.test(await where()) && dist(p0, p1) < 1.2, `moved ${dist(p0, p1).toFixed(2)} m, ${await where()}`);

  // --- locked door without key
  // go to the police station so the streamer builds its interior (it frees interiors > 90 m away)
  await g.ev(() => { const b = __fw.map.police; __fw.player.body.setTranslation({ x: b.x - 16, y: 1.2, z: b.z }, true); });
  await g.adv(1.5);
  await atDoor('Secure area', 1.0);
  await g.press('KeyE'); await g.adv(0.3);
  R.check('locked door refuses without key', /locked/i.test(await g.hint()) && (await doorState('Secure area')).locked, await g.hint());
  const q0 = await g.pos(); await walk(2); const q1 = await g.pos();
  R.check('locked door blocks the player', dist(q0, q1) < 1.2, dist(q0, q1).toFixed(2));

  // --- keys: home door unlocks with the player's key, K re-locks it
  const homeLabel = await g.ev(() => __fw.map.home.doors[0].label || 'Home');
  await atDoor(homeLabel, 1.1);
  R.check('home door offers unlock with key', /unlock/i.test(await g.hint()), await g.hint());
  await g.press('KeyE'); await g.adv(1.2);
  R.check('home door unlocked and opened', (await doorState(homeLabel)).open === 1 && !(await doorState(homeLabel)).locked);
  await walk(2);
  R.check('entered home', /Home/.test(await where()), await where());
  await walk(2, ['KeyS']); await g.adv(0.3);
  await atDoor(homeLabel, 1.1);
  await g.press('KeyE'); await g.adv(1.5);
  await g.press('KeyK'); await g.adv(0.3);
  R.check('K locks the closed door with key', (await doorState(homeLabel)).locked, await g.hint());
  await g.ev(() => __fw.player.keys.delete('key_Home'));
  await g.press('KeyE'); await g.adv(0.3);
  R.check('without the key it stays locked', (await doorState(homeLabel)).locked && /locked/i.test(await g.hint()));
  await g.ev(() => __fw.player.keys.add('key_Home'));

  // --- elevator (office low-rise) both directions
  const el = await g.ev(() => { const F = __fw, b = F.map.office; F.city.build(b); const inn = F.city.built.get(b.id); const a = inn.interactables.find((x) => x.type === 'elevator'); const w = F.city.world(b, a.dx, a.stops[0], a.dz); F.player.body.setTranslation({ x: w.x, y: w.y + 1.0, z: w.z }, true); return a.stops; });
  await g.adv(0.5);
  R.check('elevator prompt', /elevator to floor 2/.test(await g.hint()), await g.hint());
  await g.press('KeyE'); await g.adv(1.0);
  const up = await g.ev(() => ({ y: __fw.player.position.y, where: __fw.city.inside?.vol.name, bld: __fw.city.inside?.b.meta.name, grounded: __fw.player.grounded, vols: [...__fw.city.built.values()].filter((q) => !q.empty).map((q) => q.b.meta.name + ':' + q.volumes.map((v) => v.name + '[' + v.y0.toFixed(1) + ',' + v.y1.toFixed(1) + ']').join(',')) }));
  R.check('elevator ride up lands on floor 2', up.y > el[1] && up.where === 'floor2' && up.grounded, JSON.stringify(up));
  await g.adv(0.3); await g.press('KeyE'); await g.adv(1.0);
  const down = await g.ev(() => __fw.player.position.y);
  R.check('elevator ride back down', down < 1, down.toFixed(2));

  // --- stairs in the apartment lobby lead to Apt 201
  const st = await g.ev(() => { const F = __fw, b = F.map.buildings.find((q) => q.meta?.interior === 'apartmentLobby'); F.city.build(b); const w = F.city.world(b, 3.1, 0.3, b.footprint[1] / 2 - 0.28 - 2.0); F.player.body.setTranslation({ x: w.x, y: w.y + 1, z: w.z }, true); const c = Math.cos(b.rot), s = Math.sin(b.rot); F.cam.yaw = Math.atan2(-s, -c); return b.meta.name; });
  await g.adv(0.3); await walk(6);
  const sy = await g.ev(() => __fw.player.position.y - 0.15);
  R.check('stairs climb to the first floor', sy > 3.2, `${st} height ${sy.toFixed(2)}`);

  // --- building collision: running into a solid wall and a window never passes through
  const wallRes = await g.ev(() => {
    const F = __fw, out = [];
    for (const b of F.map.buildings.filter((q) => !q.meta?.interior).slice(0, 6)) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), lz = b.footprint[1] / 2 + 1.5, x = b.x + 2 * c + lz * s, z = b.z - 2 * s + lz * c;
      const q = F.physics.freeSpot({ x, y: b.y + 1.1, z }, F.player.halfH, F.player.radius, (4 << 16) | 1);
      F.player.body.setTranslation(q, true); F.player.body.setNextKinematicTranslation(q);
      F.cam.yaw = Math.atan2(-s, -c);
      F.input.keys.clear(); F.input.keys.add('KeyW'); F.input.keys.add('ShiftLeft'); F.advance(3); F.input.keys.clear(); F.advance(0.2);
      const p = F.player.position, depth = (p.x - b.x) * s + (p.z - b.z) * c;
      out.push(depth > b.footprint[1] / 2 - 0.05);
    }
    return out;
  });
  R.check('sprinting into facades never enters solid buildings', wallRes.every(Boolean), JSON.stringify(wallRes));

  // --- vehicle collision + vehicle camera near buildings
  const car = await g.ev(() => {
    const F = __fw, b = F.map.buildings.find((q) => q.meta?.family === 'warehouse'), v = F.vehicles[F.vehicles.length - 1];
    const c = Math.cos(b.rot), s = Math.sin(b.rot), lz = b.footprint[1] / 2 + 14;
    const x = b.x + lz * s, z = b.z + lz * c, yaw = Math.atan2(-s, -c);
    v.body.setTranslation({ x, y: 1, z }, true); v.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true); v.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const d = v.doorWorld(); F.player.body.setTranslation({ x: d.x, y: d.y + 1, z: d.z }, true); F.advance(0.3); F.enter();
    F.input.keys.add('KeyW'); let camIn = 0;
    for (let t = 0; t < 6; t += 0.25) { F.advance(0.25); if (F.physics.pointInside(F.renderer.camera.position, (4 << 16) | 1, v.collider)) camIn++; }
    F.input.keys.clear(); F.advance(1);
    const p = v.position, depth = (p.x - b.x) * s + (p.z - b.z) * c;
    const r = { outside: depth > b.footprint[1] / 2, camIn, speed: v.speed };
    F.exit(); F.advance(0.5);
    return r;
  });
  R.check('car driven into a building is stopped by it', car.outside, JSON.stringify(car));
  R.check('vehicle camera never inside buildings', car.camIn === 0, JSON.stringify(car));

  // --- streaming: interiors are built near and freed far away; no geometry/body leak over cycles
  const leak = await g.ev(async () => {
    const F = __fw, gl = F.renderer.gl, snap = () => ({ geo: gl.info.memory.geometries, bodies: F.physics.world.bodies.len(), cols: F.physics.world.colliders.len(), doors: F.city.doors.doors.length, built: F.city.built.size });
    const go = (x, z) => { F.player.body.setTranslation({ x, y: 1.2, z }, true); F.player.body.setNextKinematicTranslation({ x, y: 1.2, z }); };
    const cycle = () => { go(-38, -56); for (let i = 0; i < 20; i++) F.advance(0.1); go(260, 110); for (let i = 0; i < 20; i++) F.advance(0.1); };
    cycle(); F.renderer.render(); const a = snap();
    for (let k = 0; k < 4; k++) cycle();
    F.renderer.render(); const b = snap();
    go(-38, -56); for (let i = 0; i < 20; i++) F.advance(0.1); const near = F.city.built.size;
    return { a, b, near };
  });
  R.check('interiors stream in near the player', leak.near >= 3, JSON.stringify(leak.near));
  R.check('interiors are freed far away', leak.a.built <= 2, JSON.stringify(leak.a));
  R.check('no leak across stream cycles (bodies/colliders/doors/geometries)', leak.b.bodies <= leak.a.bodies + 2 && leak.b.cols <= leak.a.cols + 4 && leak.b.doors === leak.a.doors && leak.b.geo <= leak.a.geo + 10, JSON.stringify(leak));
  R.check('no console errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.ctx.close();
}
