// Shared helpers for the Free World browser regression suite (tests/run.mjs).
// Uses playwright-core with a locally installed Chromium (CHROME env var or the default
// Playwright cache path); software GL is fine because gameplay is driven through
// window.__fw.advance() (deterministic fixed steps) rather than wall-clock frames.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

export function chromePath() {
  if (process.env.CHROME) return process.env.CHROME;
  const roots = ['/opt/pw-browsers', `${process.env.HOME}/.cache/ms-playwright`];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((x) => /^chromium-\d+/.test(x))) {
      const p = `${r}/${d}/chrome-linux/chrome`;
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('No Chromium found: set CHROME=/path/to/chrome');
}

export async function launch() {
  return chromium.launch({ executablePath: chromePath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
}

// Open the game; returns a page wrapper with helpers and a console-error collector.
export async function openGame(browser, url, { tier = 'very-low', init = {}, context } = {}) {
  const ctx = context || await browser.newContext({ viewport: { width: 960, height: 540 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await page.addInitScript(({ tier, init }) => {
    HTMLCanvasElement.prototype.requestPointerLock = function () {};
    localStorage.setItem('fw-tier', tier);
    for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v);
    window.__fwNoAutoPause = true;
  }, { tier, init });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CERT|net::ERR/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]));
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('loading').classList.contains('ready') || /Could not/.test(document.getElementById('ldText').textContent), null, { timeout: 240000 });
  const status = await page.textContent('#ldText');
  if (/Could not/.test(status)) throw new Error('game failed to start: ' + status);
  await page.click('#loading');
  const g = {
    page, ctx, errors,
    ev: (fn, arg) => page.evaluate(fn, arg),
    adv: (s) => page.evaluate((s) => __fw.advance(s), s),
    hold: (keys) => page.evaluate((k) => { __fw.input.keys.clear(); for (const c of k) { __fw.input.keys.add(c); __fw.input.pressed.add(c); } }, keys),
    press: (k) => page.evaluate((k) => { __fw.input.pressed.add(k); }, k),
    hint: () => page.evaluate(() => document.getElementById('hint').textContent),
    tp: (x, y, z) => page.evaluate(([x, y, z]) => { __fw.player.body.setTranslation({ x, y: y + 0.95, z }, true); __fw.player.body.setNextKinematicTranslation({ x, y: y + 0.95, z }); }, [x, y, z]),
    pos: () => page.evaluate(() => __fw.player.position.toArray()),
    shot: (path) => page.screenshot({ path }),
  };
  return g;
}

// Minimal assertion collector: every check is recorded; the runner prints a table and
// exits non-zero on any failure.
export class Results {
  constructor() { this.rows = []; this.suite = ''; }
  check(name, ok, detail = '') { this.rows.push({ suite: this.suite, name, ok: !!ok, detail: String(detail).slice(0, 200) }); if (!ok) console.log(`  ✗ ${this.suite} › ${name}  ${detail}`); else console.log(`  ✓ ${this.suite} › ${name}  ${detail}`); return !!ok; }
  get failed() { return this.rows.filter((r) => !r.ok); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
