// Normalises a generated prop GLB: real-world size (by height or longest horizontal side),
// origin at the centre of its base, textures resized + WebP, geometry quantised.
// Usage: node tools/process-prop.mjs <in.glb> <out.glb> (--height 0.8 | --length 1.8) [--tex 512] [--rotate 90]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, quantize, prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const [inFile, outFile] = args;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inFile);
const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());

// optional yaw so the prop's front faces +Z
const rot = (Number(opt('rotate', 0)) * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const p of prims) {
  const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL');
  for (let i = 0; i < pos.getCount(); i++) {
    const [x, y, z] = pos.getElement(i, []);
    const v = [x * c + z * s, y, -x * s + z * c];
    pos.setElement(i, v);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
    if (nor) { const [a, b, d] = nor.getElement(i, []); nor.setElement(i, [a * c + d * s, b, -a * s + d * c]); }
  }
}
const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const scale = opt('height') ? Number(opt('height')) / size[1] : Number(opt('length')) / Math.max(size[0], size[2]);
const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
for (const p of prims) {
  const pos = p.getAttribute('POSITION');
  for (let i = 0; i < pos.getCount(); i++) {
    const [x, y, z] = pos.getElement(i, []);
    pos.setElement(i, [(x - cx) * scale, (y - min[1]) * scale, (z - cz) * scale]);
  }
}
for (const n of doc.getRoot().listNodes()) n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
const tex = Number(opt('tex', 512));
await doc.transform(
  dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 85 }),
  quantize(),
);
const dims = size.map((d) => +(d * scale).toFixed(3));
doc.getRoot().listScenes()[0].setExtras({ freeWorld: { size: dims } });
await io.write(outFile, doc);
const tris = prims.reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
console.log(`${outFile}: ${dims.join(' x ')} m, ${tris} tris`);
