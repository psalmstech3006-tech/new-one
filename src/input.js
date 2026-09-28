// Keyboard/mouse + touch input, exposed as a simple polled state.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0, leftPressed: false };
    this.canvas = canvas;
    this.sensitivity = 1;
    this.touch = { active: false, moveX: 0, moveY: 0, lookDX: 0, lookDY: 0 };
    this.enabled = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas && !this.touch.active) canvas.requestPointerLock?.();
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', (e) => { if (this.enabled) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setupTouch();
  }

  setupTouch() {
    const ui = document.getElementById('touch');
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    if (!('ontouchstart' in window)) return;
    this.touch.active = true;
    document.body.classList.add('touch');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; stickId = t.identifier;
      const r = stick.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2;
      e.preventDefault();
    }, { passive: false });
    ui.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) if (t.target === ui && lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) {
          let dx = t.clientX - sx, dy = t.clientY - sy;
          const d = Math.hypot(dx, dy), max = 50;
          if (d > max) { dx *= max / d; dy *= max / d; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          this.touch.moveX = dx / max; this.touch.moveY = dy / max;
        } else if (t.identifier === lookId) {
          this.mouse.dx += (t.clientX - lx) * 2; this.mouse.dy += (t.clientY - ly) * 2; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this.touch.moveX = this.touch.moveY = 0; knob.style.transform = ''; }
        if (t.identifier === lookId) lookId = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    for (const b of document.querySelectorAll('[data-key]')) {
      const code = b.dataset.key;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); this.keys.add(code); this.pressed.add(code); if (code === 'Mouse0') { this.mouse.left = true; this.mouse.leftPressed = true; } }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); this.keys.delete(code); if (code === 'Mouse0') this.mouse.left = false; }, { passive: false });
    }
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }
  axis() {
    let x = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let y = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    if (this.touch.active && (this.touch.moveX || this.touch.moveY)) { x = this.touch.moveX; y = -this.touch.moveY; }
    return { x, y };
  }
  consumeLook() {
    const d = { x: this.mouse.dx * this.sensitivity, y: this.mouse.dy * this.sensitivity };
    this.mouse.dx = this.mouse.dy = 0; return d;
  }
  endFrame() { this.pressed.clear(); this.mouse.leftPressed = false; this.mouse.wheel = 0; }
}
