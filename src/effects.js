import * as THREE from 'three';

const puff = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 400; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, depthWrite: false }));
      s.visible = false; scene.add(s); this.pool.push(s);
    }
    this.flashes = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight('#ffae4a', 0, 40, 1.5); scene.add(l); this.flashes.push({ l, t: 0 }); }
    this.tracerMat = new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9 });
    this.tracers = [];
    this.shake = 0;
  }

  spawn(pos, vel, life, size, grow, color, additive = false, gravity = 0) {
    const s = this.pool.pop();
    if (!s) return;
    s.visible = true;
    s.position.copy(pos);
    s.material.color.set(color);
    s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.opacity = 1;
    s.scale.setScalar(size);
    this.active.push({ s, vel: vel.clone(), life, max: life, size, grow, gravity });
  }

  flash(pos, intensity = 60) {
    const f = this.flashes.find((x) => x.t <= 0) || this.flashes[0];
    f.l.position.copy(pos).add(new THREE.Vector3(0, 2, 0)); f.l.intensity = intensity; f.t = 0.35; f.max = intensity;
  }

  muzzle(pos) {
    this.spawn(pos, new THREE.Vector3(), 0.05, 0.5, 2, '#ffd27a', true);
    const f = this.flashes[2]; f.l.position.copy(pos); f.l.intensity = 8; f.t = 0.05; f.max = 8;
  }

  tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, this.tracerMat); this.scene.add(l);
    this.tracers.push({ l, t: 0.06 });
  }

  impact(pos, color = '#bbb') {
    for (let i = 0; i < 5; i++) this.spawn(pos, new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4), 0.35, 0.15, 0.3, color, false, 12);
  }

  blood(pos) { this.impact(pos, '#8a0f0f'); }

  explosion(pos, big = false) {
    const k = big ? 2 : 1;
    this.flash(pos, 120 * k);
    for (let i = 0; i < 40 * k; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 10 * k);
      this.spawn(pos.clone().add(new THREE.Vector3(0, 1, 0)), v, 0.5 + Math.random() * 0.5, 2 * k, 5 * k, Math.random() < 0.5 ? '#ffb347' : '#ff6a1a', true);
    }
    for (let i = 0; i < 25 * k; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 6, (Math.random() - 0.5) * 5);
      this.spawn(pos.clone().add(new THREE.Vector3(0, 2, 0)), v, 2 + Math.random() * 2, 3 * k, 6, '#2b2522', false);
    }
    for (let i = 0; i < 20; i++) this.spawn(pos.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3((Math.random() - 0.5) * 20, 6 + Math.random() * 10, (Math.random() - 0.5) * 20), 1.2, 0.25, 0, '#ffcf6b', true, 20);
    this.shake = Math.max(this.shake, big ? 1.4 : 0.9);
  }

  fire(pos, amount = 1) {
    if (Math.random() < 0.6 * amount) this.spawn(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)), new THREE.Vector3(0, 3 + Math.random() * 2, 0), 0.5, 0.8, 1.2, Math.random() < 0.5 ? '#ff9a2a' : '#ffcf4a', true);
    if (Math.random() < 0.3 * amount) this.smoke(pos.clone().add(new THREE.Vector3(0, 1.5, 0)), '#2a2522');
  }

  smoke(pos, color = '#666') {
    this.spawn(pos, new THREE.Vector3((Math.random() - 0.5), 2 + Math.random() * 1.5, (Math.random() - 0.5)), 1.8, 0.8, 3, color);
  }

  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; this.pool.push(p.s); this.active.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size + p.grow * (1 - p.life / p.max));
      p.s.material.opacity = Math.min(1, p.life / p.max * 1.6) * (p.s.material.blending === THREE.AdditiveBlending ? 1 : 0.7);
    }
    for (const f of this.flashes) if (f.t > 0) { f.t -= dt; f.l.intensity = Math.max(0, f.t / 0.35) * f.max; }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.t -= dt;
      if (t.t <= 0) { this.scene.remove(t.l); t.l.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }
}
