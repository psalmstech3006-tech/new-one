import * as THREE from 'three';

// Art generated with Higgsfield (z_image). Local copies in /assets are tried first,
// then the Higgsfield CDN, then a procedural canvas fallback so the game always runs.
// Opened straight from disk (file://), relative asset paths can't load, so skip them.
const local = (path) => (location.protocol === 'file:' ? [] : [path]);
const HF = 'https://d8j0ntlcm91z4.cloudfront.net/user_3JneAcQeA5p58UuiLtedWKxicZd/';
export const ART = {
  keyArt: [...local('assets/key-art.png'), HF + 'hf_20260928_231525_7c6d8467-d083-485c-80c8-4a1066c859fd_min.webp'],
  loadHighway: [...local('assets/load-highway.png'), HF + 'hf_20260928_231449_a8fd9dbb-133f-4ecf-ae4d-05869c2dabb8_min.webp'],
  loadSkyline: [...local('assets/load-skyline.png'), HF + 'hf_20260928_231448_da0b2c9f-cfac-45e4-a53a-8eefc785673a_min.webp'],
};
const TEX = {
  brick: [...local('assets/tex-brick.png'), HF + 'hf_20260928_231449_e392cd57-e156-4120-bec4-ed91837fe0a8_min.webp'],
  asphalt: [...local('assets/tex-asphalt.png'), HF + 'hf_20260928_231448_2c0b634a-3c72-4fd3-b7f0-08beea099f4a_min.webp'],
  sidewalk: [...local('assets/tex-sidewalk.png'), HF + 'hf_20260928_231449_d720ea60-3803-4e90-bb9a-271d326e72fc_min.webp'],
  glass: [...local('assets/tex-glass.png'), HF + 'hf_20260928_231448_4160c073-e7a9-4487-b6df-17a6939b4f86_min.webp'],
};

// Resolve the first image URL that loads (used for CSS backgrounds on menus).
export function firstLoadable(urls) {
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= urls.length) return resolve(null);
      const img = new Image();
      const url = urls[i++];
      const timer = setTimeout(() => { img.onload = img.onerror = null; next(); }, 6000);
      img.onload = () => { clearTimeout(timer); resolve(url); };
      img.onerror = () => { clearTimeout(timer); next(); };
      img.src = url;
    };
    next();
  });
}

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}

function noise(g, s, alpha, dark = 0, light = 255) {
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * alpha;
    img.data[i] = Math.min(light, Math.max(dark, img.data[i] + n));
    img.data[i + 1] = Math.min(light, Math.max(dark, img.data[i + 1] + n));
    img.data[i + 2] = Math.min(light, Math.max(dark, img.data[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

const PROC = {
  asphalt: () => canvas(256, (g, s) => {
    g.fillStyle = '#3a3a3c'; g.fillRect(0, 0, s, s); noise(g, s, 40);
    g.strokeStyle = 'rgba(20,20,20,0.5)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 30; y += (Math.random() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
  }),
  sidewalk: () => canvas(256, (g, s) => {
    g.fillStyle = '#a9a59c'; g.fillRect(0, 0, s, s); noise(g, s, 26);
    g.strokeStyle = '#7d7a72'; g.lineWidth = 3;
    g.strokeRect(1, 1, s / 2 - 2, s / 2 - 2); g.strokeRect(s / 2 + 1, 1, s / 2 - 2, s / 2 - 2);
    g.strokeRect(1, s / 2 + 1, s / 2 - 2, s / 2 - 2); g.strokeRect(s / 2 + 1, s / 2 + 1, s / 2 - 2, s / 2 - 2);
  }),
  brick: () => canvas(256, (g, s) => {
    g.fillStyle = '#8a4a36'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#6f3a2b';
    for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? -8 : 0; x < s; x += 16) g.fillRect(x, y, 15, 1), g.fillRect(x, y, 1, 8);
    noise(g, s, 30);
    for (const [wx, wy] of [[40, 40], [152, 40], [40, 152], [152, 152]]) {
      g.fillStyle = '#e8e2d6'; g.fillRect(wx - 4, wy - 4, 72, 72);
      const gr = g.createLinearGradient(wx, wy, wx + 64, wy + 64); gr.addColorStop(0, '#2d3b48'); gr.addColorStop(1, '#101820');
      g.fillStyle = gr; g.fillRect(wx, wy, 64, 64);
      g.fillStyle = '#e8e2d6'; g.fillRect(wx + 30, wy, 4, 64); g.fillRect(wx, wy + 30, 64, 4);
    }
  }),
  glass: () => canvas(256, (g, s) => {
    g.fillStyle = '#5c6670'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const gr = g.createLinearGradient(0, y * 64, 0, y * 64 + 64);
      gr.addColorStop(0, '#6d9cc4'); gr.addColorStop(1, '#27435e');
      g.fillStyle = gr; g.fillRect(x * 64 + 4, y * 64 + 4, 56, 56);
    }
  }),
  grass: () => canvas(256, (g, s) => {
    g.fillStyle = '#4d7a35'; g.fillRect(0, 0, s, s); noise(g, s, 50);
    for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.5 ? '#5c8c3e' : '#3f6a2b'; g.fillRect(Math.random() * s, Math.random() * s, 1, 3); }
  }),
};

// Night-time window glow mask, matched to the facade layouts above.
export function windowEmissive(kind) {
  const c = canvas(128, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    if (kind === 'brick') {
      for (const [wx, wy] of [[20, 20], [76, 20], [20, 76], [76, 76]]) if (Math.random() < 0.7) { g.fillStyle = '#ffcf7a'; g.fillRect(wx, wy, 32, 32); }
    } else {
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (Math.random() < 0.45) { g.fillStyle = '#fff1c4'; g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28); }
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function toTexture(src) {
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    // a stalled request must not block loading; fall back after a timeout
    const timer = setTimeout(() => { img.onload = img.onerror = null; reject(new Error('timeout')); }, 4000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = (e) => { clearTimeout(timer); reject(e); };
    img.src = url;
  });
}

// Loads all textures, reporting progress; never rejects.
export async function loadTextures(onProgress) {
  const out = {};
  const keys = Object.keys(PROC);
  let done = 0;
  await Promise.all(keys.map(async (k) => {
    let img = null;
    for (const url of TEX[k] || []) {
      try { img = await loadImage(url); break; } catch { /* try next source */ }
    }
    out[k] = toTexture(img || PROC[k]());
    out[k].userData.generated = !!img;
    onProgress(++done / keys.length);
  }));
  return out;
}
