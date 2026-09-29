import * as THREE from 'three';

// Shared architectural materials. Every material uses vertex colours as a tint so one
// material serves many buildings (different brick/stucco/siding colours) without extra draw calls.

function tex(size, draw, srgb = true, rep = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rnd = (a, b) => a + Math.random() * (b - a);
function noise(g, s, base, amp) {
  const img = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) { const n = (Math.random() - 0.5) * amp; img.data.set([base + n, base + n, base + n, 255], i * 4); }
  g.putImageData(img, 0, 0);
}
function heightToNormal(hc, strength = 2) {
  const s = hc.width, src = hc.getContext('2d').getImageData(0, 0, s, s).data;
  return tex(s, (g) => {
    const img = g.createImageData(s, s), h = (x, y) => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y + 1) - h(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * s + x) * 4;
      img.data.set([(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255], i);
    }
    g.putImageData(img, 0, 0);
  }, false);
}
function hcanvas(s, draw) { const c = document.createElement('canvas'); c.width = c.height = s; draw(c.getContext('2d'), s); return c; }

let M = null;
export function cityMaterials() {
  if (M) return M;
  // albedo textures are greyscale-ish so vertex colour sets the hue
  const brickH = hcanvas(256, (g, s) => { g.fillStyle = '#aaa'; g.fillRect(0, 0, s, s); g.fillStyle = '#555'; for (let y = 0; y < s; y += 16) { g.fillRect(0, y, s, 2); for (let x = (y / 16) % 2 ? 0 : 16; x < s; x += 32) g.fillRect(x, y, 2, 16); } });
  const brick = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9,
    map: tex(256, (g, s) => { g.fillStyle = '#c9c1b6'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < s; x += 32) { const v = rnd(175, 235); g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.95})`; g.fillRect(x + 2, y + 2, 30, 14); } }),
    normalMap: heightToNormal(brickH, 5),
  });
  const stuccoH = hcanvas(256, (g, s) => noise(g, s, 128, 70));
  const stucco = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: tex(256, (g, s) => noise(g, s, 205, 18)), normalMap: heightToNormal(stuccoH, 1.5) });
  const sidingH = hcanvas(256, (g, s) => { for (let y = 0; y < s; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, '#606060'); gr.addColorStop(1, '#d0d0d0'); g.fillStyle = gr; g.fillRect(0, y, s, 16); } });
  const siding = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: tex(256, (g, s) => { noise(g, s, 212, 8); g.fillStyle = 'rgba(0,0,0,0.16)'; for (let y = 0; y < s; y += 16) g.fillRect(0, y + 14, s, 2); }), normalMap: heightToNormal(sidingH, 3) });
  const concrete = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, map: tex(256, (g, s) => { noise(g, s, 188, 24); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, s, 2); g.fillRect(0, 0, 2, s); }) });
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: tex(256, (g, s) => { noise(g, s, 196, 16); g.strokeStyle = 'rgba(80,70,60,0.35)'; g.lineWidth = 2; for (let y = 0; y < s; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke(); for (let x = (y / 64) % 2 ? 0 : 64; x < s; x += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke(); } } }) });
  const corrH = hcanvas(128, (g, s) => { for (let x = 0; x < s; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#303030'); gr.addColorStop(0.5, '#e0e0e0'); gr.addColorStop(1, '#303030'); g.fillStyle = gr; g.fillRect(x, 0, 16, s); } });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.6, map: tex(128, (g, s) => noise(g, s, 210, 14)), normalMap: heightToNormal(corrH, 4) });
  const shingle = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: tex(256, (g, s) => { g.fillStyle = '#888'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < s; x += 24) { const v = rnd(100, 170); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x + 1, y + 1, 22, 14); } }) });
  const glass = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: '#9fb4c6', roughness: 0.06, metalness: 0.9, clearcoat: 1, emissive: '#ffcf8a', emissiveIntensity: 0 });
  const glassClear = new THREE.MeshPhysicalMaterial({ vertexColors: true, color: '#dfeaf2', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.5 });
  const frame = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
  const trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, map: tex(256, (g, s) => { noise(g, s, 200, 20); g.strokeStyle = 'rgba(90,60,30,0.25)'; for (let i = 0; i < 40; i++) { g.beginPath(); const y = Math.random() * s; g.moveTo(0, y); g.bezierCurveTo(s * 0.3, y + rnd(-6, 6), s * 0.6, y + rnd(-6, 6), s, y); g.stroke(); } }) });
  const tile = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, map: tex(256, (g, s) => { noise(g, s, 235, 8); g.fillStyle = 'rgba(0,0,0,0.18)'; for (let i = 0; i < s; i += 64) { g.fillRect(0, i, s, 2); g.fillRect(i, 0, 2, s); } }) });
  const carpet = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: tex(128, (g, s) => noise(g, s, 200, 40)) });
  const fabric = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: tex(128, (g, s) => noise(g, s, 215, 30)) });
  const plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 1 });
  const light = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#fff2d8', emissiveIntensity: 1.2, roughness: 0.4 });
  const screen = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: '#6fa8ff', emissiveIntensity: 0.6, roughness: 0.2 });
  const asphalt = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map: tex(512, (g, s) => { noise(g, s, 70, 30); g.globalAlpha = 0.06; for (let i = 0; i < 50; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#999'; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, rnd(10, 70), rnd(8, 40), Math.random() * 3, 0, 7); g.fill(); } }), normalMap: heightToNormal(hcanvas(256, (g, s) => noise(g, s, 128, 110)), 3) });
  asphalt.normalScale.set(0.5, 0.5);
  const paving = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map: tex(256, (g, s) => { noise(g, s, 196, 16); g.fillStyle = 'rgba(60,60,60,0.5)'; g.fillRect(0, 0, s, 3); g.fillRect(0, 0, 3, s); g.fillRect(0, s / 2, s, 2); g.fillRect(s / 2, 0, 2, s); }) });
  const grass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: tex(256, (g, s) => { noise(g, s, 150, 60); for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${rnd(30, 90)},${rnd(90, 150)},${rnd(30, 60)},0.5)`; g.fillRect(Math.random() * s, Math.random() * s, 1, 3); } }) });
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const leaves = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  M = { brick, stucco, siding, concrete, stone, metal, shingle, glass, glassClear, frame, trim, wood, tile, carpet, fabric, plastic, chrome, light, screen, asphalt, paving, grass, paint, leaves };
  M.nightGlow = [glass];
  return M;
}

