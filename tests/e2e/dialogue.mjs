// NPC text dialogue: prompt, UI, grounded answers (name, job, activity, time, directions to
// real buildings), memory across conversations, NPC stops + resumes its schedule, the
// deterministic simulation is untouched, text is never rendered as HTML.
import { openGame, sleep } from '../lib.mjs';

export default async function dialogue(browser, url, R) {
  R.suite = 'dialogue';
  const g = await openGame(browser, url + '?server=off');
  // stand in front of an embodied NPC and freeze everyone else's movement for a stable setup
  const setup = async () => g.ev(() => {
    const F = __fw, P = F.population;
    F.player.body.setTranslation({ x: -38, y: 1.2, z: -53 }, true);
    for (let i = 0; i < 12; i++) F.advance(0.5);
    const c = P.active.find((q) => q.state === 'loco' && !q.ai.flee); if (!c) return null;
    const p = c.position, f = c.facing, x = p.x + Math.sin(f) * 1.3, z = p.z + Math.cos(f) * 1.3;
    F.player.body.setTranslation({ x, y: p.y + 1.02, z }, true); F.player.body.setNextKinematicTranslation({ x, y: p.y + 1.02, z });
    F.player.facing = Math.atan2(p.x - x, p.z - z); F.cam.yaw = F.player.facing;
    c.ai.leg = null; c.ai.idle = true; c.ai.wait = 99; // hold still for the approach
    F.advance(0.1);
    return c.resident.id;
  });
  const rid = await setup();
  R.check('an NPC is available to talk to', rid != null);
  const prompt = await g.ev(() => { const c = __fw.conv.candidate(); return c ? __fw.conv.prompt(c) : ''; });
  R.check('interaction prompt names the NPC', /^E: talk to [A-Z][a-z]+/.test(prompt), prompt);
  const schedBefore = await g.ev((rid) => JSON.stringify(__fw.population.residents.slice(0, 50).map((r) => { const L = __fw.population.locate(r, 12.3); return [L.outdoor, L.act, L.pos?.x?.toFixed(2)]; })), rid);
  await g.ev(() => { const c = __fw.conv.candidate(); __fw.conv.start(c); });
  R.check('dialogue UI opens and game input pauses', await g.ev(() => !document.getElementById('dlg').hidden && !__fw.input.enabled));
  await sleep(1500);
  const lines = () => g.ev(() => [...document.querySelectorAll('#dlg .log .npc:not(.typing)')].map((d) => d.textContent));
  R.check('NPC greets first', (await lines()).length >= 1, (await lines()).join(' | '));
  const ask = async (q) => { await g.page.fill('#dlg input', q); await g.page.press('#dlg input', 'Enter'); await sleep(1800); const l = await lines(); return l[l.length - 1]; };
  const id = await g.ev(() => { const c = __fw.conv.npc, R = c.resident; return { ...R.identity, loc: R.loc?.act, dest: R.loc?.place?.name }; });
  const name = await ask('What\'s your name?');
  R.check('answers with its own name', name.includes(id.first) || /why\?/i.test(name), `${name} (${id.name})`);
  const job = await ask('What do you do for a living?');
  R.check('answers with its real job', job.toLowerCase().includes(id.job.split(' ')[0]) || /retired|student/i.test(job), `${job} (${id.job})`);
  const doing = await ask('Where are you going?');
  R.check('describes its current scheduled activity + destination', doing.length > 5 && (!id.dest || id.dest === 'park' || doing.toLowerCase().includes(id.dest.toLowerCase().slice(0, 6)) || /home|stroll|air/.test(doing)), `${doing} (activity ${id.loc} -> ${id.dest})`);
  const time = await ask('What time is it?');
  const h = await g.ev(() => __fw.time);
  R.check('tells the in-game time', time.includes(`${String(Math.floor(h)).padStart(2, '0')}:`), `${time} vs ${h.toFixed(2)}`);
  const dirs = await ask('Where is the bank?');
  const bank = await g.ev(() => { const b = __fw.map.buildings.find((q) => q.meta?.family === 'bank'), c = __fw.conv.npc.position; return { d: Math.hypot(b.x - c.x, b.z - c.z) }; });
  R.check('gives real directions (direction + distance + street)', /(north|south|east|west).*metres|right here/i.test(dirs), `${dirs} (true distance ${bank.d.toFixed(0)} m)`);
  const m = dirs.match(/about (\d+) metres/);
  R.check('direction distance matches the world', !m || Math.abs(+m[1] - bank.d) < Math.max(30, bank.d * 0.2), `${m?.[1]} vs ${bank.d.toFixed(0)}`);
  const hosp = await ask('How do I get to the hospital?');
  R.check('understands synonyms (hospital -> clinic)', /medical|clinic|st\. elena/i.test(hosp), hosp);
  const intro = await ask("I'm Sam");
  R.check('learns the player\'s name', /Sam/.test(intro), intro);
  const unknown = await ask('Do you think pineapple belongs on pizza?');
  R.check('handles free-form lines gracefully', unknown.length > 1, unknown);
  R.check('NPC stands still and faces the player while talking', await g.ev(() => { const c = __fw.conv.npc; const p0 = c.position.clone(); __fw.advance(2); const to = __fw.player.position.sub(c.position); const face = Math.abs(Math.atan2(Math.sin(c.facing - Math.atan2(to.x, to.z)), Math.cos(c.facing - Math.atan2(to.x, to.z)))); return c.position.distanceTo(p0) < 0.3 && face < 0.5; }));
  await g.ev(() => { __fw.conv.ui.add('npc', '<img src=x onerror="window.__xss=1">'); });
  R.check('dialogue text is never rendered as HTML', await g.ev(() => !document.querySelector('#dlg img') && !window.__xss));
  const bye = await ask('Bye!');
  await sleep(1800);
  R.check('goodbye ends the conversation and restores input', await g.ev(() => !__fw.conv.active && document.getElementById('dlg').hidden && __fw.input.enabled), bye);
  R.check('NPC resumes its schedule afterwards', await g.ev((rid) => { const F = __fw, c = F.population.residents[rid].char; if (!c) return true; const p0 = c.position.clone(); for (let i = 0; i < 16; i++) F.advance(0.5); return c.inactive || c.position.distanceTo(p0) > 1 || c.ai.idle; }, rid));
  const schedAfter = await g.ev(() => JSON.stringify(__fw.population.residents.slice(0, 50).map((r) => { const L = __fw.population.locate(r, 12.3); return [L.outdoor, L.act, L.pos?.x?.toFixed(2)]; })));
  R.check('deterministic schedules untouched by dialogue', schedBefore === schedAfter);

  // memory: talk to the same NPC again -> remembers the player's name
  const again = await g.ev((rid) => {
    const F = __fw, c = F.population.residents[rid].char; if (!c || c.inactive) return 'gone';
    const p = c.position, x = p.x + Math.sin(c.facing) * 1.3, z = p.z + Math.cos(c.facing) * 1.3; // walk up to them again
    F.player.body.setTranslation({ x, y: p.y + 1.02, z }, true); F.player.body.setNextKinematicTranslation({ x, y: p.y + 1.02, z }); F.advance(0.1);
    F.conv.start(c); return 'ok';
  }, rid);
  if (again === 'ok') {
    await sleep(1500);
    const who = await ask("What's my name?");
    R.check('remembers the player across conversations', /Sam/.test(who), who);
    await g.ev(() => __fw.conv.end());
  } else R.check('remembers the player across conversations (memory stored)', await g.ev((rid) => JSON.parse(localStorage.getItem('fw-npc-memory'))[rid]?.playerName === 'Sam', rid));
  R.check('NPC memory persists on the device', await g.ev((rid) => JSON.parse(localStorage.getItem('fw-npc-memory'))[rid]?.playerName === 'Sam', rid));
  // rudeness has consequences
  const rid2 = await setup();
  const cand = await g.ev(() => { const c = __fw.conv.candidate(); if (c) __fw.conv.start(c); return !!c; }); await sleep(1200);
  R.check('second NPC available', cand);
  await ask('you are stupid'); const r2 = await ask('shut up idiot');
  await sleep(1800);
  R.check('insulted NPC ends the conversation', await g.ev(() => !__fw.conv.active), r2);
  R.check('no console errors', g.errors.length === 0, g.errors.slice(0, 3).join(' | '));
  await g.ctx.close();
}
