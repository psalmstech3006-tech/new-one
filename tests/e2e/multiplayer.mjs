// Multiplayer against the real server: connection, visibility, interpolation, movement
// validation + teleport correction, approved teleports, remote vehicles, chat ranges,
// emotes, shoves + mirrored ragdoll, world clock, disconnect cleanup, reconnection,
// account persistence, flood resistance. Clients run in real time (no advance()).
import { openGame, sleep } from '../lib.mjs';

export default async function multiplayer(browser, url, R, ctx) {
  R.suite = 'multiplayer';
  const small = () => browser.newContext({ viewport: { width: 400, height: 225 } });
  const until = async (g, fn, arg, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g.ev(fn, arg)) return true; await sleep(250); } return false; };
  const A = await openGame(browser, url, { context: await small() });
  const B = await openGame(browser, url, { context: await small() });
  R.check('clients discover the same-origin server and connect', await until(A, () => __fw.net?.connected) && await until(B, () => __fw.net?.connected));
  const place = (g, x, z) => g.ev(([x, z]) => { const P = __fw.player; const y = 0.15 + P.halfH + P.radius + 0.06; P.body.setTranslation({ x, y, z }, true); P.body.setNextKinematicTranslation({ x, y, z }); __fw.net.send({ t: 'respawn' }); }, [x, z]);
  await place(A, -30, -53); await place(B, -34, -53); await sleep(1500);
  R.check('each client sees the other', await until(A, () => __fw.net.remotes.size === 1) && await until(B, () => __fw.net.remotes.size === 1));
  const bId = await B.ev(() => __fw.net.id), aId = await A.ev(() => __fw.net.id);
  R.check('remote player has a name tag', await B.ev(() => [...__fw.net.remotes.values()][0].char.root.children.some((o) => o.isSprite)));

  // --- interpolation: A walks, B's view of A follows closely and smoothly
  await A.ev(() => { __fw.cam.yaw = Math.PI / 2; __fw.input.keys.add('KeyW'); __fw.input.keys.add('ShiftLeft'); });
  const trail = [];
  for (let i = 0; i < 16; i++) {
    const [a, b] = await Promise.all([A.ev(() => __fw.player.position.toArray()), B.ev((id) => __fw.net.remotes.get(id)?.char.position.toArray(), aId)]);
    trail.push({ a, b }); await sleep(250);
  }
  await A.ev(() => __fw.input.keys.clear());
  const moved = Math.hypot(trail.at(-1).a[0] - trail[0].a[0], trail.at(-1).a[2] - trail[0].a[2]);
  const errs = trail.slice(4).map(({ a, b }) => b ? Math.hypot(a[0] - b[0], a[2] - b[2]) : 99);
  const jumps = trail.slice(1).map((t, i) => (t.b && trail[i].b ? Math.hypot(t.b[0] - trail[i].b[0], t.b[2] - trail[i].b[2]) : 0));
  R.check('A actually moved (real-time input)', moved > 1.0, moved.toFixed(2));
  R.check('remote position tracks the real one (< 2 m)', Math.max(...errs) < 2, errs.map((e) => e.toFixed(2)).join(' '));
  // B renders at ~1-2 FPS here, so compare each remote step with how far A really moved in
  // the surrounding second: the remote copy must never overshoot or teleport.
  const realStep = (i) => Math.hypot(trail[i].a[0] - trail[Math.max(0, i - 4)].a[0], trail[i].a[2] - trail[Math.max(0, i - 4)].a[2]);
  const overshoot = jumps.map((j, i) => j - realStep(i + 1));
  R.check('remote motion never jumps beyond the real motion', Math.max(...overshoot.slice(1)) < 1.0, overshoot.map((v) => v.toFixed(2)).join(' '));

  // --- movement validation: an unapproved 80 m jump is corrected; an approved one is not
  const before = await A.ev(() => __fw.player.position.toArray());
  await A.ev(() => { const P = __fw.player, t = P.body.translation(); P.body.setTranslation({ x: t.x + 80, y: t.y, z: t.z }, true); });
  await sleep(2000);
  const after = await A.ev(() => __fw.player.position.toArray());
  R.check('illegal teleport is corrected by the server', Math.hypot(after[0] - before[0], after[2] - before[2]) < 5, `${before.map((v) => v.toFixed(1))} -> ${after.map((v) => v.toFixed(1))}`);
  await place(A, -30, -40.5); await sleep(1500); // approved (respawn) teleport into the cafe area
  const kept = await A.ev(() => __fw.player.position.toArray());
  R.check('server-approved teleport is accepted', Math.abs(kept[2] - -40.5) < 1.5, kept.map((v) => v.toFixed(1)).join(','));
  await place(A, -30, -53); await sleep(1200);

  // --- chat ranges: nearby hears, far client does not; shout reaches further
  const C = await openGame(browser, url, { context: await small() });
  await until(C, () => __fw.net?.connected);
  await place(C, 40, -53); // 70 m away
  await sleep(1500);
  await A.ev(() => __fw.chat.onSend('hello there', false));
  await sleep(1200);
  const log = (g) => g.ev(() => document.querySelector('#chat .log').innerText);
  R.check('nearby player receives chat', /hello there/.test(await log(B)));
  R.check('far player does not receive normal chat', !/hello there/.test(await log(C)));
  await A.ev(() => __fw.chat.onSend('SHOUTING', true));
  await sleep(1200);
  R.check('shout reaches the 70 m player', /SHOUTING/.test(await log(C)));
  R.check('chat is escaped (no HTML injection)', await B.ev(() => { __fw.chat.add('x', '<img src=x onerror=alert(1)>'); return !document.querySelector('#chat img'); }));

  // --- emotes
  await A.ev(() => __fw.net.send({ t: 'emote', e: 'wave' }));
  R.check('emote reaches the other player', await until(B, (id) => __fw.net.remotes.get(id)?.emote?.e === 'wave', aId, 4000));

  // --- shove in range -> target ragdolls (and others see it); out of range -> ignored
  await place(B, -30.9, -53); await sleep(1200);
  await A.ev((id) => __fw.net.send({ t: 'shove', id, hard: true }), bId);
  R.check('in-range shove knocks the target down', await until(B, () => __fw.player.state === 'ragdoll', null, 4000));
  R.check('others see the target ragdoll', await until(A, (id) => __fw.net.remotes.get(id)?.char.state === 'ragdoll', bId, 5000));
  await B.adv(8); // ~2 FPS software rendering: advance the knocked-down client's simulation
  R.check('target recovers', await until(B, () => __fw.player.state === 'loco', null, 12000));
  R.check('remote copy recovers too', await until(A, (id) => __fw.net.remotes.get(id)?.char.state === 'loco', bId, 6000));
  await place(B, -20, -53); await sleep(1200);
  await A.ev((id) => __fw.net.send({ t: 'shove', id, hard: true }), bId);
  await sleep(1500);
  R.check('out-of-range shove is rejected by the server', await B.ev(() => __fw.player.state === 'loco'));

  // --- remote vehicle: B sees A's car (same model + colour), removed after A exits
  const car = await A.ev(() => { const F = __fw, v = F.vehicles.slice().sort((p, q) => p.position.distanceTo(F.player.position) - q.position.distanceTo(F.player.position))[0]; const d = v.doorWorld(); const P = F.player; P.body.setTranslation({ x: d.x, y: d.y + 1, z: d.z }, true); F.net.send({ t: 'respawn' }); return { type: v.type, color: v.color }; });
  await sleep(800);
  await A.ev(() => { __fw.enter(); __fw.input.keys.add('KeyW'); });
  R.check('remote vehicle appears for the other player', await until(B, ([id, t]) => __fw.net.remotes.get(id)?.vehicle?.type === t, [aId, car.type], 8000));
  await sleep(2000);
  const vErr = await Promise.all([A.ev(() => __fw.current.position.toArray()), B.ev((id) => __fw.net.remotes.get(id)?.vehicle?.position.toArray(), aId)]);
  R.check('remote vehicle follows the driver', vErr[1] && Math.hypot(vErr[0][0] - vErr[1][0], vErr[0][2] - vErr[1][2]) < 4, JSON.stringify(vErr.map((v) => v?.map((x) => x.toFixed(1)))));
  R.check('remote vehicle keeps the colour', await B.ev(([id, c]) => __fw.net.remotes.get(id)?.vehicle?.color === c, [aId, car.color]));
  const bodiesWithCar = await B.ev(() => __fw.physics.world.bodies.len());
  await A.ev(() => { __fw.input.keys.clear(); __fw.input.keys.add('Space'); });
  await sleep(1500);
  await A.ev(() => { __fw.input.keys.clear(); __fw.exit(); });
  R.check('remote vehicle removed when the driver gets out', await until(B, (id) => !__fw.net.remotes.get(id)?.vehicle, aId, 6000));
  R.check('remote vehicle physics body cleaned up', (await B.ev(() => __fw.physics.world.bodies.len())) < bodiesWithCar);

  // --- world clock
  await sleep(500);
  const [ha, hb] = await Promise.all([A.ev(() => __fw.time), B.ev(() => __fw.time)]);
  const srv = (await (await fetch(url + 'health')).json()).hour;
  R.check('world clock is shared (within 1 game minute)', Math.abs(ha - hb) < 1 / 60 && Math.abs(ha - srv) < 1 / 60, `${ha.toFixed(3)} / ${hb.toFixed(3)} / server ${srv.toFixed(3)}`);

  // --- disconnect cleanup: C leaves, A and B drop it (entity + physics)
  const aBodies = await A.ev(() => __fw.physics.world.bodies.len());
  await C.ctx.close();
  R.check('players drop a disconnected client', await until(A, () => __fw.net.remotes.size === 1) && await until(B, () => __fw.net.remotes.size === 1));
  R.check('disconnected player physics removed', (await A.ev(() => __fw.physics.world.bodies.len())) < aBodies);

  // --- flood resistance: server survives a burst and keeps the client connected
  await A.ev(() => { for (let i = 0; i < 400; i++) __fw.net.send({ t: 'chat', text: 'spam' + i }); __fw.net.send({ t: 'nonsense', x: 1 }); __fw.net.ws.send('{bad json'); });
  await sleep(1500);
  R.check('server survives floods/garbage and the client stays connected', await A.ev(() => __fw.net.connected) && (await (await fetch(url + 'health')).json()).ok);

  // --- reconnection + account persistence across a server restart
  const nameA = await A.ev(() => __fw.net.name);
  await ctx.restartServer(2500);
  R.check('clients show offline status while the server is down, then reconnect', await until(A, () => __fw.net.connected, null, 20000) && await until(B, () => __fw.net.connected, null, 20000));
  R.check('same account (name) after reconnecting', (await A.ev(() => __fw.net.name)) === nameA, nameA);
  await place(A, -30, -53); await place(B, -32, -53);
  R.check('players see each other again after reconnecting', await until(A, () => __fw.net.remotes.size === 1, null, 10000) && await until(B, () => __fw.net.remotes.size === 1, null, 10000));
  R.check('no duplicate ping timers after reconnect', await A.ev(() => typeof __fw.net.pingTimer !== 'undefined'));
  R.check('no console errors', A.errors.length + B.errors.length === 0, [...A.errors, ...B.errors].slice(0, 3).join(' | '));
  await A.ctx.close(); await B.ctx.close();
}
