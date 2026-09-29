// Dialogue panel: NPC header, message log, typed input, suggestion chips. Pure UI —
// the Conversation controller decides what is said.
const CSS = `#dlg{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));z-index:27;background:rgba(10,12,16,.9);backdrop-filter:blur(6px);color:#eee;font:14px system-ui,sans-serif;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);overflow:hidden}
#dlg header{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,.06)}#dlg header b{font-size:15px}#dlg header small{opacity:.65}
#dlg header .x{margin-left:auto;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer}#dlg .mood{width:8px;height:8px;border-radius:50%;background:#4cd964}
#dlg .log{max-height:180px;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
#dlg .log div{max-width:85%;padding:6px 10px;border-radius:10px;line-height:1.35}#dlg .log .npc{background:#2a2f38;align-self:flex-start}#dlg .log .me{background:#c8342a;align-self:flex-end}
#dlg .log .typing{opacity:.6;font-style:italic}#dlg .chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px}
#dlg .chips button{background:#1f232a;border:1px solid #3a3f48;color:#ddd;border-radius:14px;padding:4px 10px;cursor:pointer;font:12px system-ui}
#dlg form{display:flex;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.08)}#dlg input{flex:1;background:#15181d;border:1px solid #3a3f48;color:#fff;border-radius:6px;padding:8px 10px;font:inherit}
#dlg form button{background:#c8342a;border:0;color:#fff;border-radius:6px;padding:0 14px;font-weight:600;cursor:pointer}`;

export class DialogueUI {
  constructor({ onSend, onClose }) {
    Object.assign(this, { onSend, onClose });
    const el = (this.el = document.createElement('section'));
    el.id = 'dlg'; el.hidden = true;
    el.innerHTML = `<style>${CSS}</style><header><span class="mood"></span><b class="nm"></b><small class="jb"></small><button class="x" title="End conversation (Esc)">×</button></header>
      <div class="log"></div><div class="chips"></div><form><input maxlength="200" placeholder="Say something… (Enter to send, Esc to leave)"><button>Say</button></form>`;
    document.body.appendChild(el);
    this.log = el.querySelector('.log'); this.input = el.querySelector('input');
    el.querySelector('form').onsubmit = (e) => { e.preventDefault(); const v = this.input.value.trim(); if (v) { this.input.value = ''; this.onSend(v); } };
    el.querySelector('.x').onclick = () => this.onClose();
    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.onClose(); });
    const chips = ['Hi!', 'What\'s your name?', 'What do you do?', 'Where are you going?', 'Where is the bank?', 'What time is it?', 'Bye'];
    el.querySelector('.chips').append(...chips.map((c) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.onclick = () => this.onSend(c); return b; }));
  }
  get open() { return !this.el.hidden; }
  show(who) {
    this.el.hidden = false; this.log.innerHTML = '';
    this.el.querySelector('.nm').textContent = who.name;
    this.el.querySelector('.jb').textContent = who.subtitle || '';
    this.setMood(who.mood);
    setTimeout(() => this.input.focus(), 0);
  }
  setMood(m) { this.el.querySelector('.mood').style.background = { shaken: '#e0b85a', annoyed: '#e05a5a' }[m] || '#4cd964'; }
  hide() { this.el.hidden = true; this.input.blur(); }
  add(who, text) {
    const d = document.createElement('div'); d.className = who; d.textContent = text; // textContent: never HTML
    this.log.appendChild(d); this.log.scrollTop = this.log.scrollHeight; return d;
  }
}
