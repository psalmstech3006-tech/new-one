// Proximity text chat: Y opens the input, Enter sends (prefix "!" to shout = wider range),
// Esc cancels. Messages fade after a while. Voice chat plugs into the same proximity model later.
export class Chat {
  constructor({ onSend, onOpen, onClose }) {
    Object.assign(this, { onSend, onOpen, onClose });
    const el = (this.el = document.createElement('div'));
    el.id = 'chat';
    el.innerHTML = `<style>
      #chat{position:fixed;left:28px;top:84px;width:380px;z-index:12;font:13px system-ui,sans-serif;color:#fff;pointer-events:none}
      #chat .log div{background:rgba(0,0,0,.45);padding:3px 8px;margin-top:3px;border-radius:3px;transition:opacity 1s;text-shadow:0 1px 2px #000}
      #chat .log b{color:#f2c230}#chat .log .sh b{color:#ff7a5a}#chat .st{opacity:.55;font-size:11px;margin-bottom:4px}
      #chat input{width:100%;box-sizing:border-box;margin-top:6px;padding:7px 9px;background:rgba(0,0,0,.75);color:#fff;border:1px solid #666;border-radius:4px;pointer-events:auto;font:inherit}
    </style><div class="st"></div><div class="log"></div><input maxlength="160" placeholder="Say something nearby…  (! to shout, Esc to cancel)" hidden>`;
    document.body.appendChild(el);
    this.input = el.querySelector('input'); this.log = el.querySelector('.log'); this.st = el.querySelector('.st');
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = this.input.value.trim(); if (v) this.onSend?.(v.replace(/^!/, ''), v.startsWith('!')); this.close(); }
      if (e.key === 'Escape') this.close();
    });
  }
  get isOpen() { return !this.input.hidden; }
  open() { this.input.hidden = false; this.input.value = ''; document.exitPointerLock?.(); setTimeout(() => this.input.focus(), 0); this.onOpen?.(); }
  close() { this.input.hidden = true; this.input.blur(); this.onClose?.(); document.getElementById('view')?.requestPointerLock?.(); }
  status(t) { this.st.textContent = t; }
  add(name, text, shout) {
    const d = document.createElement('div'); if (shout) d.className = 'sh';
    const b = document.createElement('b'); b.textContent = name + ': ';
    d.append(b, document.createTextNode(text));
    this.log.appendChild(d);
    while (this.log.children.length > 8) this.log.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; }, 12000);
    setTimeout(() => d.remove(), 13500);
  }
}
