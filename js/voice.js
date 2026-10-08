// Voice entry: read-aloud mini player + hook for the translate dialog.
import { on, settings, saveSettings, toast, save, emit, escapeHtml, app } from './core.js';
import * as map from './map.js';
import { PROVS, KEY, provider, voiceOf, setVoice, synth, volumeText, textToBlocks } from './tts.js';

const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const rd = { v: null, segs: [], els: [], i: -1, playing: false, token: 0, speed: 1, cuts: [], lang: 'en-US', audio: new Audio(), cloud: false };
let H, P, ui; // helpers, player element, named ui parts

export function init(helpers) {
  H = helpers;
  on('read-volume', openPlayer);
  on('translate-volume', (id) => import('./translate.js').then((m) => m.openTranslate(id, H)).catch((e) => { console.error(e); toast('Translator not available'); }));
  addEventListener('beforeunload', () => speechSynthesis?.cancel());
}

/* ---------- segments ---------- */
const sentences = (t) => t.match(/[^.!?…]+[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g) || [t];
function makeSegments(blocks, MAX = 380) {
  const segs = [];
  blocks.forEach((b) => {
    let cur = '';
    const push = () => { const s = cur.trim(); if (s) segs.push({ pg: b.pg, text: s }); cur = ''; };
    sentences(b.text).forEach((s) => {
      s = s.trim(); if (!s) return;
      while (s.length > MAX) {
        let cut = s.lastIndexOf(', ', MAX); if (cut < MAX * 0.4) cut = s.lastIndexOf(' ', MAX); if (cut < 1) cut = MAX;
        if (cur) push(); segs.push({ pg: b.pg, text: s.slice(0, cut + 1).trim() }); s = s.slice(cut + 1).trim();
      }
      if (cur && cur.length + s.length + 1 > MAX) push();
      cur += (cur ? ' ' : '') + s;
    });
    push();
  });
  return segs;
}

/* ---------- player DOM ---------- */
function build() {
  const { h, btn } = H, ic = (t, title, fn, cls = '') => Object.assign(btn(t, fn, cls), { title, ariaLabel: title });
  ui = {
    title: h('span', { className: 'vp-title' }), count: h('span', { className: 'vp-count mono' }), text: h('div', { className: 'vp-text' }),
    play: ic('▶', 'Play / pause', () => toggle(), 'primary'), speed: h('select', { title: 'Speed', onchange() { rd.speed = +this.value; rd.audio.playbackRate = rd.speed; if (rd.playing && !rd.cloud) playFrom(rd.i); } }, ...[0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((s) => h('option', { value: s, textContent: s + '×', selected: s === 1 }))),
    prov: h('select', { title: 'Voice service', onchange() { settings.ttsProvider = this.value; saveSettings(); voiceCtl(); if (rd.playing) playFrom(rd.i); } }, ...Object.entries(PROVS).map(([k, v]) => h('option', { value: k, textContent: v }))),
    voice: h('span', { className: 'vp-voice' }),
  };
  P = h('div', { id: 'voicePlayer', hidden: true, role: 'region', ariaLabel: 'Read aloud' },
    h('div', { className: 'vp-head' }, ui.title, ui.count, ic('▁', 'Minimise', () => { P.classList.toggle('mini'); highlight(rd.i); }), ic('✕', 'Close', close)),
    ui.text,
    h('div', { className: 'vp-ctl' },
      ic('⏮', 'Previous sentence', () => step(-1)), ui.play, ic('⏭', 'Next sentence', () => step(1)), ui.speed, ui.prov, ui.voice,
      ic('✦ Star', 'Make a star from the current sentence (or your selection) and remove it from the volume', makeNode), ic('↶', 'Undo: put the last sentence back into the volume', undoCut)));
  ui.text.onclick = (e) => { const d = e.target.closest('.vp-seg'); if (d && !selection()) { unlock(); playFrom(+d.dataset.i); } };
  document.body.appendChild(P);
  new ResizeObserver(() => document.documentElement.style.setProperty('--vp-h', (P.hidden ? 0 : P.offsetHeight) + 'px')).observe(P);
}

function voiceCtl() { // browser: voice dropdown; cloud: free-text voice id + key hint
  const { h } = H, p = provider(); ui.prov.value = p; ui.voice.textContent = '';
  if (p === 'browser') {
    ui.voice.append(h('button', { type: 'button', className: 'btn', textContent: '🎙 Voice', title: 'Choose voice, language, speed, pitch and volume', onclick: voicePanel }));
    speechSynthesis.onvoiceschanged = () => { if (!document.getElementById('vp-pop')?.hidden) fillPanel(); };
  } else {
    ui.voice.append(h('input', { value: voiceOf(p), placeholder: 'voice', title: 'Voice id / name', onchange() { setVoice(p, this.value.trim()); saveSettings(); } }));
    if (!settings[KEY[p]]) toast(`Add the ${PROVS[p]} key in Settings to use this voice.`);
  }
}


/* ---------- voice panel (browser voices): language, voice, speed, pitch, volume, preview ---------- */
const langName = (c) => { try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(c.replace('_', '-')) || c; } catch { return c; } };
const voiceLabel = (v) => `${/natural|neural|premium|enhanced|online|google|siri/i.test(v.name) ? '★ ' : ''}${v.name}${v.localService ? '' : ' · online'}`;
function voicePanel() {
  let pop = document.getElementById('vp-pop');
  if (!pop) { pop = H.h('div', { id: 'vp-pop', role: 'dialog', ariaLabel: 'Voice options' }); P.append(pop); }
  else if (!pop.hidden) { pop.hidden = true; return; }
  pop.hidden = false; fillPanel();
}
function fillPanel() {
  const { h } = H, pop = document.getElementById('vp-pop'); if (!pop) return;
  const all = (window.speechSynthesis?.getVoices() || []).slice().sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name)), l2 = rd.lang.slice(0, 2).toLowerCase();
  const langs = [...new Set(all.map((v) => v.lang.replace('_', '-')))];
  const row = (label, ...kids) => h('label', { className: 'vp-row' }, h('span', { textContent: label }), ...kids);
  const restart = () => { if (rd.playing) playFrom(rd.i); };
  const opt = (v) => h('option', { value: v.voiceURI, textContent: `${voiceLabel(v)} · ${v.lang}`, selected: v.voiceURI === settings.sysVoice });
  const match = all.filter((v) => v.lang.toLowerCase().startsWith(l2)), rest = all.filter((v) => !v.lang.toLowerCase().startsWith(l2));
  const groups = [...new Set(rest.map((v) => v.lang.split(/[-_]/)[0]))].map((c) => h('optgroup', { label: langName(c) }, ...rest.filter((v) => v.lang.split(/[-_]/)[0] === c).map(opt)));
  const langSel = h('select', { title: 'Reading language', onchange() { rd.lang = this.value; settings.speechLang = this.value; settings.sysVoice = ''; saveSettings(); fillPanel(); restart(); } },
    ...[...new Set([rd.lang, ...langs])].map((c) => h('option', { value: c, textContent: `${langName(c)} (${c})`, selected: c === rd.lang })));
  const voiceSel = h('select', { title: 'Voice', onchange() { settings.sysVoice = this.value; const v = all.find((x) => x.voiceURI === this.value); if (v) { rd.lang = v.lang; settings.speechLang = v.lang; langSel.value = v.lang; } saveSettings(); restart(); } },
    h('option', { value: '', textContent: 'Automatic (best match)' }), ...(match.length ? [h('optgroup', { label: `Matches ${langName(l2)}` }, ...match.map(opt))] : []), ...groups);
  const slide = (label, key, min, max, step, def, fmt, apply) => {
    const out = h('span', { className: 'mono', textContent: fmt(settings[key] ?? def) }), i = h('input', { type: 'range', min, max, step, value: settings[key] ?? def });
    i.oninput = () => { out.textContent = fmt(+i.value); apply(+i.value); }; i.onchange = restart;
    return h('label', { className: 'vp-row' }, h('span', { style: 'display:flex;justify-content:space-between' }, label, out), i);
  };
  const sample = () => (rd.segs[rd.i]?.text || rd.segs[0]?.text || 'This is how this voice sounds.').slice(0, 160);
  pop.textContent = '';
  pop.append(h('div', { className: 'vp-pop-head' }, h('b', { className: 'serif', textContent: 'Voice' }), h('button', { type: 'button', className: 'btn', textContent: '✕', ariaLabel: 'Close', onclick: () => { pop.hidden = true; } })),
    all.length ? '' : h('p', { className: 'hint', textContent: 'No voices found yet. Your browser may still be loading them, or this device has none installed.' }),
    row('Language', langSel), row('Voice', voiceSel),
    slide('Speed', 'ttsSpeed', 0.5, 3, 0.05, rd.speed, (n) => n.toFixed(2) + '×', (n) => { rd.speed = n; settings.ttsSpeed = n; saveSettings(); }),
    slide('Pitch', 'ttsPitch', 0.5, 2, 0.05, 1, (n) => n.toFixed(2), (n) => { settings.ttsPitch = n; saveSettings(); }),
    slide('Volume', 'ttsVol', 0, 1, 0.05, 1, (n) => Math.round(n * 100) + '%', (n) => { settings.ttsVol = n; saveSettings(); }),
    h('div', { className: 'vp-row', style: 'display:flex;gap:8px;justify-content:flex-end' },
      H.btn('Reset', () => { delete settings.sysVoice; delete settings.ttsPitch; delete settings.ttsVol; delete settings.ttsSpeed; rd.speed = 1; ui.speed.value = 1; saveSettings(); fillPanel(); restart(); }),
      H.btn('▶ Preview', () => {
        speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(sample()), v = all.find((x) => x.voiceURI === settings.sysVoice);
        u.voice = v || all.find((x) => x.lang.toLowerCase().startsWith(l2)) || null; u.lang = v?.lang || rd.lang; u.rate = rd.speed; u.pitch = settings.ttsPitch ?? 1; u.volume = settings.ttsVol ?? 1; speechSynthesis.speak(u);
      }, 'primary')));
}

