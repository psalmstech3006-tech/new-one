import { TRAITS } from './identity.js';

// ============================================================================
// NPC dialogue (text only). A DialogueEngine turns what the player typed into an NPC
// reply using a read-only snapshot of the NPC and the world. It never touches schedules,
// homes, jobs or positions — the deterministic life simulation stays authoritative.
//
//   engine.respond(ctx, text) -> Promise<{ text, end?: bool }>
//   ctx = { id, identity, activity, destination, hour, npcPos, place(q), mood, memory }
//
// The default LocalDialogueEngine is rule-based and grounded in real world data (names,
// jobs, the resident's current schedule, real directions to real buildings). A future LLM
// backend implements the same interface (see RemoteDialogueEngine) and receives the same
// grounded context, so it can't contradict the simulation.
// ============================================================================

const pick = (a, seed) => a[Math.abs(seed) % a.length];
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const DIR = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

// what the resident is doing, in words
const DOING = {
  work: (d) => `heading to work${d ? ` at ${d}` : ''}`, school: (d) => `on my way to ${d || 'school'}`, lunch: (d) => `grabbing some lunch${d ? ` at ${d}` : ''}`,
  shop: (d) => d === 'park' ? 'taking a break in the park' : `doing some shopping${d ? ` at ${d}` : ''}`, leisure: (d) => d && d !== 'park' ? `going to ${d} to unwind` : 'just getting some air in the park',
  park: () => 'enjoying the park', stroll: () => 'out for a stroll', home: () => 'heading home',
};

export class LocalDialogueEngine {
  async respond(ctx, raw) {
    const text = raw.trim(), t = text.toLowerCase(), id = ctx.identity, tr = TRAITS[id.trait] || TRAITS.friendly;
    const mem = ctx.memory, seed = (mem.turns = (mem.turns || 0) + 1) + ctx.id;
    const rude = /\b(stupid|idiot|shut up|ugly|loser|hate you|dumb)\b/.test(t);
    const mood = () => (mem.rel ?? 0) < -1 ? 'annoyed' : ctx.mood;
    if (rude) { mem.rel = (mem.rel ?? 0) - 1; return { text: mem.rel < -1 ? pick(['I\'m done talking to you.', 'Get lost.', 'Rude. Goodbye.'], seed) : pick(['Excuse me?', 'Wow. Okay.', 'No need for that.'], seed), end: mem.rel < -1 }; }
    if (mood() === 'annoyed' && !/sorry|apolog/.test(t)) return { text: pick(['I don\'t want to talk to you.', 'Leave me alone.'], seed), end: true };
    if (/sorry|apolog/.test(t)) { mem.rel = Math.max(0, (mem.rel ?? 0) + 1); return { text: pick(['Fine. Apology accepted.', 'Okay, no harm done.'], seed) }; }
    if (ctx.mood === 'shaken' && seed % 2) return { text: pick(['Did you see that? Someone just got knocked flat back there. I\'m still shaking.', 'Sorry, I\'m a bit rattled — there was trouble just now.'], seed) };

    // the player introduces themselves: remembered for next time
    const intro = text.match(/\b(?:i'?m|i am|my name is|call me)\s+([a-z][a-z'-]{1,15})/i);
    if (intro && !/\b(i'?m|i am) (fine|good|ok|okay|lost|new|here|looking|going|not|just|a |an )/i.test(t)) {
      mem.playerName = intro[1][0].toUpperCase() + intro[1].slice(1).toLowerCase(); mem.rel = (mem.rel ?? 0) + 0.5;
      return { text: `Nice to meet you, ${mem.playerName}. I'm ${id.first}.` };
    }
    if (/what'?s my name|who am i|remember me|do you know me/.test(t)) return { text: mem.playerName ? `You're ${mem.playerName}, right? ${mem.met > 1 ? 'We\'ve talked before.' : ''}`.trim() : 'I don\'t think you told me your name.' };
    if (/^(hi|hey|hello|yo|good (morning|evening|afternoon)|sup|hiya)\b/.test(t)) return { text: mem.met > 1 && mem.playerName ? `Oh, ${mem.playerName}! Hi again.` : pick(tr.greet, seed) };
    if (/\b(bye|goodbye|see you|later|gotta go|cya)\b/.test(t)) return { text: pick(tr.bye, seed), end: true };
    if (/(your name|who are you|what are you called)/.test(t)) return { text: id.trait === 'grumpy' ? `${id.first}. Why?` : `I'm ${id.name}.` };
    if (/(what do you do|your job|where do you work|for a living|work as)/.test(t)) {
      if (id.job === 'retired') return { text: 'Retired, thank goodness. Forty years was enough.' };
      if (id.job === 'student') return { text: `I'm a student at ${id.workplace || 'the high school'}.` };
      return { text: `I'm a ${id.job}${id.workplace ? ` at ${titleCase(id.workplace)}` : ''}.` };
    }
    if (/(what are you doing|where are you going|where you headed|busy)/.test(t)) {
      const d = ctx.destination && ctx.destination !== 'park' ? titleCase(ctx.destination) : ctx.destination;
      return { text: `I'm ${(DOING[ctx.activity] || (() => 'just passing through'))(d)}.` };
    }
    if (/(where do you live|your home|live around)/.test(t)) return { text: id.trait === 'reserved' || id.trait === 'grumpy' ? 'Around. I\'d rather not say.' : `Just over at ${titleCase(id.home || 'the residential blocks')}.` };
    if (/(what time|the time|time is it)/.test(t)) return { text: `It's ${hhmm(ctx.hour)}.` };
    if (/how old/.test(t)) return { text: id.trait === 'grumpy' || id.age > 55 ? 'Old enough.' : `I'm ${id.age}.` };
    if (/(how are you|how's it going|you ok|how do you do)/.test(t)) return { text: ctx.mood === 'shaken' ? 'Honestly? A bit shaken.' : pick(['Not bad, thanks.', 'Can\'t complain.', 'Tired, but good.', 'Long day.'], seed) };
    if (/(what do you like|hobby|hobbies|for fun)/.test(t)) return { text: `Me? I love ${id.likes}.` };
    if (/(weather|nice day|cold|hot out)/.test(t)) return { text: ctx.hour > 19 || ctx.hour < 6 ? 'Cool evening. I like it.' : 'Nice enough out there today.' };

    // directions: "where is the bank", "how do I get to the police station"
    const q = t.match(/(?:where(?:'s| is| are)?|how do i get to|how to get to|way to|looking for|find)\s+(?:the |a |an )?([a-z0-9 &'.-]{2,40})/);
    if (q) {
      const target = ctx.place(q[1].replace(/[?!.]+$/, '').trim());
      if (!target) return { text: pick(['Hm, never heard of it around here.', 'Not sure that exists in Harbor Heights.'], seed) };
      const dx = target.x - ctx.npcPos.x, dz = target.z - ctx.npcPos.z, d = Math.hypot(dx, dz);
      if (d < 25) return { text: `${titleCase(target.name)}? It's right here — ${d < 12 ? 'just there' : 'a few steps away'}.` };
      const ang = Math.atan2(dx, -dz), dir = DIR[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
      const m = d > 200 ? `about ${Math.round(d / 50) * 50} metres` : `about ${Math.round(d / 10) * 10} metres`;
      return { text: `${titleCase(target.name)}? Head ${dir}, ${m}${target.street ? ` — it's on ${titleCase(target.street)}` : ''}.` };
    }
    if (/(thank|thanks|cheers)/.test(t)) return { text: pick(['No problem.', 'Anytime.', 'Sure thing.'], seed) };
    if (/\?$/.test(t)) return { text: pick([...tr.filler, 'Couldn\'t tell you, sorry.'], seed) };
    return { text: pick(tr.filler, seed) };
  }
}

// Placeholder for an LLM-backed engine: POSTs the grounded context to a backend endpoint
// and falls back to the local engine on any failure (offline play keeps working).
export class RemoteDialogueEngine {
  constructor(url, fallback = new LocalDialogueEngine()) { this.url = url; this.fallback = fallback; }
  async respond(ctx, text) {
    try {
      const r = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ npc: ctx.identity, activity: ctx.activity, destination: ctx.destination, hour: ctx.hour, mood: ctx.mood, memory: ctx.memory, text }) });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json(); if (typeof j.text !== 'string') throw new Error('bad reply');
      return { text: j.text.slice(0, 400), end: !!j.end };
    } catch { return this.fallback.respond(ctx, text); }
  }
}

