// Build the hostable web client (static files) for any static host (InfinityFree, GitHub
// Pages, Netlify...). Writes dist/ and deploy/free-world-web.zip.
//   node tools/build-web.mjs --server wss://free-world-server.onrender.com/ws
//   node tools/build-web.mjs                       (no backend: single-player website)
// Checks the limits of InfinityFree's free plan: every file < 10 MB, HTML files < 1 MB.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const server = arg('--server'), turn = arg('--ice');
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });
const dist = path.join(ROOT, 'dist');
const cfg = {};
if (server) cfg.server = server;
if (turn) cfg.iceServers = JSON.parse(turn);
fs.writeFileSync(path.join(dist, 'fw-config.json'), JSON.stringify(cfg, null, 1));
// Apache hosts (InfinityFree): long cache for hashed assets, never cache the config
fs.writeFileSync(path.join(dist, '.htaccess'), `AddType model/gltf-binary .glb
AddType application/wasm .wasm
<FilesMatch "\\.(js|glb|png|jpg|webp)$">
  Header set Cache-Control "public, max-age=604800"
</FilesMatch>
<Files "fw-config.json">
  Header set Cache-Control "no-store"
</Files>
`);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let bad = 0, total = 0;
for (const f of walk(dist)) {
  const sz = fs.statSync(f).size; total += sz;
  const limit = /\.(html?|php)$/.test(f) ? 1 << 20 : 10 << 20;
  if (sz > limit) { bad++; console.error(`TOO BIG for InfinityFree: ${path.relative(dist, f)} ${(sz / 1048576).toFixed(1)} MB (limit ${limit >> 20} MB)`); }
}
fs.mkdirSync(path.join(ROOT, 'deploy'), { recursive: true });
const zip = path.join(ROOT, 'deploy', 'free-world-web.zip');
fs.rmSync(zip, { force: true });
execSync(`cd "${dist}" && python3 -c "import zipfile,os;z=zipfile.ZipFile('${zip}','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,f),os.path.relpath(os.path.join(r,f),'.')) for r,_,fs in os.walk('.') for f in fs];z.close()"`);
console.log(`\nweb build: ${(total / 1048576).toFixed(1)} MB in dist/, zip: deploy/free-world-web.zip (${(fs.statSync(zip).size / 1048576).toFixed(1)} MB)`);
console.log(server ? `multiplayer backend: ${server}` : 'no backend configured: the site runs single-player');
if (bad) process.exit(1);