/* ---------- open / close ---------- */
async function openPlayer(vid) {
  const v = app.state.volumes.find((x) => x.id === vid); if (!v) return;
  if (!P) build();
  stop(); Object.assign(rd, { speed: settings.ttsSpeed || rd.speed || 1, v, segs: [], els: [], i: -1, playing: false, cuts: [], lang: v.lang || settings.speechLang || navigator.language || 'en-US' });
  P.hidden = false; P.classList.remove('mini'); ui.title.textContent = v.name || 'Reading'; ui.text.textContent = 'Preparing text…'; voiceCtl(); refresh();
  const tok = rd.token, text = await volumeText(v);
  if (tok !== rd.token || rd.v !== v) return;
  rd.segs = makeSegments(textToBlocks(text));
  if (!rd.segs.length) { ui.text.textContent = 'No text to read' + (v.type === 'pdf' ? ' (scanned PDF? needs OCR).' : '.'); refresh(); return; }
  const f = document.createDocumentFragment(); let lastPg = null;
  rd.segs.forEach((s, i) => {
    if (s.pg != null && s.pg !== lastPg) { f.append(H.h('div', { className: 'vp-pg mono', textContent: 'Page ' + s.pg })); lastPg = s.pg; }
    const d = H.h('div', { className: 'vp-seg', textContent: s.text }); d.dataset.i = i; f.append(d); rd.els.push(d);
  });
  ui.text.textContent = ''; ui.text.append(f); rd.i = 0; highlight(0); refresh();
}
function close() { stop(); rd.playing = false; rd.v = null; P.hidden = true; document.documentElement.style.setProperty('--vp-h', '0px'); }

