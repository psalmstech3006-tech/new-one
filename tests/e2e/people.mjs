// Characters and population: creator + persistence, NPC spawning per time of day,
// schedule consistency, pathfinding (stay on sidewalks, make progress, never stuck),
// idle behaviour, reactions (panic/flee, shove -> ragdoll -> recover).
import { openGame } from '../lib.mjs';

export default async function people(browser, url, R) {
  R.suite = 'people';
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  let g = await openGame(browser, url + '?server=off', { context });

  // --- creator: open, edit, live preview, save, persistence across reload
  await g.ev(() => __fw.openCreator());
  R.check('creator opens', await g.ev(() => __fw.creator.open));
  await g.page.selectOption('#creator select[data-k="frame"]', 'f');
  await g.page.selectOption('#creator select[data-k="hair"]', 'bob');
  await g.page.selectOption('#creator select[data-k="top"]', 'hoodie');
  await g.page.click('#creator .sw b[data-k="topColor"][data-v="#2f6b8a"]');
  R.check('creator live preview updates the player body', await g.ev(() => __fw.player.asset.dna.hair === 'bob' && __fw.player.asset.dna.top === 'hoodie'));
  const inputBlocked = await g.ev(() => !__fw.input.enabled);
  R.check('game input is suspended while the creator is open', inputBlocked);
  await g.page.click('#crSave');
  R.check('creator closes on save and input resumes', await g.ev(() => !__fw.creator.open && __fw.input.enabled));
  // cancel restores the saved look
  await g.ev(() => __fw.openCreator());
  await g.page.selectOption('#creator select[data-k="hair"]', 'afro');
  await g.page.click('#crCancel');
  R.check('creator cancel reverts unsaved changes', await g.ev(() => __fw.player.asset.dna.hair === 'bob'), await g.ev(() => __fw.player.asset.dna.hair));
  R.check('no console errors (creator)', g.errors.length === 0, g.errors.join(' | '));
  await g.page.close();
  g = await openGame(browser, url + '?server=off', { context });
  R.check('character persists across reload', await g.ev(() => { const d = __fw.player.asset.dna; return d.frame === 'f' && d.hair === 'bob' && d.top === 'hoodie' && d.topColor === '#2f6b8a'; }));

  // --- schedules are a pure function of the clock (same answer twice, sensible day shape)
  const day = await g.ev(() => {
    const P = __fw.population, out = {};
    for (const h of [3, 8, 12.3, 17.5, 21.5]) { let o = 0; const acts = {}; for (const r of P.residents) { const L = P.locate(r, h); if (L.outdoor) o++; acts[L.act] = (acts[L.act] || 0) + 1; } out[h] = { o, acts }; }
    const again = P.residents.slice(0, 40).every((r) => { const a = P.locate(r, 12.3), b = P.locate(r, 12.3); return a.outdoor === b.outdoor && (!a.pos || a.pos.distanceTo(b.pos) < 1e-6); });
    return { out, again };
  });
  R.check('schedule is deterministic for a given clock time', day.again);
  R.check('night: residents at home', day.out[3].o <= 5, JSON.stringify(day.out[3]));
  R.check('morning commute + evening activity populate the streets', day.out[8].o > 40 && day.out[17.5].o > 40, `${day.out[8].o} / ${day.out[17.5].o}`);
  R.check('every resident resolves to a place', Object.values(day.out).every((d) => Object.values(d.acts).reduce((a, b) => a + b, 0) === 160));

  // --- all route legs are valid: start/end at doors, continuous, on the sidewalk graph
  const routes = await g.ev(() => {
    const P = __fw.population; let legs = 0, bad = 0, maxOff = 0, ex = [];
    for (const r of P.residents) for (let i = 0; i < r.plan.length; i++) {
      const L = P.locate(r, (r.plan[i].h + 0.01) % 24); if (!L.leg) continue; legs++;
      const leg = L.leg;
      for (let k = 2; k < leg.pts.length - 2; k++) { const s = P.snap(leg.pts[k].x, leg.pts[k].y); const off = s.p.distanceTo(leg.pts[k]); maxOff = Math.max(maxOff, off); if (off > 0.5) { bad++; if (ex.length < 3) ex.push(`r${r.id} pt ${leg.pts[k].toArray()}`); } }
      if (leg.len > 900) { bad++; ex.push(`r${r.id} len ${leg.len.toFixed(0)}`); }
    }
    return { legs, bad, maxOff, ex };
  });
  R.check('routes follow the sidewalk graph', routes.bad === 0 && routes.legs > 100, JSON.stringify(routes));

  // --- embodied NPCs over 90 s of simulation: spawn, walk, never stuck, stay off the roads
  const sim = await g.ev(() => {
    const F = __fw, P = F.population, T = {}, issues = [];
    let maxEmbodied = 0, roadSamples = 0, samples = 0;
    const onRoad = (x, z) => { // between the kerbs of a street, away from crosswalks
      for (const s of [-180, -60, 60, 180]) if (Math.abs(x - s) < 5.8 && z > -166 && z < 134) { const nearX = [-160, -60, 40].some((e) => Math.abs(z - e) < 11); if (!nearX) return true; }
      for (const e of [-160, -60, 40]) if (Math.abs(z - e) < 5.8 && x > -186 && x < 186) { const nearX = [-180, -60, 60, 180].some((s) => Math.abs(x - s) < 11); if (!nearX) return true; }
      return false;
    };
    F.player.body.setTranslation({ x: -60, y: 1.2, z: -48 }, true);
    for (let t = 0; t < 90; t += 0.5) {
      F.advance(0.5);
      const act = P.active; maxEmbodied = Math.max(maxEmbodied, act.length);
      for (const c of act) {
        if (c.state !== 'loco') continue;
        const id = c.resident.id, p = c.position;
        samples++; if (onRoad(p.x, p.z) && !(c.ai.flee > 0)) { roadSamples++; if (issues.length < 4) issues.push(`road r${id} @${p.x.toFixed(1)},${p.z.toFixed(1)}`); }
        const tr = T[id] || (T[id] = { last: p.clone(), still: 0, maxStill: 0, idle: 0 });
        const moving = !c.ai.idle && c.ai.leg;
        if (moving && p.distanceTo(tr.last) < 0.15) tr.still += 0.5; else tr.still = 0;
        tr.maxStill = Math.max(tr.maxStill, tr.still); tr.last = p.clone(); if (c.ai.idle) tr.idle++;
      }
    }
    const stuck = Object.entries(T).filter(([, v]) => v.maxStill >= 4).map(([k, v]) => `r${k}:${v.maxStill}s`);
    return { maxEmbodied, tracked: Object.keys(T).length, stuck, roadPct: samples ? roadSamples / samples : 0, issues, idlers: Object.values(T).filter((v) => v.idle > 0).length };
  });
  R.check('NPCs are embodied near the player (tier budget)', sim.maxEmbodied >= 6, `${sim.maxEmbodied} max, ${sim.tracked} different residents`);
  R.check('embodied residents rotate as people come and go', sim.tracked > sim.maxEmbodied, `${sim.tracked} > ${sim.maxEmbodied}`);
  R.check('no walking NPC is stuck for 4 s or more', sim.stuck.length === 0, sim.stuck.join(' '));
  R.check('NPCs stay off the roadway (except crossings)', sim.roadPct < 0.01, `${(sim.roadPct * 100).toFixed(2)}% ${sim.issues.join(' ')}`);

  // --- idle behaviour at outdoor spots: they mill about instead of freezing
  const idle = await g.ev(() => {
    const F = __fw, P = F.population;
    F.player.body.setTranslation({ x: -100, y: 1.2, z: 5 }, true); // Harbor Park
    for (let i = 0; i < 6; i++) F.advance(0.5);
    const idlers = P.active.filter((c) => c.ai.idle); const start = idlers.map((c) => c.position.clone());
    for (let i = 0; i < 40; i++) F.advance(0.5);
    const moved = idlers.filter((c, i) => !c.inactive && c.position.distanceTo(start[i]) > 0.8).length;
    return { idlers: idlers.length, moved };
  });
  R.check('park idlers mill about', idle.idlers === 0 || idle.moved >= Math.ceil(idle.idlers * 0.5), JSON.stringify(idle));

  // --- reactions: shove -> ragdoll -> recover; bystanders flee; NPC state restored
  const react = await g.ev(() => {
    const F = __fw, P = F.population;
    const c = P.active.find((q) => q.state === 'loco'); if (!c) return null;
    const p = c.position; F.player.body.setTranslation({ x: p.x - 1.2, y: p.y + 1.05, z: p.z }, true); F.advance(0.1);
    c.knock(new F.THREE.Vector3(6, 2, 0)); P.panic(c.position, 14);
    const fleeing = P.active.filter((q) => q.ai.flee > 0).length;
    F.advance(0.5); const rag = c.state;
    F.advance(8);
    return { fleeing, rag, after: c.state, inactive: c.inactive };
  });
  R.check('shoved NPC ragdolls and gets back up', react && react.rag === 'ragdoll' && (react.after === 'loco' || react.inactive), JSON.stringify(react));
  R.check('bystanders flee from violence', react && react.fleeing >= 1, JSON.stringify(react));
  // --- long session: tour the city for 6 simulated minutes; resources must stay bounded
  const soak = await g.ev(() => {
    const F = __fw, gl = F.renderer.gl, spots = [[-38, -56], [120, 60], [-120, 100], [200, -20], [0, -140], [-150, -10]];
    const snap = () => { F.renderer.render(); return { geo: gl.info.memory.geometries, tex: gl.info.memory.textures, bodies: F.physics.world.bodies.len(), cols: F.physics.world.colliders.len(), fixed: F.physics.fixed.length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0 }; };
    const tour = () => { for (const [x, z] of spots) { F.player.body.setTranslation({ x, y: 1.2, z }, true); for (let i = 0; i < 30; i++) F.advance(0.5); } };
    tour(); const a = snap(); tour(); tour(); const b = snap();
    return { a, b };
  });
  R.check('long session: geometries/textures bounded', soak.b.geo <= soak.a.geo + 20 && soak.b.tex <= soak.a.tex + 5, JSON.stringify(soak));
  R.check('long session: physics bodies/colliders/callbacks bounded', soak.b.bodies <= soak.a.bodies + 3 && soak.b.cols <= soak.a.cols + 10 && soak.b.fixed === soak.a.fixed, JSON.stringify(soak));
  R.check('long session: JS heap bounded', !soak.a.heap || soak.b.heap < soak.a.heap * 1.35 + 20, `${soak.a.heap} -> ${soak.b.heap} MB`);
  R.check('no console errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await context.close();
}
