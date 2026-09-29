// Camera must never end up inside or behind solid geometry (reported bug: "player can end
// up inside buildings"). Hug many building walls from outside and inside, sweep the view
// through 8 yaws x 2 shoulders x 2 pitches, and check the rendered camera position.
import { openGame } from '../lib.mjs';

export default async function camera(browser, url, R) {
  R.suite = 'camera';
  const g = await openGame(browser, url);
  const res = await g.ev(async () => {
    const F = __fw, P = F.physics, WG = (4 << 16) | 1;
    const out = { samples: 0, inside: 0, blocked: 0, examples: [] };
    const blds = F.map.buildings.filter((b, i) => i % 3 === 0).slice(0, 14);
    // teleports must land somewhere the capsule fits (e.g. a spot 'beside' a house can be its garage)
    const place = (x, z) => { const q = P.freeSpot({ x, y: 0.15 + F.player.halfH + F.player.radius + 0.06, z }, F.player.halfH, F.player.radius, WG); F.player.body.setTranslation(q, true); F.player.body.setNextKinematicTranslation(q); };
    for (const b of blds) {
      const [w, d] = b.footprint, c = Math.cos(b.rot), s = Math.sin(b.rot);
      const W = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
      // outside the front and side walls, 0.34 m from the face (capsule radius 0.3); inside if enterable
      const spots = [W(w * 0.2, d / 2 + 0.34), W(-w / 2 - 0.34, 0), W(w / 2 + 0.34, -d * 0.2)];
      if (b.meta?.interior) spots.push(W(w * 0.25, d / 2 - 0.28 - 0.34), W(-w / 2 + 0.28 + 0.34, d * 0.1));
      for (const [x, z] of spots) {
        place(x, z);
        for (let k = 0; k < 8; k++) for (const sh of [1, -1]) for (const pitch of [-0.2, 0.35]) {
          F.cam.yaw = (k / 8) * Math.PI * 2; F.cam.pitch = pitch; F.cam.shoulderSide = sh;
          F.advance(0.35);
          const cp = F.renderer.camera.position, head = F.player.position.add({ x: 0, y: 1.45, z: 0 });
          out.samples++;
          if (P.pointInside(cp, WG, F.player.collider)) { out.inside++; if (out.examples.length < 5) out.examples.push(`inside ${b.meta?.name} cam ${cp.toArray().map((v) => v.toFixed(2))}`); continue; }
          const dir = cp.clone().sub(head), len = dir.length();
          if (len > 0.05) { const h = P.ray(head, dir.normalize(), len, WG, F.player.collider); if (h && h.toi < len - 0.05) { out.blocked++; if (out.examples.length < 5) out.examples.push(`blocked ${b.meta?.name} toi ${h.toi.toFixed(2)}/${len.toFixed(2)}`); } }
        }
      }
    }
    return out;
  });
  R.check('camera never inside solid geometry', res.inside === 0, `${res.inside}/${res.samples} ${res.examples.join('; ')}`);
  R.check('camera always has line of sight to the player', res.blocked === 0, `${res.blocked}/${res.samples}`);

  // ragdoll thrown at a wall: camera follows the body, the player stands up outside the wall
  const rag = await g.ev(() => {
    const F = __fw, P = F.physics, WG = (4 << 16) | 1, results = [];
    const b = F.map.buildings.find((q) => q.meta?.family === 'mixedUse');
    for (const k of [0, 1, 2]) {
      const c = Math.cos(b.rot), s = Math.sin(b.rot), lx = -6 + k * 5, lz = b.footprint[1] / 2 + 1.2;
      const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c, nx = s, nz = c; // outward normal of the front
      const y = 0.15 + F.player.halfH + F.player.radius + 0.06;
      F.player.body.setTranslation({ x, y, z }, true); F.player.body.setNextKinematicTranslation({ x, y, z });
      F.advance(0.3);
      F.player.knock(new F.THREE.Vector3(-nx * 9, 2, -nz * 9));
      let maxInside = 0;
      for (let t = 0; t < 7; t += 0.25) { F.advance(0.25); if (P.pointInside(F.renderer.camera.position, WG, F.player.collider)) maxInside++; }
      F.advance(1.5);
      const p = F.player.position, rel = (p.x - b.x) * nx + (p.z - b.z) * nz; // distance in front of the building centre
      results.push({ state: F.player.state, outsideWall: rel > b.footprint[1] / 2 - 0.05, camInside: maxInside });
    }
    return results;
  });
  R.check('ragdoll into wall: player stands up outside the wall', rag.every((r) => r.outsideWall && r.state === 'loco'), JSON.stringify(rag));
  R.check('ragdoll into wall: camera never inside geometry', rag.every((r) => r.camInside === 0), JSON.stringify(rag.map((r) => r.camInside)));
  R.check('no console errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.ctx.close();
}