/* ---------- playback ---------- */
function stop() { rd.token++; try { rd.audio.pause(); } catch {} try { speechSynthesis?.cancel(); } catch {} }
const unlock = () => { try { rd.audio.src = SILENT; rd.audio.play()?.catch(() => {}); } catch {} };
function refresh() {
  const n = rd.segs.length; ui.count.textContent = n ? `${Math.max(rd.i + 1, 0)} / ${n}` : '';
  ui.play.textContent = rd.playing ? '❚❚' : '▶';
}
function highlight(i) {
  const cur = rd.els[i];
  rd.els.forEach((el, k) => { el.classList.toggle('cur', k === i); el.classList.toggle('done', k < i); });
  if (cur && !P.classList.contains('mini')) ui.text.scrollTo({ top: cur.offsetTop - ui.text.clientHeight / 2 + cur.offsetHeight / 2, behavior: 'smooth' });
  ui.text.dataset.now = rd.segs[i]?.text || '';
}
function toggle() {
  if (rd.playing) { rd.playing = false; if (rd.cloud) rd.audio.pause(); else stop(); refresh(); return; }
  unlock();
  if (rd.cloud && provider() !== 'browser' && rd.audio.src && !rd.audio.ended && rd.audio.src !== SILENT && rd.i >= 0) { rd.playing = true; rd.audio.play().catch(() => {}); refresh(); return; }
  playFrom(rd.i >= 0 ? rd.i : 0);
}
function step(d) {
  unlock(); let n = rd.i + d; while (rd.segs[n]?.cut) n += d;
  n = Math.max(0, Math.min(rd.segs.length - 1, n));
  if (rd.playing) playFrom(n); else { stop(); rd.i = n; highlight(n); refresh(); }
}
async function playFrom(i) {
  while (rd.segs[i]?.cut) i++;
  if (i < 0 || i >= rd.segs.length) { rd.playing = false; refresh(); return; }
  stop(); const tok = rd.token; rd.i = i; rd.playing = true; highlight(i); refresh();
  const seg = rd.segs[i], p = provider(), fail = (m) => { if (tok !== rd.token) return; rd.playing = false; refresh(); toast(m); };
  rd.cloud = p !== 'browser';
  if (!rd.cloud) {
    if (!window.speechSynthesis) return fail('This browser has no speech synthesis; pick another voice service.');
    const u = new SpeechSynthesisUtterance(seg.text); u.lang = rd.lang; u.rate = rd.speed; u.pitch = settings.ttsPitch ?? 1; u.volume = settings.ttsVol ?? 1;
    const vs = speechSynthesis.getVoices(), l2 = rd.lang.slice(0, 2).toLowerCase();
    u.voice = vs.find((v) => v.voiceURI === settings.sysVoice) || vs.find((v) => v.lang.toLowerCase().startsWith(l2)) || null; // a voice you picked is used even if its language differs from the book's
    if (u.voice && settings.sysVoice === u.voice.voiceURI) u.lang = u.voice.lang;
    u.onend = () => { if (tok === rd.token && rd.playing) playFrom(i + 1); };
    u.onerror = (e) => { if (!/canceled|interrupted/.test(e.error)) fail('Speech error: ' + e.error); };
    speechSynthesis.speak(u); return;
  }
  try {
    const cancel = () => tok !== rd.token, url = await synth(p, seg.text, rd.segs[i - 1]?.text, rd.segs[i + 1]?.text, cancel);
    if (cancel()) return;
    const a = rd.audio; a.onended = () => { if (tok === rd.token && rd.playing) playFrom(i + 1); }; a.src = url; a.playbackRate = rd.speed;
    await a.play().catch(() => fail('The browser blocked playback: press Play.'));
    prefetch(i + 1, tok);
  } catch (e) { fail(e.message || 'Voice error'); }
}
async function prefetch(from, tok) {
  for (let j = from; j < from + 2 && j < rd.segs.length && tok === rd.token; j++) { try { await synth(provider(), rd.segs[j].text, rd.segs[j - 1]?.text, rd.segs[j + 1]?.text, () => tok !== rd.token); } catch { return; } }
}

