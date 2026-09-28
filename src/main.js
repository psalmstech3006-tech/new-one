import * as THREE from 'three';
import { Game } from './game.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { ART, firstLoadable, loadTextures } from './assets.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

// ---------------------------------------------------------------- settings
const DEFAULTS = { quality: 'medium', shadows: true, sens: 1, vol: 0.7 };
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('sundown-settings') || '{}') }; } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('sundown-settings', JSON.stringify(settings)); } catch { /* ignore */ } };
const readSave = () => { try { return JSON.parse(localStorage.getItem('sundown-save')); } catch { return null; } };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFShadowMap;

const audio = new Audio();
audio.setVolume(settings.vol);
const input = new Input(canvas);
input.sensitivity = settings.sens;
let game = null;
let state = 'title';

// ---------------------------------------------------------------- title screen
const setArt = async (el, urls) => {
  const url = await firstLoadable(urls);
  if (url) el.style.backgroundImage = `url("${url}")`; else el.classList.add('fallback');
};
setArt($('titleArt'), ART.keyArt);
$('btnContinue').hidden = !readSave();

const menuButtons = () => [...document.querySelectorAll('#mainMenu button:not([hidden])')];
let menuIndex = 0;
const highlight = () => menuButtons().forEach((b, i) => b.classList.toggle('sel', i === menuIndex));
highlight();

function showPanel(name) {
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== 'panel-' + name;
  $('mainMenu').hidden = !!name;
}
document.querySelectorAll('.panel .back').forEach((b) => b.addEventListener('click', () => { audio.uiMove(); showPanel(null); }));
$('mainMenu').addEventListener('click', (e) => {
  const act = e.target.dataset?.act;
  if (!act) return;
  audio.init(); audio.uiSelect();
  if (act === 'new') startGame(null);
  else if (act === 'continue') startGame(readSave());
  else showPanel(act);
});
$('mainMenu').addEventListener('mousemove', (e) => {
  const i = menuButtons().indexOf(e.target);
  if (i >= 0 && i !== menuIndex) { menuIndex = i; highlight(); audio.uiMove(); }
});

// settings controls (title + pause share values)
const bindSetting = (ids, key, parse, apply) => {
  for (const id of ids) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = settings[key]; else el.value = settings[key];
    el.addEventListener('input', () => {
      settings[key] = parse(el.type === 'checkbox' ? el.checked : el.value);
      for (const o of ids) if (o !== id) { const x = $(o); if (x.type === 'checkbox') x.checked = settings[key]; else x.value = settings[key]; }
      apply && apply(settings[key]);
      saveSettings();
    });
  }
};
bindSetting(['optQuality'], 'quality', String);
bindSetting(['optShadows'], 'shadows', Boolean);
bindSetting(['optSens', 'optSens2'], 'sens', Number, (v) => (input.sensitivity = v));
bindSetting(['optVol', 'optVol2'], 'vol', Number, (v) => audio.setVolume(v));

