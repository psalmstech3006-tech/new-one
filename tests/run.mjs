// Free World regression suite.
//   node tests/run.mjs                 # all suites
//   node tests/run.mjs camera city     # selected suites
//   SKIP_BUILD=1 node tests/run.mjs    # reuse the existing dist/
// Builds the client, starts the real game server (static client + WebSocket backend) on a
// scratch port with a temporary data dir, runs each suite in headless Chromium, and exits
// non-zero if any check fails.
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, Results, sleep } from './lib.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ALL = ['camera', 'city', 'people', 'dialogue', 'multiplayer', 'voice', 'hosting', 'offline'];
const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const suites = want.length ? want : ALL;
const PORT = Number(process.env.TEST_PORT || 8799);

if (!process.env.SKIP_BUILD) execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-test-'));
export function startServer() {
  const proc = spawn(process.execPath, ['server/index.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write('[server] ' + d));
  proc.stderr.on('data', (d) => process.stdout.write('[server:err] ' + d));
  return proc;
}
async function waitUp() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) return true; } catch { /* not yet */ } await sleep(200); } return false; }

let server = startServer();
if (!(await waitUp())) { console.error('server did not start'); process.exit(2); }
const ctx = {
  url: `http://localhost:${PORT}/`, port: PORT, root: ROOT, dataDir,
  async restartServer(downMs = 1500) { server.kill(); await sleep(downMs); server = startServer(); return waitUp(); },
  stopServer() { server.kill(); },
  startServer: async () => { server = startServer(); return waitUp(); },
};
const R = new Results();
const browser = await launch();
const t0 = Date.now();
for (const name of suites) {
  const file = path.join(ROOT, 'tests', 'e2e', `${name}.mjs`);
  if (!fs.existsSync(file)) { R.suite = name; R.check('suite exists', false, file); continue; }
  console.log(`\n▶ ${name}`);
  const ts = Date.now();
  try { const mod = await import(file); await mod.default(browser, ctx.url, R, ctx); }
  catch (e) { R.suite = name; R.check('suite ran without exceptions', false, e.stack || e.message); }
  console.log(`  (${((Date.now() - ts) / 1000).toFixed(0)} s)`);
}
await browser.close();
server.kill();
const failed = R.failed;
console.log(`\n${R.rows.length - failed.length}/${R.rows.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const f of failed) console.log(`FAIL ${f.suite} › ${f.name}: ${f.detail}`);
fs.writeFileSync(path.join(ROOT, 'tests', 'last-run.json'), JSON.stringify({ date: new Date().toISOString(), rows: R.rows }, null, 1));
process.exit(failed.length ? 1 : 0);