/* ---------- star (creates the star and removes the sentence from the volume) ---------- */
function selection() {
  const s = getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null;
  const r = s.getRangeAt(0); if (!ui.text.contains(r.commonAncestorContainer)) return null;
  const text = s.toString().replace(/\s+/g, ' ').trim(), idx = []; rd.els.forEach((el, k) => { if (r.intersectsNode(el)) idx.push(k); });
  return text && idx.length ? { text, idx } : null;
}
function makeNode() { // one action: create the star AND take the sentence out of the volume (undo puts it back)
  const v = rd.v, t = selection() || (rd.segs[rd.i] && { text: rd.segs[rd.i].text, idx: [rd.i] });
  if (!t) return toast('Nothing to use: start reading or select some text.');
  const pg = rd.segs[t.idx[0]]?.pg, name = v.name || 'Volume';
  const source = { type: v.type || 'text', volumeId: v.id, volumeName: name, phrase: t.text, ...(pg != null && { page: pg }) };
  map.addNode({ title: name + (pg != null ? ' - p.' + pg : ''), body: '<p>' + escapeHtml(t.text) + '</p>', source });
  getSelection().removeAllRanges();
  const before = v.type === 'text' || !v.type ? v.text : null, done = [];
  t.idx.forEach((k) => {
    const s = rd.segs[k]; if (!s || s.cut) return;
    if (before !== null) { const re = new RegExp(s.text.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')); v.text = v.text.replace(re, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'); }
    s.cut = true; done.push(k); rd.els[k].classList.add('cut');
  });
  if (!done.length) return;
  rd.cuts.push({ idx: done, text: before });
  if (before !== null) { save(); emit('library-render'); }
  toast(before !== null ? 'Star created and removed from the volume' : 'Star created; PDF/EPUB files are not edited, the sentence is just skipped');
  if (rd.playing && done.includes(rd.i)) playFrom(rd.i + 1);
}
function undoCut() {
  const c = rd.cuts.pop(); if (!c) return toast('Nothing to undo.');
  c.idx.forEach((k) => { rd.segs[k].cut = false; rd.els[k].classList.remove('cut'); });
  if (c.text !== null) { rd.v.text = c.text; save(); emit('library-render'); }
  toast('Sentence put back (the star stays on the map).');
}