// ---------------------------------------------------------------- loading
const TIPS = [
  'Heat fades once no officer has eyes on you. Break line of sight and keep moving.',
  'Stopping your car next to an officer at low heat gets you arrested. Keep rolling.',
  'Fuel tankers carry a lot more bang than an ordinary car. Keep your distance.',
  'Health kits and armor respawn a minute after you take them.',
  'Hold the handbrake (Space) through a corner to kick the back end out.',
  'Press V to switch between first-person and third-person view.',
  'Yellow markers on the map are jobs from Rusty.',
];
async function startGame(save) {
  state = 'loading';
  $('title').hidden = true;
  $('loading').hidden = false;
  $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  setArt($('loadArt'), Math.random() < 0.5 ? ART.loadHighway : ART.loadSkyline);
  const setP = (p, text) => { $('loadfill').style.width = Math.round(p * 100) + '%'; if (text) $('loadText').textContent = text; };
  const tipTimer = setInterval(() => { $('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 4000);
  setP(0.05, 'Loading textures');
  const textures = await loadTextures((p) => setP(0.05 + p * 0.45));
  setP(0.55, 'Building city');
  await new Promise((r) => setTimeout(r, 50));
  if (game) disposeGame();
  renderer.shadowMap.enabled = settings.shadows;
  renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : settings.quality === 'medium' ? 1.5 : 1));
  game = new Game(renderer, textures, settings, audio, input);
  if (save) game.load(save);
  setP(0.85, 'Populating streets');
  // warm up shaders
  game.update(0.016);
  renderer.compile(game.scene, game.camera);
  renderer.render(game.scene, game.camera);
  setP(1, 'Ready');
  // hold the loading art for a moment so the screen doesn't flash
  await new Promise((r) => setTimeout(r, 1200));
  clearInterval(tipTimer);
  $('loading').hidden = true;
  state = 'play';
  document.body.classList.add('playing');
  game.hud.setVisible(true);
  input.enabled = true;
  audio.init();
  game.hud.message(save ? 'Welcome back to Sundown City.' : 'Welcome to <b>Sundown City</b>.<br>Walk into a <span class="y">yellow marker</span> to start a job.<br>Press <b>F</b> near a car to get in.', 7);
  if (!input.touch.active) canvas.requestPointerLock?.();
}
function disposeGame() {
  game.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  game = null;
}

// ---------------------------------------------------------------- pause
function setPaused(p) {
  if (!game) return;
  state = p ? 'pause' : 'play';
  $('pause').hidden = !p;
  game.hud.setVisible(!p);
  input.enabled = !p;
  if (p) {
    document.exitPointerLock?.();
    $('pauseMoney').textContent = '$' + game.money.toLocaleString();
    showTab('map');
    audio.ctx?.suspend();
  } else {
    audio.ctx?.resume();
    if (!input.touch.active) canvas.requestPointerLock?.();
  }
}
function showTab(name) {
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const t of document.querySelectorAll('#pause .tab')) t.hidden = t.id !== 'tab-' + name;
  if (name === 'map') requestAnimationFrame(() => game.hud.drawBigMap(game));
  if (name === 'stats') {
    const s = game.stats;
    $('statsTable').innerHTML = [
      ['Cash', '$' + game.money.toLocaleString()], ['Jobs completed', `${game.missions.done.length} / 4`],
      ['People taken out', s.kills], ['Vehicles destroyed', s.cars], ['Distance driven', (s.distance / 1609).toFixed(1) + ' mi'],
      ['Time of day', $('clock').textContent],
    ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  }
}
$('tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) { audio.uiMove(); showTab(e.target.dataset.tab); } });
$('btnSaveQuit').addEventListener('click', () => {
  game.save();
  setPaused(false);
  state = 'title'; input.enabled = false;
  document.exitPointerLock?.();
  document.body.classList.remove('playing');
  game.hud.setVisible(false);
  disposeGame();
  $('title').hidden = false; $('btnContinue').hidden = false; menuIndex = 0; highlight();
});
// Browsers release pointer lock on Esc themselves; treat that as a pause request.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'play' && !input.touch.active && !game?.dead) setPaused(true);
});

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
function frame() {
  requestAnimationFrame(frame);
  timer.update(); const dt = Math.min(timer.getDelta(), 0.05);
  if (state === 'title') {
    const btns = menuButtons();
    if (!$('mainMenu').hidden) {
      if (input.hit('ArrowDown', 'KeyS')) { menuIndex = (menuIndex + 1) % btns.length; highlight(); audio.init(); audio.uiMove(); }
      if (input.hit('ArrowUp', 'KeyW')) { menuIndex = (menuIndex - 1 + btns.length) % btns.length; highlight(); audio.init(); audio.uiMove(); }
      if (input.hit('Enter')) btns[menuIndex]?.click();
    } else if (input.hit('Escape', 'Backspace')) showPanel(null);
  } else if (state === 'play') {
    if (input.hit('Escape', 'KeyP')) setPaused(true);
    else if (input.hit('KeyM')) { setPaused(true); }
    else {
      game.update(dt);
      renderer.render(game.scene, game.camera);
    }
  } else if (state === 'pause') {
    if (input.hit('Escape', 'KeyP', 'KeyM')) setPaused(false);
    renderer.render(game.scene, game.camera);
  }
  input.endFrame();
}
frame();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  game?.resize(innerWidth, innerHeight);
  if (state === 'pause') game.hud.drawBigMap(game);
});
// Expose for debugging in the console.
window.__sundown = () => game;