// A small shared canvas atlas for all storefront signs (one material, one texture).
export class SignAtlas {
  constructor(slots = 64) {
    this.cols = 4; this.rows = slots / 4; this.slotW = 512; this.slotH = 128;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * this.slotW; this.canvas.height = this.rows * this.slotH;
    this.g = this.canvas.getContext('2d');
    this.next = 0;
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.texture.anisotropy = 8;
    this.material = new THREE.MeshStandardMaterial({ map: this.texture, emissive: '#ffffff', emissiveMap: this.texture, emissiveIntensity: 0.15, roughness: 0.5 });
  }
  // returns UV rect [u0,v0,u1,v1]
  add(text, { bg = '#1d2a3a', fg = '#f4f1e8', accent = null, font = 'bold 72px Arial, Helvetica, sans-serif' } = {}) {
    const i = this.next++ % (this.cols * this.rows), cx = i % this.cols, cy = Math.floor(i / this.cols);
    const x = cx * this.slotW, y = cy * this.slotH, g = this.g;
    g.fillStyle = bg; g.fillRect(x, y, this.slotW, this.slotH);
    if (accent) { g.fillStyle = accent; g.fillRect(x, y + this.slotH - 14, this.slotW, 14); }
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 72; while (g.measureText(text).width > this.slotW - 40 && size > 24) { size -= 4; g.font = font.replace(/\d+px/, size + 'px'); }
    g.fillText(text, x + this.slotW / 2, y + this.slotH / 2 - (accent ? 6 : 0));
    this.texture.needsUpdate = true;
    const W = this.canvas.width, H = this.canvas.height;
    return [x / W, 1 - (y + this.slotH) / H, (x + this.slotW) / W, 1 - y / H];
  }
}
