// All sounds are synthesised with WebAudio — no external audio files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
  }
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine: two detuned saws through a lowpass
    this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = this.ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600;
    this.eng1 = this.ctx.createOscillator(); this.eng1.type = 'sawtooth';
    this.eng2 = this.ctx.createOscillator(); this.eng2.type = 'square';
    this.eng1.connect(this.engFilter); this.eng2.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.eng1.start(); this.eng2.start();

    // siren
    this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0;
    this.siren = this.ctx.createOscillator(); this.siren.type = 'triangle'; this.siren.frequency.value = 700;
    this.siren.connect(this.sirenGain); this.sirenGain.connect(this.master); this.siren.start();

    // city ambience: filtered noise
    const amb = this.ctx.createBufferSource(); amb.buffer = this.noiseBuf; amb.loop = true;
    const af = this.ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 400;
    this.ambGain = this.ctx.createGain(); this.ambGain.gain.value = 0.03;
    amb.connect(af); af.connect(this.ambGain); this.ambGain.connect(this.master); amb.start();
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  noise(dur, freq, gain, type = 'lowpass', q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur);
  }
  tone(freq, dur, gain, type = 'sine', slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur);
  }
  gunshot(dist = 0, heavy = false) {
    const k = 1 / (1 + dist / 25);
    this.noise(heavy ? 0.25 : 0.18, heavy ? 1800 : 2500, 0.8 * k);
    this.tone(heavy ? 90 : 140, 0.12, 0.5 * k, 'square', -80);
  }
  explosion(dist = 0) {
    const k = 1 / (1 + dist / 60);
    this.noise(1.6, 300, 1.2 * k); this.noise(0.4, 1200, 0.6 * k); this.tone(50, 1.0, 0.8 * k, 'sine', -30);
  }
  crash(force) { this.noise(0.3, 900, Math.min(0.8, force / 20)); this.tone(120, 0.15, Math.min(0.3, force / 40), 'square', -60); }
  punch() { this.noise(0.08, 500, 0.5); }
  pickup() { this.tone(880, 0.08, 0.2, 'square'); setTimeout(() => this.tone(1320, 0.12, 0.2, 'square'), 70); }
  horn() { this.tone(392, 0.35, 0.25, 'square'); this.tone(466, 0.35, 0.2, 'square'); }
  uiMove() { this.tone(660, 0.05, 0.08, 'triangle'); }
  uiSelect() { this.tone(520, 0.06, 0.12, 'triangle'); setTimeout(() => this.tone(780, 0.1, 0.12, 'triangle'), 60); }
  mission() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.18, 'triangle'), i * 120)); }
  fail() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 0.2, 'sawtooth'), i * 180)); }
  deathSting() { this.tone(220, 2.2, 0.35, 'sawtooth', -150); this.noise(2.0, 200, 0.4); }
  reload() { this.noise(0.05, 3000, 0.3, 'highpass'); setTimeout(() => this.noise(0.06, 2000, 0.3, 'highpass'), 220); }

  update(engine, siren) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (engine) {
      const rpm = 40 + engine.rpm * 110;
      this.eng1.frequency.setTargetAtTime(rpm, t, 0.05);
      this.eng2.frequency.setTargetAtTime(rpm * 0.502, t, 0.05);
      this.engFilter.frequency.setTargetAtTime(300 + engine.throttle * 900, t, 0.1);
      this.engGain.gain.setTargetAtTime(0.06 + engine.throttle * 0.06, t, 0.1);
    } else this.engGain.gain.setTargetAtTime(0, t, 0.1);
    if (siren > 0) {
      this.siren.frequency.setTargetAtTime(Math.sin(t * 4) > 0 ? 950 : 700, t, 0.02);
      this.sirenGain.gain.setTargetAtTime(0.05 * siren, t, 0.1);
    } else this.sirenGain.gain.setTargetAtTime(0, t, 0.2);
  }
}
