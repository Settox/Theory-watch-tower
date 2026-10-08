// Optional sound & ambience, synthesized with Web Audio. All off by default; the AudioContext is created on the first user gesture.
import { settings, on, emit, page } from './core.js';

const PENTA = [0, 2, 4, 7, 9]; // semitones of a major pentatonic
const MOODS = { // root Hz, pad filter, note-gap range (s), note octave multiplier
  calm: { root: 110, lp: 700, gap: [4, 9], oct: 2 },
  shimmer: { root: 196, lp: 2200, gap: [1.5, 4], oct: 4 },
  deep: { root: 55, lp: 320, gap: [7, 14], oct: 2 },
};
const MAX = 0.35; // hard ceiling for every bus gain
let ctx, sfx, music, verb, vin, voices = 0, lastChime = 0, pad, noteTimer, gestured = false;
const vol = (k, d) => Math.min(1, Math.max(0, (settings[k] ?? d) / 100)) * MAX;
const freqOf = (n, base = 261.63) => base * 2 ** (PENTA[((n % 5) + 5) % 5] / 12 + (Math.floor(n / 5) % 3));

function ensure() {
  if (ctx || !gestured) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC({ latencyHint: 'interactive' });
  sfx = ctx.createGain(); music = ctx.createGain(); sfx.connect(ctx.destination); music.connect(ctx.destination);
  music.gain.value = 0; applyVol();
  // shared reverb input is always valid; the convolver (short 1.2s impulse at 24kHz, built once off the hot path) plugs in when ready
  vin = ctx.createGain(); vin.gain.value = 0.6;
  const dl = ctx.createDelay(1); dl.delayTime.value = 0.45; const fb = ctx.createGain(); fb.gain.value = 0.35; dl.connect(fb); fb.connect(dl); dl.connect(music);
  vin.dl = dl;
  (self.requestIdleCallback || setTimeout)(() => {
    try { // the impulse MUST use the context's own sample rate (browsers reject a mismatch, e.g. 24k vs a 48k/192k device)
      const sr = ctx.sampleRate, len = sr * 1.2 | 0, buf = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
      verb = ctx.createConvolver(); verb.buffer = buf; const wet = ctx.createGain(); wet.gain.value = 0.6; vin.connect(verb); verb.connect(wet); wet.connect(music);
    } catch (e) { console.warn('reverb unavailable, using delay only', e); }
  });
  return ctx;
}
function applyVol() {
  if (!ctx) return;
  const t = ctx.currentTime;
  sfx.gain.setTargetAtTime(vol('sfxVol', 40), t, 0.05);
  if (settings.musicOn) music.gain.setTargetAtTime(vol('musicVol', 25), t, 0.3);
}

export function chime(note = 0) {
  if (!ensure()) return;
  const now = performance.now(); if (now - lastChime < 70 || voices >= 6) return; lastChime = now;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime, f = freqOf(note);
  [[f, 'sine', 0.6], [f * 2, 'triangle', 0.25]].forEach(([fr, type, g]) => {
    const o = ctx.createOscillator(), e = ctx.createGain(); o.type = type; o.frequency.value = fr; voices++;
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(e); e.connect(sfx); e.connect(vin); o.start(t); o.stop(t + 1.3);
    o.onended = () => { voices--; o.disconnect(); e.disconnect(); };
  });
}

function startMusic() {
  if (!ensure() || pad) return;
  if (ctx.state === 'suspended') ctx.resume();
  const m = MOODS[settings.musicMood] || MOODS.calm, t = ctx.currentTime;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = m.lp; lp.Q.value = 0.7;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = m.lp * 0.3; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  const g = ctx.createGain(); g.gain.value = 0.5; lp.connect(g); g.connect(music); g.connect(vin); g.connect(vin.dl);
  const oscs = [[m.root, -7, 'sawtooth'], [m.root * 1.5, 6, 'triangle'], [m.root * 2, 0, 'sine']].map(([f, det, type]) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det; o.connect(lp); o.start(); return o;
  });
  pad = { lp, g, oscs, lfo };
  music.gain.cancelScheduledValues(t); music.gain.setValueAtTime(music.gain.value, t); music.gain.linearRampToValueAtTime(vol('musicVol', 25), t + 3);
  const note = () => {
    if (!pad) return;
    const n = Math.floor(Math.random() * 10), nt = ctx.currentTime, o = ctx.createOscillator(), e = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = freqOf(n, m.root * m.oct);
    e.gain.setValueAtTime(0.0001, nt); e.gain.linearRampToValueAtTime(0.18, nt + 2.5); e.gain.linearRampToValueAtTime(0.0001, nt + 7);
    o.connect(e); e.connect(music); e.connect(vin); o.start(nt); o.stop(nt + 7.2); o.onended = () => { o.disconnect(); e.disconnect(); };
    noteTimer = setTimeout(note, (m.gap[0] + Math.random() * (m.gap[1] - m.gap[0])) * 1000);
  };
  noteTimer = setTimeout(note, 1500);
}
function stopMusic() {
  if (!pad) return;
  const p = pad, t = ctx.currentTime; pad = null; clearTimeout(noteTimer);
  music.gain.cancelScheduledValues(t); music.gain.setValueAtTime(music.gain.value, t); music.gain.linearRampToValueAtTime(0, t + 1.5);
  setTimeout(() => { p.oscs.forEach((o) => o.stop()); p.lfo.stop(); p.lp.disconnect(); p.g.disconnect(); }, 1700);
}
const sync = () => (settings.musicOn ? startMusic() : stopMusic());

export function init() {
  const go = () => { gestured = true; ensure(); removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (settings.musicOn) startMusic(); };
  addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
  document.addEventListener('visibilitychange', () => { if (!ctx) return; document.hidden ? ctx.suspend() : (settings.musicOn || sfx) && ctx.resume(); });
  on('link-created', () => { if (settings.sfxChime) chime(page().connections.length); });
  let prev = {}; const snap = () => { const p = page(); prev = { id: p.id, n: p.nodes.length }; }; snap();
  on('state-replaced', snap);
  on('changed', () => { const p = page(); if (settings.sfxAdd && p.id === prev.id && p.nodes.length - prev.n > 0 && p.nodes.length - prev.n < 4) chime(p.nodes.length + 2); snap(); });
  on('settings-changed', ({ key }) => { if (key === 'musicOn') sync(); if (key === 'musicMood' && pad) { stopMusic(); setTimeout(sync, 1800); } });
  emit('register-settings', (box, ui) => {
    box.append(ui.toggle('Chimes when stars are linked', 'sfxChime', false), ui.toggle('Soft chime when a star is added', 'sfxAdd', false), ui.toggle('Ambient music', 'musicOn', false),
      ui.select('Ambient mood', 'musicMood', [['calm', 'Calm drone'], ['shimmer', 'Shimmer'], ['deep', 'Deep space']], 'calm'),
      ui.slider('Music volume', 'musicVol', 25), ui.slider('Chime volume', 'sfxVol', 40));
    box.addEventListener('input', () => setTimeout(applyVol)); // sliders save without emitting; apply after settings update
    box.addEventListener('change', () => setTimeout(applyVol));
  });
}
