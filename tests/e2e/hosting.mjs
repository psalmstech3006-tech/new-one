// Split deployment: the static web build on a plain static host (stand-in for InfinityFree)
// talking to the game backend on a different origin via fw-config.json; the same static
// site without a reachable backend still plays single-player.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openGame, sleep } from '../lib.mjs';

export default async function hosting(browser, url, R, ctx) {
  R.suite = 'hosting';
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-site-'));
  fs.cpSync(path.join(ctx.root, 'dist'), site, { recursive: true });
  const staticHost = (dir, port) => spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  // 1) static site + separate backend
  fs.writeFileSync(path.join(site, 'fw-config.json'), JSON.stringify({ server: `ws://localhost:${ctx.port}/ws` }));
  const h1 = staticHost(site, 8811); await sleep(800);
  const A = await openGame(browser, 'http://127.0.0.1:8811/', { context: await browser.newContext({ viewport: { width: 400, height: 225 } }) });
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { ok = await A.ev(() => !!__fw.net?.connected); await sleep(250); }
  R.check('static-hosted client connects to a backend on another origin (fw-config.json)', ok);
  R.check('static host serves everything the game needs (no 404s)', A.errors.length === 0, A.errors.slice(0, 2).join(' | '));
  await A.ctx.close(); h1.kill();
  // 2) static site, backend configured but down -> single-player keeps working
  fs.writeFileSync(path.join(site, 'fw-config.json'), JSON.stringify({ server: 'ws://localhost:1/ws' }));
  const h2 = staticHost(site, 8812); await sleep(800);
  const B = await openGame(browser, 'http://127.0.0.1:8812/', { context: await browser.newContext({ viewport: { width: 400, height: 225 } }) });
  await B.adv(2);
  R.check('backend unreachable: game still loads and plays single-player', await B.ev(() => __fw.population.active.length > 0 && !__fw.net.connected));
  R.check('backend unreachable: status shown, no crash', /offline|connecting/i.test(await B.ev(() => document.querySelector('#chat .st')?.textContent || '')));
  await B.ctx.close(); h2.kill();
  // 3) no fw-config.json and no backend -> pure single-player website
  fs.rmSync(path.join(site, 'fw-config.json'));
  const h3 = staticHost(site, 8813); await sleep(800);
  const C = await openGame(browser, 'http://127.0.0.1:8813/', { context: await browser.newContext({ viewport: { width: 400, height: 225 } }) });
  R.check('no backend configured: single-player website, multiplayer UI hidden', await C.ev(() => !__fw.net && document.getElementById('voice').hidden));
  await C.ctx.close(); h3.kill();
  fs.rmSync(site, { recursive: true, force: true });
}
