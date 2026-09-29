// Offline single-file build (free-world.html from file://) + assets + HUD layout.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { openGame } from '../lib.mjs';

export default async function offline(browser, url, R, ctx) {
  R.suite = 'offline';
  execSync('python3 tools/make-single-file.py', { cwd: ctx.root, stdio: 'ignore' });
  const file = 'file://' + path.join(ctx.root, 'free-world.html');
  const g = await openGame(browser, file);
  R.check('single-file build starts from file://', true);
  const st = await g.ev(() => ({ models: Object.keys(__fw.map.game?.models || {}).length, vehicles: __fw.vehicles.length, genVehicles: __fw.vehicles.filter((v) => v.model).length, props: __fw.map.props.filter((p) => p.kind === 'model').length, net: !!__fw.net, npcs: __fw.population?.stats }));
  R.check('generated vehicles load offline (embedded GLBs)', st.genVehicles >= 8, JSON.stringify(st));
  R.check('generated props load offline', st.props >= 30, st.props);
  R.check('multiplayer disabled cleanly offline', st.net === false);
  await g.adv(2);
  R.check('population runs offline', await g.ev(() => __fw.population.active.length > 0));
  await g.ev(() => { __fw.cam.yaw = Math.PI / 2; }); const p0 = await g.pos(); await g.hold(['KeyW']); await g.adv(2); await g.hold([]); const p1 = await g.pos();
  R.check('player can move', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 3, Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2));
  R.check('no console errors (offline)', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.ctx.close();

  // HUD elements must not overlap each other at common window sizes
  for (const [w, h] of [[1280, 720], [960, 540], [800, 600]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await openGame(browser, url + '?server=off', { context: c });
    const ov = await p.ev(() => {
      __fw.chat.add('Someone', 'a fairly long chat line to occupy space in the log'); __fw.chat.add('Else', 'second line');
      document.getElementById('hint').textContent = 'E: open BEAN THERE CAFE'; document.getElementById('hint').style.opacity = 1;
      document.getElementById('hudVeh').hidden = false;
      const ids = ['hint', 'chat', 'clock', 'street', 'hudVeh'], rects = ids.map((id) => [id, document.getElementById(id)?.getBoundingClientRect()]).filter(([, r]) => r && r.width > 0 && r.height > 0);
      const bad = [];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const [a, A] = rects[i], [b, B] = rects[j]; if (A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) bad.push(`${a}×${b}`); }
      const off = rects.filter(([, r]) => r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1).map(([id]) => id);
      return { bad, off };
    });
    R.check(`HUD elements don't overlap at ${w}×${h}`, ov.bad.length === 0 && ov.off.length === 0, JSON.stringify(ov));
    await c.close();
  }
}
