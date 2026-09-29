import { identityOf } from './identity.js';
import { LocalDialogueEngine, makePlaceFinder } from './dialogue.js';
import { DialogueUI } from '../ui/dialogue-ui.js';

// Talking to NPCs: finds who the player can talk to, pauses that NPC (stands still, faces
// the player), routes typed lines through the dialogue engine with grounded context, keeps
// per-NPC memory (on this device) and hands the NPC back to its schedule afterwards.
const MEM_KEY = 'fw-npc-memory';

export class Conversations {
  constructor({ population, district, getHour, player, engine = new LocalDialogueEngine(), onOpen, onClose }) {
    Object.assign(this, { population, district, getHour, player, engine, onOpen, onClose });
    this.place = makePlaceFinder(district);
    this.ui = new DialogueUI({ onSend: (t) => this.say(t), onClose: () => this.end() });
    try { this.memory = JSON.parse(localStorage.getItem(MEM_KEY)) || {}; } catch { this.memory = {}; }
    this.npc = null;
  }
  get active() { return !!this.npc; }

  // nearest embodied NPC in front of the player who can talk right now
  candidate() {
    const pp = this.player.position; let best = null, bd = 2.2;
    for (const c of this.population.active) {
      if (c.state !== 'loco' || c.ai?.flee > 0 || !c.resident) continue;
      const d = c.position.distanceTo(pp); if (d >= bd) continue;
      const to = c.position.clone().sub(pp).setY(0).normalize(), f = { x: Math.sin(this.player.facing), z: Math.cos(this.player.facing) };
      if (to.x * f.x + to.z * f.z < 0.2 && d > 1.0) continue; // must be roughly in front
      bd = d; best = c;
    }
    return best;
  }
  prompt(c) { const id = identityOf(c.resident); return `E: talk to ${id.first}${id.trait === 'grumpy' ? '' : ''}`; }

  start(c) {
    const R = c.resident, id = identityOf(R), mem = this.mem(R.id);
    mem.met = (mem.met || 0) + 1;
    this.npc = c; c.ai.talking = true;
    const shaken = this.population.panics.some((p) => p.pos.distanceTo(c.position) < p.r + 10);
    this.mood = shaken ? 'shaken' : 'calm';
    this.ui.show({ name: id.name, subtitle: `${id.job}${id.age ? ` · ${id.age}` : ''}`, mood: (mem.rel ?? 0) < -1 ? 'annoyed' : this.mood });
    this.onOpen?.();
    this.say(null); // NPC opens
  }

  async say(text) {
    const c = this.npc; if (!c) return;
    if (text) this.ui.add('me', text);
    const R = c.resident, L = R.loc || {};
    const ctx = { id: R.id, identity: identityOf(R), activity: L.act, destination: L.place?.name || null, hour: this.getHour(), npcPos: c.position, place: this.place, mood: this.mood, memory: this.mem(R.id) };
    const typing = this.ui.add('npc typing', '…');
    const reply = await this.engine.respond(ctx, text ?? 'hello');
    await new Promise((r) => setTimeout(r, Math.min(900, 250 + reply.text.length * 12)));
    typing.remove();
    if (this.npc !== c) return;
    this.ui.add('npc', reply.text); this.ui.setMood((ctx.memory.rel ?? 0) < -1 ? 'annoyed' : this.mood);
    this.save();
    if (reply.end) setTimeout(() => { if (this.npc === c) this.end(); }, 1400);
  }

  end() {
    const c = this.npc; if (!c) return;
    this.npc = null; this.ui.hide();
    if (c.ai) { c.ai.talking = false; c.ai.leg = null; c.ai.idle = !!c.resident?.loc?.idle; } // back to the schedule
    this.save(); this.onClose?.();
  }

  // the NPC walks off (streamed out, fled, knocked down) -> conversation ends
  update() {
    const c = this.npc; if (!c) return;
    if (c.inactive || c.state !== 'loco' || c.position.distanceTo(this.player.position) > 4) this.end();
  }

  mem(id) { return (this.memory[id] ||= {}); }
  save() { try { localStorage.setItem(MEM_KEY, JSON.stringify(this.memory)); } catch { /* storage blocked */ } }
}
