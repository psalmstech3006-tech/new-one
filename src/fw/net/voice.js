import * as THREE from 'three';

// ============================================================================
// Proximity voice chat.
//   transport  : WebRTC peer-to-peer audio (Opus). The game server only relays signalling
//                (SDP offers/answers, ICE candidates); audio never passes through it.
//   topology   : partial mesh — each client connects to at most MAX_PEERS nearest voice-
//                enabled players inside CONNECT_R (hysteresis DROP_R). Larger sessions can
//                swap this module's transport for an SFU without touching the game.
//   spatial    : every remote stream → Web Audio HRTF PannerNode at the speaker's head,
//                listener = camera. Linear falloff to 0 at HEAR_R; hard mute beyond it.
//   privacy    : microphone only after an explicit user action; mute stops sending
//                (sender.replaceTrack(null)), not just local silence.
// ============================================================================

export const VOICE = { HEAR_R: 30, CONNECT_R: 45, DROP_R: 60, MAX_PEERS: 8 };
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

export class Voice {
  constructor(net, { camera, hud }) {
    this.net = net; this.camera = camera; this.hud = hud;
    this.peers = new Map();      // remote id -> peer
    this.state = 'off';          // off | requesting | live | muted | denied | unsupported
    this.stream = null; this.track = null;
    this.supported = !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
    if (!this.supported) this.state = 'unsupported';
    this.remoteVoice = new Map(); // id -> {on, muted} as announced by the server
    this.vadTimer = setInterval(() => this.vad(), 50);
    this.render();
  }

  // Voice activity detection at 20 Hz, independent of the render frame rate: RMS over the
  // analyser window with a 400 ms hold so the indicator doesn't flicker between syllables.
  vad() {
    const buf = new Float32Array(512);
    for (const p of this.peers.values()) {
      if (!p.analyser) continue;
      p.analyser.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x;
      p.level = Math.sqrt(s / buf.length);
      p.hold = p.level > 0.008 ? 0.4 : Math.max(0, (p.hold || 0) - 0.05);
    }
  }

  // Called from a user gesture (click to play): lets the page play remote voices.
  unlock() {
    if (!this.supported) return;
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    this.ctx.resume?.().catch(() => {});
  }

