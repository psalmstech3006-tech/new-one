import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Quality tiers (spec §15). Expensive effects scale; geometry and materials do not degrade to primitives.
export const TIERS = {
  'very-low': { scale: 0.6, dynMin: 0.45, shadows: 0, shadowSize: 1024, ao: false, bloom: false, aa: 'fxaa', far: 250, peds: 6, env: 64 },
  low:        { scale: 0.75, dynMin: 0.55, shadows: 2, shadowSize: 1024, shadowFar: 110, ao: false, bloom: true, aa: 'fxaa', far: 400, peds: 10, env: 128 },
  medium:     { scale: 1.0, dynMin: 0.7, shadows: 3, shadowSize: 2048, shadowFar: 130, ao: false, bloom: true, aa: 'smaa', far: 700, peds: 16, env: 256 },
  high:       { scale: 1.0, dynMin: 0.85, shadows: 4, shadowSize: 2048, shadowFar: 260, ao: true, bloom: true, aa: 'smaa', far: 1200, peds: 24, env: 256 },
};

export class Renderer {
  constructor(canvas, tierName) {
    this.tierName = tierName;
    this.tier = TIERS[tierName];
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.9;
    this.gl.shadowMap.enabled = this.tier.shadows > 0;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, this.tier.far);
    this.dynScale = 1;
    this.frameMs = 16;
    this.setupSky();
    this.setupPost();
    this.resize();
    addEventListener('resize', () => this.resize());
    // GPU timer where supported (dev overlay)
    this.timerExt = this.gl.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuMs = null;
  }

  setupSky() {
    const s = this.scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86;
    s.add(this.sky);
    this.sunDir = new THREE.Vector3();
    this.hemi = new THREE.HemisphereLight('#cfe0ff', '#6b5a48', 0.35);
    s.add(this.hemi);
    this.pmrem = new THREE.PMREMGenerator(this.gl);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    s.fog = new THREE.FogExp2('#c9b39a', 0.0022);
    if (this.tier.shadows > 0) {
      this.csm = new CSM({
        maxFar: Math.min(this.tier.far, this.tier.shadowFar ?? 180), cascades: this.tier.shadows, mode: 'practical', parent: s,
        shadowMapSize: this.tier.shadowSize, lightDirection: new THREE.Vector3(-1, -1, -1).normalize(),
        camera: this.camera, lightIntensity: 3.2, shadowBias: -0.0002,
      });
      for (const l of this.csm.lights) { l.shadow.normalBias = 0.04; }
    } else {
      this.sun = new THREE.DirectionalLight('#fff1dc', 3.2);
      s.add(this.sun, this.sun.target);
    }
  }

  // hours 0..24. Updates sky, sun light, fog and the image-based lighting environment.
  setTime(hours) {
    const t = ((hours - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(t) * 1.05, az = Math.PI * 0.35 + Math.cos(t) * 0.9;
    this.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    // keep the sky shader's sun just above the horizon at night so twilight/afterglow persists
    const skySun = this.sunDir.clone(); if (skySun.y < -0.02) skySun.y = -0.02 + (skySun.y + 0.02) * 0.05;
    for (const sky of [this.sky, this.envSky]) sky.material.uniforms.sunPosition.value.copy(skySun.normalize());
    const day = THREE.MathUtils.smoothstep(this.sunDir.y, -0.08, 0.25);
    const golden = Math.exp(-(((this.sunDir.y - 0.08) / 0.14) ** 2));
    const color = new THREE.Color('#fff4e6').lerp(new THREE.Color('#ffae5e'), golden * 0.8);
    // below the horizon the key light becomes a cool moonlight rather than going dark
    const moon = this.sunDir.y <= 0.02;
    if (moon) color.set('#9fb4e8');
    const intensity = moon ? 0.55 : 0.15 + 3.3 * day;
    const dir = !moon ? this.sunDir.clone().negate() : new THREE.Vector3(-0.35, -1, 0.25).normalize();
    if (this.csm) { this.csm.lightDirection.copy(dir); for (const l of this.csm.lights) { l.color.copy(color); l.intensity = intensity; } }
    else { this.sun.position.copy(dir).multiplyScalar(-100); this.sun.color.copy(color); this.sun.intensity = intensity; }
    this.hemi.intensity = 0.3 + 0.25 * day;
    this.hemi.color.set('#7f93c9').lerp(new THREE.Color('#cfe0ff'), day);
    this.gl.toneMappingExposure = THREE.MathUtils.lerp(1.35, 0.9, day);
    this.scene.fog.color.set('#27324a').lerp(new THREE.Color('#c9b8a6'), day).lerp(new THREE.Color('#e0a579'), golden * 0.5);
    // rebuild the environment map only when the sun moved noticeably
    if (!this._envDir || this._envDir.angleTo(this.sunDir) > 0.03) {
      this._envDir = this.sunDir.clone();
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, { size: this.tier.env });
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.45 + 0.55 * day;
    }
    this.night = 1 - day;
  }

  setupPost() {
    const T = this.tier;
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (T.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, innerWidth, innerHeight);
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 });
      this.gtao.blendIntensity = 0.85;
      this.composer.addPass(this.gtao);
    }
    if (T.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.22, 0.4, 2.2); this.composer.addPass(this.bloom); }
    this.composer.addPass(new OutputPass());
    if (T.aa === 'smaa') { this.aa = new SMAAPass(innerWidth, innerHeight); this.composer.addPass(this.aa); }
    else { this.aa = new ShaderPass(FXAAShader); this.composer.addPass(this.aa); }
  }

  // Register every material with the cascaded shadow map shader chunks.
  prepareMaterials() {
    if (!this.csm) return;
    const seen = new Set();
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!seen.has(m)) { seen.add(m); this.csm.setupMaterial(m); }
    });
  }
  setupMaterial(m) { this.csm?.setupMaterial(m); }

  resize() {
    const pr = Math.min(devicePixelRatio, 2) * this.tier.scale * this.dynScale;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
    if (this.aa?.material?.uniforms?.resolution) this.aa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.csm?.updateFrustums();
  }

  // Dynamic resolution: hold ~16.7ms (High/Medium) or ~33ms (Low tiers).
  adaptResolution(frameMs) {
    this.frameMs = this.frameMs * 0.95 + frameMs * 0.05;
    const target = this.tier.scale >= 1 ? 17.5 : 30;
    this._adaptT = (this._adaptT || 0) + 1;
    if (this._adaptT < 60) return;
    this._adaptT = 0;
    const old = this.dynScale;
    if (this.frameMs > target * 1.1) this.dynScale = Math.max(this.tier.dynMin, this.dynScale - 0.05);
    else if (this.frameMs < target * 0.75) this.dynScale = Math.min(1, this.dynScale + 0.05);
    if (old !== this.dynScale) this.resize();
  }

  render() {
    this.gl.info.reset();
    this.csm?.update();
    this.sky.position.copy(this.camera.position);
    let q = null;
    const gl = this.gl.getContext();
    if (this.timerExt && !this._pending) { q = gl.createQuery(); gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q); }
    this.composer.render();
    if (q) { gl.endQuery(this.timerExt.TIME_ELAPSED_EXT); this._pending = q; }
    if (this._pending && this._pending !== q) {
      const ready = gl.getQueryParameter(this._pending, gl.QUERY_RESULT_AVAILABLE);
      if (ready) { this.gpuMs = gl.getQueryParameter(this._pending, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(this._pending); this._pending = null; }
    }
  }
}