function titleCase(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bSt\b/g, 'St').replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (m, n, x) => n + x.toLowerCase()); }

// Place lookup for directions: fuzzy-match a query against building names, families and
// common words ("hospital" -> clinic). Returns {name, x, z, street}.
export function makePlaceFinder(district) {
  const ALIAS = { hospital: 'clinic', doctor: 'clinic', medical: 'clinic', cops: 'police', 'police station': 'police', 'train': 'train', station: 'train', 'bus': 'bus', 'gas': 'gas', petrol: 'gas', fuel: 'gas', shop: 'convenience', store: 'convenience', 'corner shop': 'convenience', mall: 'mall', shopping: 'mall', 'city hall': 'cityhall', 'town hall': 'cityhall', 'fire station': 'fire', school: 'school', 'high school': 'school', bank: 'bank', atm: 'bank', hotel: 'hotel', cinema: 'cinema', movies: 'cinema', 'movie theater': 'cinema', library: 'library', gym: 'gym', garage: 'workshop', mechanic: 'workshop', office: 'officeLow', offices: 'officeLow', tower: 'officeTower', park: 'park', coffee: 'cafe', cafe: 'cafe', diner: 'diner', pharmacy: 'pharmacy', apartments: 'apartment', parking: 'parking', factory: 'factory', warehouse: 'warehouse', 'car dealer': 'dealership', dealership: 'dealership', 'community centre': 'community', 'community center': 'community' };
  const places = [];
  for (const b of district.buildings) {
    const m = b.meta || {};
    places.push({ key: [m.name, m.family].join(' ').toLowerCase(), family: m.family, name: m.name, x: b.x, z: b.z });
    for (const s of m.shops || []) places.push({ key: s.name.toLowerCase(), family: 'shop', name: s.name, x: b.x, z: b.z });
  }
  places.push({ key: 'harbor park park', family: 'park', name: 'Harbor Park', x: -115, z: -10 });
  for (const p of places) p.street = district.streetAt({ x: p.x, z: p.z });
  return (query) => {
    const q = query.toLowerCase().replace(/^(the|a|an) /, '');
    const alias = ALIAS[q] || Object.entries(ALIAS).find(([k]) => q.includes(k))?.[1];
    let hit = alias && places.find((p) => p.family === alias || p.key.includes(alias));
    if (!hit) hit = places.find((p) => p.key.includes(q)) || places.find((p) => q.split(' ').some((w) => w.length > 3 && p.key.includes(w)));
    return hit || null;
  };
}
