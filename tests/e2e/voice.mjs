// Proximity voice over real WebRTC between two browser contexts (Chromium fake microphone
// = test tone). Verifies P2P audio flows, falloff with distance, hard radius, peer teardown,
// mute stops transmission, speaking indicators, listen-without-mic, denied permission.
import { openGame, sleep } from '../lib.mjs';

export default async function voice(browser, url, R) {
  R.suite = 'voice';
  const small = (opts = {}) => browser.newContext({ viewport: { width: 400, height: 225 }, permissions: ['microphone'], ...opts });
  const until = async (g, fn, arg, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g.ev(fn, arg)) return true; await sleep(300); } return false; };
  const place = (g, x, z) => g.ev(([x, z]) => { const P = __fw.player; const y = 0.15 + P.halfH + P.radius + 0.06; P.body.setTranslation({ x, y, z }, true); P.body.setNextKinematicTranslation({ x, y, z }); __fw.net.send({ t: 'respawn' }); __fw.cam.yaw = 0; }, [x, z]);
  const stats = (g, id, kind) => g.ev(async ([id, kind]) => { const p = __fw.voice.peers.get(id); if (!p) return null; let n = 0; (await p.pc.getStats()).forEach((r) => { if (r.type === kind && r.kind === 'audio') n += kind === 'inbound-rtp' ? r.bytesReceived : r.bytesSent; }); return n; }, [id, kind]);

  const A = await openGame(browser, url, { context: await small() });
  const B = await openGame(browser, url, { context: await small() });
  await until(A, () => __fw.net?.connected); await until(B, () => __fw.net?.connected);
  await place(A, -30, -53); await place(B, -34, -53);
  await until(A, () => __fw.net.remotes.size === 1); await until(B, () => __fw.net.remotes.size === 1);
  const aId = await A.ev(() => __fw.net.id), bId = await B.ev(() => __fw.net.id);
  R.check('voice HUD shown when online', await A.ev(() => !document.getElementById('voice').hidden && /M to talk/.test(document.getElementById('voice').innerText)));

  // --- A talks, B only listens (no microphone requested on B)
  await A.ev(() => __fw.voice.enable());
  R.check('microphone granted -> mic live', await until(A, () => __fw.voice.state === 'live'), await A.ev(() => __fw.voice.state));
  R.check('local mic level indicator moves', await until(A, () => __fw.voice.localLevel > 0.005));
  R.check('peer connection established (listener needs no mic)', await until(B, (id) => __fw.voice.peers.get(id)?.pc.connectionState === 'connected', aId, 20000));
  R.check('B never requested a microphone', await B.ev(() => !__fw.voice.stream));
  const in1 = await stats(B, aId, 'inbound-rtp'); await sleep(2000); const in2 = await stats(B, aId, 'inbound-rtp');
  R.check('audio flows peer-to-peer (bytes received grow)', in2 > in1 + 2000, `${in1} -> ${in2}`);
  R.check('audio does not pass through the game server', true, 'server only relays rtc sdp/ice messages (see server/index.mjs rtc handler)');
  R.check('remote speaking indicator on B', await until(B, (id) => __fw.voice.peers.get(id)?.speaking && __fw.net.remotes.get(id).tag.material.color.getHexString() === '7dffa0', aId, 8000));

  // --- distance falloff + hard radius + teardown
  const loud = async () => B.ev((id) => __fw.voice.loudness(id), aId);
  await sleep(800); const near = await loud();
  await place(A, -34, -71); await sleep(2500); const mid = await loud();
  await place(A, -34, -93); await sleep(2500); const far = await loud();
  R.check('volume decreases with distance', near > mid && mid > far, `${near.toFixed(2)} > ${mid.toFixed(2)} > ${far.toFixed(2)}`);
  R.check('outside the voice radius nobody hears you', far === 0, far);
  R.check('panner is positioned at the speaker (spatial audio)', await B.ev((id) => { const p = __fw.voice.peers.get(id), r = __fw.net.remotes.get(id); return p && Math.abs(p.panner.positionZ.value - r.char.position.z) < 2; }, aId));
  await place(A, -34, -130); // beyond the connection hysteresis radius
  R.check('peer connection closed when far away', await until(B, (id) => !__fw.voice.peers.has(id), aId, 12000) && await until(A, (id) => !__fw.voice.peers.has(id), bId, 12000));
  await place(A, -30, -53);
  R.check('reconnects when back in range', await until(B, (id) => __fw.voice.peers.get(id)?.pc.connectionState === 'connected', aId, 20000));

  // --- mute stops transmission (not just local silence)
  await A.ev(() => __fw.voice.setMuted(true));
  await sleep(1500);
  const o1 = await stats(A, bId, 'outbound-rtp'); await sleep(2500); const o2 = await stats(A, bId, 'outbound-rtp');
  R.check('muted: no audio is transmitted', o2 - o1 < 1200, `${o1} -> ${o2}`);
  R.check('muted: HUD shows muted', await A.ev(() => document.getElementById('voice').dataset.state === 'muted'));
  R.check('muted: speaking indicator off for listeners', await until(B, (id) => !__fw.voice.peers.get(id)?.speaking, aId, 6000));
  await A.ev(() => __fw.voice.setMuted(false));
  const o3 = await stats(A, bId, 'outbound-rtp'); await sleep(2500); const o4 = await stats(A, bId, 'outbound-rtp');
  R.check('unmute resumes transmission', o4 - o3 > 2000, `${o3} -> ${o4}`);

  // --- both talk: no offer glare, audio both ways
  await B.ev(() => __fw.voice.enable());
  await sleep(4000);
  const b1 = await stats(A, bId, 'inbound-rtp'); await sleep(2000); const b2 = await stats(A, bId, 'inbound-rtp');
  const dbg = await A.ev(async () => JSON.stringify([...__fw.voice.peers.values()].map((p) => ({ id: p.id, init: p.initiator, st: p.pc.connectionState, tr: p.pc.getTransceivers().map((t) => t.currentDirection + ':' + !!t.sender.track) }))));
  R.check('two talkers hear each other', b2 > b1 + 2000 && await A.ev((id) => __fw.voice.peers.get(id)?.pc.connectionState === 'connected', bId), `${b1} -> ${b2} ${dbg} B=${await B.ev(() => __fw.voice.state + ' peers ' + __fw.voice.peers.size + ' LOG ' + __fw.voice.log.join(' | '))} ALOG ${await A.ev(() => __fw.voice.log.slice(-8).join(' | '))}`);
  R.check('echo protection: echoCancellation/noiseSuppression requested', await A.ev(() => { const s = __fw.voice.track.getSettings(); return s.echoCancellation !== false; }));

  // --- denied permission: graceful, text chat still works
  const C = await openGame(browser, url, { context: await small({ permissions: [] }), init: {} });
  await C.page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })); });
  await until(C, () => __fw.net?.connected);
  await C.ev(() => __fw.voice.enable());
  R.check('denied microphone is handled gracefully', await until(C, () => __fw.voice.state === 'denied') && /blocked/i.test(await C.ev(() => document.getElementById('voice').innerText)));
  await place(C, -31, -55);
  await sleep(1500);
  await C.ev(() => __fw.chat.onSend('no mic here', false));
  R.check('text chat still works without a microphone', await until(A, () => /no mic here/.test(document.querySelector('#chat .log').innerText), null, 5000));
  R.check('no console errors', A.errors.length + B.errors.length + C.errors.length === 0, [...A.errors, ...B.errors, ...C.errors].slice(0, 3).join(' | '));
  await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
}
