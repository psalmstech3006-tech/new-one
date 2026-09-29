// Remove textures/materials from LOD files; the game reuses LOD0's material.
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const m of doc.getRoot().listMaterials()) m.dispose();
  await doc.transform(prune());
  await io.write(f, doc);
  console.log('stripped', f);
}
