import { buildAvatar, defaultDNA, randomDNA, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, FACIAL, TOPS, BOTTOMS, SHOES, ACCESSORIES } from './avatar.js';

// Character creator: edits the player's DNA with live preview on the in-world body and
// persists it (localStorage now; the account/character server stores it in multiplayer).
const KEY = 'fw-dna';
const CLOTH = ['#1d1d20', '#f2f2f2', '#2d3f5c', '#33465e', '#8a2f2a', '#3f5c38', '#d8d2c4', '#e0a13a', '#5a4a38', '#6d6a62', '#b43a2e', '#2f6b8a', '#6a3a6a', '#c9a14a', '#1f4f3a', '#a0495a', '#e8c9a0', '#4a3121'];
const LABEL = { frame: 'Body frame', age: 'Age', height: 'Height (m)', build: 'Build', muscle: 'Muscle', skin: 'Skin tone', hair: 'Hair', hairColor: 'Hair colour', facial: 'Facial hair', top: 'Top', topColor: 'Top colour', bottom: 'Bottom', bottomColor: 'Bottom colour', shoes: 'Shoes', shoesColor: 'Shoe colour', acc: 'Accessories' };

export function loadDNA() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.v === 1) return { ...defaultDNA(), ...d }; } catch { /* no saved character */ }
  return null;
}
export function saveDNA(dna) { try { localStorage.setItem(KEY, JSON.stringify(dna)); } catch { /* storage blocked */ } }

export class Creator {
  constructor({ onChange, onClose }) {
    this.onChange = onChange; this.onClose = onClose;
    this.dna = loadDNA() || defaultDNA();
    const el = (this.el = document.createElement('section'));
    el.id = 'creator'; el.hidden = true;
    el.innerHTML = `<style>
      #creator{position:fixed;right:0;top:0;bottom:0;width:340px;z-index:26;background:rgba(8,10,14,.9);backdrop-filter:blur(6px);color:#e8e6df;font:13px system-ui,sans-serif;overflow-y:auto;padding:18px 18px 80px;box-sizing:border-box}
      #creator h2{margin:0 0 12px;font-size:18px;letter-spacing:.12em}
      #creator .row{margin:10px 0}#creator .lab{opacity:.7;margin-bottom:5px;display:flex;justify-content:space-between}
      #creator select,#creator input[type=range]{width:100%}#creator select{background:#1a1d22;color:#eee;border:1px solid #333;padding:5px;border-radius:4px}
      #creator .sw{display:flex;flex-wrap:wrap;gap:5px}#creator .sw b{width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer}
      #creator .sw b.on{border-color:#fff}#creator .acc{display:grid;grid-template-columns:1fr 1fr;gap:4px}
      #creator .bar{position:sticky;bottom:-80px;margin:16px -18px -80px;display:flex;gap:8px;padding:12px 18px;background:rgba(8,10,14,.97)}
      #creator button{flex:1;padding:9px;background:#2a2f38;color:#fff;border:0;border-radius:4px;cursor:pointer;font-weight:600}#creator button.pri{background:#c8342a}
    </style><h2>CHARACTER</h2><div id="crRows"></div>
    <div class="bar"><button id="crRand">Randomise</button><button id="crCancel">Cancel</button><button id="crSave" class="pri">Save</button></div>`;
    document.body.appendChild(el);
    el.querySelector('#crRand').onclick = () => { this.dna = { ...randomDNA(Math.floor(Math.random() * 1e9)), acc: this.dna.acc.filter(() => Math.random() < 0.5) }; this.render(); this.changed(); };
    el.querySelector('#crCancel').onclick = () => { this.dna = this.saved; this.changed(); this.close(); };
    el.querySelector('#crSave').onclick = () => { saveDNA(this.dna); this.saved = this.dna; this.close(); };
    // keep game keys from firing while the panel has focus
    el.addEventListener('keydown', (e) => e.stopPropagation());
  }
  get open() { return !this.el.hidden; }
  show() { this.saved = { ...this.dna }; this.el.hidden = false; this.render(); }
  close() { this.el.hidden = true; this.onClose?.(); }
  changed() { this.onChange?.(buildAvatar(this.dna), this.dna); }
  set(k, v) { this.dna = { ...this.dna, [k]: v }; if (k === 'top' && v === 'suit') this.dna.bottom = 'trousers'; this.changed(); this.render(); }

  render() {
    const d = this.dna, rows = this.el.querySelector('#crRows');
    const sel = (k, opts) => `<select data-k="${k}">${opts.map((o) => `<option ${o === d[k] ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    const rng = (k, min, max, step) => `<input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${d[k]}">`;
    const sw = (k, cols) => `<div class="sw">${cols.map((c) => `<b data-k="${k}" data-v="${c}" style="background:${c}" class="${c === d[k] ? 'on' : ''}"></b>`).join('')}</div>`;
    const row = (k, html, val = '') => `<div class="row"><div class="lab"><span>${LABEL[k]}</span><span>${val}</span></div>${html}</div>`;
    rows.innerHTML = [
      row('frame', sel('frame', ['m', 'f'])), row('age', rng('age', 18, 85, 1), d.age), row('height', rng('height', 1.5, 2.0, 0.01), d.height),
      row('build', rng('build', 0, 1, 0.05)), row('muscle', rng('muscle', 0, 1, 0.05)), row('skin', sw('skin', SKIN_TONES)),
      row('hair', sel('hair', HAIR_STYLES)), row('hairColor', sw('hairColor', HAIR_COLORS)), row('facial', sel('facial', FACIAL)),
      row('top', sel('top', TOPS.filter((t) => !['police', 'medic', 'hivis'].includes(t)))), row('topColor', sw('topColor', CLOTH)),
      row('bottom', sel('bottom', BOTTOMS)), row('bottomColor', sw('bottomColor', CLOTH)), row('shoes', sel('shoes', SHOES)), row('shoesColor', sw('shoesColor', CLOTH)),
      row('acc', `<div class="acc">${ACCESSORIES.map((a) => `<label><input type="checkbox" data-acc="${a}" ${d.acc.includes(a) ? 'checked' : ''}> ${a}</label>`).join('')}</div>`),
    ].join('');
    rows.querySelectorAll('select').forEach((s) => (s.onchange = () => this.set(s.dataset.k, s.value)));
    rows.querySelectorAll('input[type=range]').forEach((s) => (s.onchange = () => this.set(s.dataset.k, Number(s.value))));
    rows.querySelectorAll('.sw b').forEach((b) => (b.onclick = () => this.set(b.dataset.k, b.dataset.v)));
    rows.querySelectorAll('[data-acc]').forEach((c) => (c.onchange = () => this.set('acc', ACCESSORIES.filter((a) => rows.querySelector(`[data-acc="${a}"]`).checked))));
  }
}
