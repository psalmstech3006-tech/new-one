// Development performance overlay (spec §15 / brief Part 27). Toggle with F3.
export class DevOverlay {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'devov';
    this.canvas = document.createElement('canvas'); this.canvas.width = 220; this.canvas.height = 50;
    this.text = document.createElement('pre');
    this.el.append(this.canvas, this.text);
    document.body.appendChild(this.el);
    this.frames = [];
    // developer tool: hidden for players (F3 toggles, ?dev=1 opens it)
    this.visible = /[?&]dev=1/.test(location.search);
    this.el.style.display = this.visible ? 'block' : 'none';
    this.t = 0;
  }
  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? 'block' : 'none'; }

  update(dt, s) {
    this.frames.push(dt * 1000); if (this.frames.length > 220) this.frames.shift();
    this.t += dt;
    if (!this.visible || this.t < 0.25) return;
    this.t = 0;
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, 220, 50);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, 50 - 16.7 * 1.2, 220, 1); g.fillRect(0, 50 - 33.3 * 1.2, 220, 1);
    this.frames.forEach((ms, i) => { g.fillStyle = ms > 33 ? '#e05a5a' : ms > 17.5 ? '#e0b85a' : '#6fd18b'; const h = Math.min(50, ms * 1.2); g.fillRect(i, 50 - h, 1, h); });
    const avg = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;
    const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/a';
    const info = s.renderer.gl.info;
    const vram = s.texMB != null ? `${s.texMB.toFixed(0)} MB (textures, est.)` : 'n/a';
    this.text.textContent = [
      `FPS ${(1000 / avg).toFixed(0).padStart(4)}   frame ${avg.toFixed(1)} ms`,
      `CPU update ${s.cpuMs.toFixed(2)} ms   physics ${s.physMs.toFixed(2)} ms (${s.physSteps} steps)`,
      `GPU ${s.renderer.gpuMs != null ? s.renderer.gpuMs.toFixed(2) + ' ms' : 'n/a (no timer ext)'}   render CPU ${s.renderMs.toFixed(2)} ms`,
      `draw calls ${info.render.calls}   triangles ${(info.render.triangles / 1000).toFixed(0)}k`,
      `geometries ${info.memory.geometries}   textures ${info.memory.textures}   est. VRAM ${vram}`,
      `RAM (JS heap) ${mem}`,
      `bodies ${s.bodies}   colliders ${s.colliders}   NPCs ${s.npcs}   vehicles ${s.vehicles}`,
      `AI ${s.aiMs.toFixed(2)} ms   anim ${s.animMs.toFixed(2)} ms`,
      `render scale ${(s.renderer.dynScale * s.renderer.tier.scale).toFixed(2)}   tier ${s.renderer.tierName}`,
      s.city ? `interiors streamed ${s.city.interiors} (${(s.city.interiorTris / 1000).toFixed(0)}k tris, last build ${s.city.buildMs.toFixed(0)} ms)` : 'interiors n/a (proving ground)',
      s.net ? `network ${s.net}   players nearby ${s.remote ?? 0}   rtt ${s.rtt != null ? s.rtt.toFixed(0) + ' ms' : '…'}` : 'network  offline (single-player)',
    ].join('\n');
  }
}