  // ---- microphone ----------------------------------------------------------
  async enable() {
    if (!this.supported || this.state === 'requesting') return;
    if (this.stream) { this.setMuted(false); return; }
    this.state = 'requesting'; this.render();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    } catch (e) {
      this.state = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'unavailable'; this.error = e?.message || String(e);
      this.render(); return;
    }
    this.track = this.stream.getAudioTracks()[0];
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    // local level meter (never routed to the speakers: no self-echo)
    this.localAnalyser = this.ctx.createAnalyser(); this.localAnalyser.fftSize = 512;
    this.ctx.createMediaStreamSource(this.stream).connect(this.localAnalyser);
    this.state = 'live';
    for (const p of this.peers.values()) this.attachTrack(p);
    this.net.send({ t: 'voice', on: true, muted: false });
    this.render();
  }

  setMuted(m) {
    if (!this.track) return;
    this.state = m ? 'muted' : 'live';
    this.track.enabled = !m;
    for (const p of this.peers.values()) this.attachTrack(p);
    this.net.send({ t: 'voice', on: true, muted: m });
    this.render();
  }
  toggle() { if (this.state === 'live') this.setMuted(true); else this.enable(); }

  disable() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.track = null; this.state = 'off';
    this.net.send({ t: 'voice', on: false });
    this.render();
  }

  // Sending side: only a live, unmuted track is ever attached to a sender.
  attachTrack(p) {
    const send = this.state === 'live' ? this.track : null;
    if (p.sender) p.sender.replaceTrack(send).catch(() => {});
  }

  // ---- signalling -----------------------------------------------------------
  onSignal(m) { // {t:'rtc', from, sdp?, ice?}
    if (m.bye) { this.closePeer(m.from, 'bye', false); return; }
    let p = this.peers.get(m.from);
    if (!p) { if (!m.sdp || m.sdp.type !== 'offer') return; p = this.openPeer(m.from, false); }
    (async () => {
      try {
        if (m.sdp) {
          await p.pc.setRemoteDescription(m.sdp);
          if (!p.sender) { const tr = p.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio'); if (tr) { tr.direction = 'sendrecv'; p.sender = tr.sender; this.attachTrack(p); } }
          for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
          if (m.sdp.type === 'offer') { await p.pc.setLocalDescription(await p.pc.createAnswer()); this.net.send({ t: 'rtc', to: m.from, sdp: p.pc.localDescription }); }
        } else if (m.ice) {
          if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.ice).catch(() => {}); else p.pendingIce.push(m.ice);
        }
      } catch (e) { this.note('signal error ' + e.message); console.warn('voice signalling', e); }
    })();
  }
  onVoiceState(m) { this.remoteVoice.set(m.id, { on: m.on, muted: m.muted }); if (!m.on && !this.stream) this.closePeer(m.id, 'remote-off'); }
  note(t) { (this.log ||= []).push(`${(performance.now() / 1000).toFixed(1)} ${t}`); if (this.log.length > 40) this.log.shift(); }

  openPeer(id, initiator) {
    // STUN by default; deployments can add TURN relays (strict NATs) via fw-config.json iceServers
    const pc = new RTCPeerConnection({ iceServers: window.__fwConfig?.iceServers || ICE });
    this.note(`open ${id} ${initiator ? 'offer' : 'answer'}`);
    const p = { opened: performance.now(), id, pc, initiator, pendingIce: [], gain: null, panner: null, analyser: null, level: 0, speaking: false, audioEl: null };
    this.peers.set(id, p);
    // one bidirectional audio transceiver, created by the offerer; the answerer adopts the
    // offer's transceiver (adding its own would create a second, never-negotiated one)
    if (initiator) { const tr = pc.addTransceiver('audio', { direction: 'sendrecv' }); p.sender = tr.sender; this.attachTrack(p); }
    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ t: 'rtc', to: id, ice: e.candidate }); };
    pc.ontrack = (e) => this.playRemote(p, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { this.note(`pc ${id} ${pc.connectionState}`); if (['failed', 'closed'].includes(pc.connectionState)) this.closePeer(id, 'state'); };
    if (initiator) (async () => {
      try { await pc.setLocalDescription(await pc.createOffer()); this.net.send({ t: 'rtc', to: id, sdp: pc.localDescription }); } catch (e) { console.warn('voice offer', e); }
    })();
    return p;
  }

  playRemote(p, stream) {
    this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
    // Chrome only feeds WebRTC audio into Web Audio if the stream is also attached to a media element
    const el = new Audio(); el.muted = true; el.srcObject = stream; el.play().catch(() => {}); p.audioEl = el;
    const src = this.ctx.createMediaStreamSource(stream);
    p.analyser = this.ctx.createAnalyser(); p.analyser.fftSize = 512;
    p.gain = this.ctx.createGain(); p.gain.gain.value = 0;
    p.panner = new PannerNode(this.ctx, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1.5, maxDistance: VOICE.HEAR_R, rolloffFactor: 1 });
    src.connect(p.analyser); src.connect(p.gain); p.gain.connect(p.panner); p.panner.connect(this.ctx.destination);
  }

  closePeer(id, why = '', notify = true) {
    const p = this.peers.get(id); if (!p) return;
    this.note(`close ${id} ${why} (${p.pc.connectionState})`);
    // tell the other side so it doesn't sit on a dead link (and can reconnect cleanly)
    if (notify && why !== 'gone') this.net.send({ t: 'rtc', to: id, bye: 1 });
    this.peers.delete(id);
    try { p.pc.close(); } catch { /* already closed */ }
    p.gain?.disconnect(); p.panner?.disconnect();
    if (p.audioEl) { p.audioEl.srcObject = null; }
  }

  // ---- per frame --------------------------------------------------------------
  // remotes: Map id -> {char, vehicle}; me: local listener position
  update(dt, remotes, me) {
    if (!this.supported) return;
    // who should we be connected to? nearest voice-enabled players within range
    // a link is useful when at least one side talks (listening needs no microphone)
    const cands = [], iTalk = !!this.stream;
    for (const [id, r] of remotes) {
      const v = this.remoteVoice.get(id); if (!v?.on && !iTalk) continue;
      const pos = r.vehicle ? r.vehicle.position : r.char.position;
      cands.push({ id, d: pos.distanceTo(me), pos, theyTalk: !!v?.on });
    }
    cands.sort((a, b) => a.d - b.d);
    const keep = new Set(cands.filter((c, i) => i < VOICE.MAX_PEERS && c.d < VOICE.DROP_R).map((c) => c.id));
    // views of other players lag slightly; a fresh link gets a grace period before range drops
    const now = performance.now();
    for (const [id, p] of [...this.peers]) {
      if (!remotes.has(id)) this.closePeer(id, 'gone');
      else if (!keep.has(id) && now - p.opened > 5000) this.closePeer(id, 'out-of-range');
    }
    // talkers initiate; between two talkers the lower id offers (no offer glare)
    if (iTalk) for (const c of cands.slice(0, VOICE.MAX_PEERS)) if (c.d < VOICE.CONNECT_R && !this.peers.has(c.id) && (!c.theyTalk || this.net.id < c.id)) this.openPeer(c.id, true);

    // listener = camera
    const ctx = this.ctx; if (!ctx) { this.render(); return; }
    const cam = this.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const L = ctx.listener, t = ctx.currentTime;
    if (L.positionX) { L.positionX.setTargetAtTime(cam.position.x, t, 0.05); L.positionY.setTargetAtTime(cam.position.y, t, 0.05); L.positionZ.setTargetAtTime(cam.position.z, t, 0.05); L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z; }
    else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    const buf = new Float32Array(512);
    for (const p of this.peers.values()) {
      if (!p.panner) continue;
      const c = cands.find((q) => q.id === p.id); if (!c) continue;
      const head = c.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
      p.panner.positionX.setTargetAtTime(head.x, t, 0.05); p.panner.positionY.setTargetAtTime(head.y, t, 0.05); p.panner.positionZ.setTargetAtTime(head.z, t, 0.05);
      // hard radius: silence beyond HEAR_R (the panner already fades linearly to it)
      const target = c.d < VOICE.HEAR_R ? 1 : 0;
      p.gain.gain.setTargetAtTime(target, t, 0.08); p.audible = target;
      p.speaking = (p.hold || 0) > 0 && target > 0 && !this.remoteVoice.get(p.id)?.muted;
    }
    if (this.localAnalyser) { this.localAnalyser.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; this.localLevel = this.state === 'live' ? Math.sqrt(s / buf.length) : 0; }
    this.render();
  }

  // effective loudness of a remote player at the listener (0..1): panner linear model x gate
  loudness(id) {
    const p = this.peers.get(id); if (!p?.panner) return 0;
    const pos = new THREE.Vector3(p.panner.positionX.value, p.panner.positionY.value, p.panner.positionZ.value), d = pos.distanceTo(this.camera.position);
    const lin = 1 - Math.min(1, Math.max(0, d - 1.5) / (VOICE.HEAR_R - 1.5));
    return lin * (p.audible || 0);
  }

  render() {
    const h = this.hud; if (!h) return;
    const label = { off: 'Voice off — M to talk', requesting: 'Allow microphone…', live: 'Mic live — M to mute', muted: 'Muted — M to unmute', denied: 'Microphone blocked — allow it in the browser to talk', unavailable: 'No microphone found', unsupported: 'Voice not supported in this browser' }[this.state];
    if (h.dataset.state !== this.state) { h.dataset.state = this.state; h.querySelector('.t').textContent = label; }
    const lvl = Math.min(1, (this.localLevel || 0) * 12);
    h.querySelector('.lvl').style.width = `${lvl * 100}%`;
  }
}
