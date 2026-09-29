// Keyboard + mouse (pointer lock). Polled once per frame.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set(); this.pressed = new Set();
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.lmb = false; this.rmb = false; this.lmbPressed = false;
    this.enabled = false;
    this.sens = 1;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (this.enabled && ['Space', 'Tab', 'AltLeft', 'KeyC'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0) { this.lmb = true; this.lmbPressed = true; }
      if (e.button === 2) this.rmb = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { this.dx += e.movementX; this.dy += e.movementY; } });
    addEventListener('wheel', (e) => { if (this.enabled) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  down(...c) { return c.some((k) => this.keys.has(k)); }
  hit(...c) { return c.some((k) => this.pressed.has(k)); }
  axis() {
    return {
      x: (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0),
      y: (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0),
    };
  }
  look() { const d = { x: this.dx * this.sens, y: this.dy * this.sens }; this.dx = this.dy = 0; return d; }
  end() { this.pressed.clear(); this.wheel = 0; this.lmbPressed = false; }
}
