// Translate dialog + engines: browser Translator, Google web (unofficial), LibreTranslate, AI (Gemini/Claude/OpenAI-compatible, rpm gate + fallback).
import { app, settings, saveSettings, toast, save, emit, uid } from './core.js';
import { chat, DEFAULT_MODEL, retry, gate, sleep, httpErr } from './ai.js';
import { volumeText, textToBlocks } from './tts.js';

export const LANGS = 'en it es fr de pt nl sv da no fi pl cs ro hu el tr ru uk ar he hi zh-CN zh-TW ja ko la'.split(' ');
export const langName = (c) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(c); } catch { return c; } };
const ENGINES = { google: 'Google web (unofficial)', browser: 'Browser translator (Chrome)', libre: 'LibreTranslate', gemini: 'Gemini', claude: 'Claude', openai: 'OpenAI-compatible' };
const AIK = { gemini: 'gemKey', claude: 'aiKey', openai: 'oaKey' };
const isAI = (e) => e in AIK;
const fatal = (m) => Object.assign(new Error(m), { fatal: true });

/* ---------- chunking: group paragraphs per page up to max chars, split overlong ones at sentence/word ---------- */
export function chunkBlocks(blocks, max) {
  const chunks = []; let cur = null;
  blocks.forEach((b) => {
    const parts = []; let s = b.text, pos = 0;
    if (s.length <= max) parts.push(s);
    else while (pos < s.length) {
      let end = Math.min(s.length, pos + max);
      if (end < s.length) { let cut = s.lastIndexOf('. ', end); if (cut < pos + max * 0.5) cut = s.lastIndexOf(' ', end); if (cut > pos) end = cut + 1; }
      parts.push(s.slice(pos, end).trim()); pos = end;
    }
    parts.forEach((p) => {
      if (!p) return;
      if (cur && cur.pg === b.pg && cur.len + p.length + 2 <= max) { cur.items.push(p); cur.len += p.length + 2; }
      else chunks.push(cur = { pg: b.pg, items: [p], len: p.length });
    });
  });
  const seen = new Set(); chunks.forEach((c) => { c.mark = c.pg != null && !seen.has(c.pg); seen.add(c.pg); });
  return chunks;
}

/* ---------- engines (remote output is plain text, never HTML) ---------- */
const gtParse = (d) => (d?.[0] || []).map((x) => x?.[0] || '').join('');
async function gtPost(text, tl) {
  const r = await fetch('https://translate.googleapis.com/translate_a/single', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: 'client=gtx&sl=auto&dt=t&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(text) });
  if (!r.ok) throw await httpErr('Translator', r);
  return gtParse(await r.json());
}
async function gtGet(text, tl) { // fallback for networks that block the POST
  const parts = []; let cur = '';
  text.split(/\n{2,}/).forEach((par) => {
    while (par.length > 1300) { let c = par.lastIndexOf('. ', 1300); if (c < 520) c = par.lastIndexOf(' ', 1300); if (c < 1) c = 1300; if (cur) { parts.push(cur); cur = ''; } parts.push(par.slice(0, c + 1)); par = par.slice(c + 1); }
    if (cur && cur.length + par.length + 2 > 1300) { parts.push(cur); cur = ''; } cur += (cur ? '\n\n' : '') + par;
  });
  if (cur) parts.push(cur);
  const out = [];
  for (const p of parts) {
    const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(p));
    if (!r.ok) throw await httpErr('Translator', r);
    out.push(gtParse(await r.json())); await sleep(140);
  }
  return out.join('\n\n');
}
async function browserTr(text, target, ctx) {
  if (!('Translator' in self)) throw fatal('The browser translator needs a recent desktop Chrome. Pick another engine.');
  const tl = target.split('-')[0];
  if (!ctx.src) {
    ctx.src = 'en';
    if ('LanguageDetector' in self) try { const r = await (await self.LanguageDetector.create()).detect(text.slice(0, 400)); if (r?.[0]?.detectedLanguage && r[0].detectedLanguage !== 'und') ctx.src = r[0].detectedLanguage; } catch {}
  }
  if (ctx.src === tl) return text;
  const k = ctx.src + '>' + tl;
  try { return await (ctx.bt[k] ||= await self.Translator.create({ sourceLanguage: ctx.src, targetLanguage: tl })).translate(text); }
  catch { throw fatal(`Language pair not available in the browser (${k}). On first use, click Translate again to download the model.`); }
}
function aiChain(engine) { // selected engine first, then the other AI engines that have a key
  const ok = (e) => settings[AIK[e]] || (e === 'openai' && /localhost|127\.0\.0\.1/.test(settings.oaUrl || ''));
  return [engine, ...(settings.trFallback === false ? [] : Object.keys(AIK).filter((e) => e !== engine && ok(e)))];
}
async function aiTr(text, target, ctx) {
  const sys = `You are a literary translator. Translate the text into ${langName(target)} keeping tone, paragraph breaks and proper names. Reply with the translation only, no comments.`;
  let last;
  for (const e of aiChain(ctx.engine)) {
    const key = settings[AIK[e]];
    try {
      if (!key && !(e === 'openai' && /localhost|127\.0\.0\.1/.test(settings.oaUrl || ''))) throw fatal(`Set the ${ENGINES[e]} key in Settings.`);
      return await retry(async () => {
        await gate('tr-' + e, settings.trRpm || 15, (ms) => ctx.say(`Waiting for the request limit, ${Math.ceil(ms / 1000)} s…`));
        return chat(e, key, settings.trModels?.[e] || DEFAULT_MODEL[e], text, { system: sys, url: settings.oaUrl });
      }, { tries: 6, cancel: ctx.cancel, onWait: (ms) => ctx.say(`${ENGINES[e]} is busy, retrying in ${Math.ceil(ms / 1000)} s…`) });
    } catch (er) { last = er; if (ctx.cancel()) throw er; toast(`${ENGINES[e]} failed: ${er.message}`.slice(0, 120)); }
  }
  throw last;
}
async function translateOne(text, target, ctx) {
  const e = ctx.engine;
  if (e === 'libre') {
    if (!settings.ltUrl) throw fatal('Set the LibreTranslate URL in this dialog.');
    const r = await fetch(settings.ltUrl.replace(/\/+$/, '') + '/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: text, source: 'auto', target: target.split('-')[0], format: 'text', ...(settings.ltKey && { api_key: settings.ltKey }) }) });
    if (!r.ok) throw await httpErr('LibreTranslate', r);
    return (await r.json()).translatedText || '';
  }
  if (e === 'browser') return browserTr(text, target, ctx);
  if (isAI(e)) return aiTr(text, target, ctx);
  if (ctx.get) return gtGet(text, target);
  try { return await gtPost(text, target); } catch (er) { if (er instanceof TypeError) { ctx.get = true; return gtGet(text, target); } throw er; }
}

/* ---------- main loop: returns { chunks, out[] (translated by chunk, undefined = not done), error } ---------- */
export async function translateBlocks(blocks, { engine, target, cancel = () => false, say = () => {}, progress = () => {} }) {
  const chunks = chunkBlocks(blocks, isAI(engine) ? 6000 : 3200), out = new Array(chunks.length), ctx = { engine, cancel, say, bt: {} };
  let next = 0, done = 0, error = null;
  const worker = async () => {
    while (!cancel() && !error) {
      const i = next++; if (i >= chunks.length) return;
      say(`Translating… ${Math.min(done + 1, chunks.length)}/${chunks.length}`);
      try { out[i] = await retry(() => translateOne(chunks[i].items.join('\n\n'), target, ctx), { tries: isAI(engine) ? 1 : 5, cancel, onWait: (ms) => say(`The service is slow, retrying in ${Math.ceil(ms / 1000)} s…`) }); }
      catch (e) { error = e; return; }
      progress(++done / chunks.length);
      if (!isAI(engine)) await sleep(engine === 'libre' ? 60 : 120);
    }
  };
  await Promise.all(Array.from({ length: isAI(engine) || engine === 'browser' ? 1 : Math.min(3, chunks.length) }, worker));
  return { chunks, out, error };
}
export function assemble({ chunks, out }) { // longest contiguous translated prefix, with page markers
  const parts = [];
  for (let i = 0; i < chunks.length && out[i] != null; i++) {
    if (chunks[i].mark) parts.push(`— p. ${chunks[i].pg} —`);
    parts.push(out[i].replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim());
  }
  return { text: parts.join('\n\n'), partial: parts.length === 0 ? true : out.slice(0, chunks.length).some((x) => x == null) };
}

/* ---------- dialog ---------- */
export function openTranslate(vid, { openModal, h, btn }) {
  const v = app.state.volumes.find((x) => x.id === vid); if (!v) return;
  if (v.type === 'text' && !String(v.text || '').trim()) return toast('This volume has no text to translate.');
  openModal((card, close) => {
    let busy = false, abort = false;
    const sel = (opts, val, set) => h('select', { onchange() { set(this.value); saveSettings(); extra(); } }, ...opts.map(([k, l]) => h('option', { value: k, textContent: l, selected: k === val })));
    const lang = sel(LANGS.map((c) => [c, `${langName(c)} (${c})`]), settings.trTarget || 'en', (x) => { settings.trTarget = x; });
    const eng = sel(Object.entries(ENGINES), ENGINES[settings.trEngine] ? settings.trEngine : 'google', (x) => { settings.trEngine = x; });
    const extraBox = h('div', { className: 'tr-extra' }), info = h('div', { className: 'hint tr-info', role: 'status' }), bar = h('i'), go = btn('Translate', start, 'primary'), stop = btn('Stop', () => { abort = true; info.textContent = 'Stopping…'; }), shut = btn('Close', () => { abort = true; close(); });
    stop.hidden = true;
    const field = (label, val, fn, type = 'text', ph = '') => h('label', { textContent: label }, h('input', { type, value: val ?? '', placeholder: ph, autocomplete: 'off', oninput() { fn(this.value); saveSettings(); } }));
    function extra() {
      const e = settings.trEngine || 'google'; extraBox.textContent = '';
      if (e === 'libre') extraBox.append(field('LibreTranslate URL', settings.ltUrl, (x) => { settings.ltUrl = x; }, 'text', 'https://libretranslate.example.com'), field('API key (optional)', settings.ltKey, (x) => { settings.ltKey = x; }, 'password'));
      else if (isAI(e)) {
        extraBox.append(field('Model', settings.trModels?.[e] ?? DEFAULT_MODEL[e], (x) => { (settings.trModels ||= {})[e] = x.trim(); }), field('Requests per minute', settings.trRpm ?? 15, (x) => { settings.trRpm = +x || 15; }, 'number'));
        if (e === 'openai') extraBox.append(field('Base URL', settings.oaUrl ?? '', (x) => { settings.oaUrl = x.trim(); }, 'text', 'https://api.openai.com/v1'));
        extraBox.append(h('p', { className: 'hint', textContent: settings[AIK[e]] ? 'If this model is rate-limited, other AI engines with a key are tried next.' : `No key yet: add the ${e === 'claude' ? 'AI translation' : e === 'gemini' ? 'Gemini' : 'OpenAI-compatible'} key in Settings.` }));
      } else if (e === 'google') extraBox.append(h('p', { className: 'hint', textContent: 'Free unofficial web translator; may slow down or fail on long books.' }));
      else extraBox.append(h('p', { className: 'hint', textContent: 'Runs on your computer in Chrome; the language model downloads on first use.' }));
    }
    async function start() {
      if (busy) return; busy = true; abort = false; go.hidden = true; stop.hidden = false; bar.style.width = '0%';
      const target = lang.value, engine = eng.value, cancel = () => abort || !card.isConnected, say = (m) => { info.textContent = m; };
      try {
        say('Preparing text…'); const blocks = textToBlocks(await volumeText(v));
        if (!blocks.length) throw new Error('No text found' + (v.type === 'pdf' ? ' (scanned PDF? needs OCR).' : '.'));
        const r = await translateBlocks(blocks, { engine, target, cancel, say, progress: (p) => { bar.style.width = Math.round(p * 100) + '%'; } });
        const { text, partial } = assemble(r);
        if (text) {
          app.state.volumes.push({ id: uid(), name: `${v.name || 'Volume'} (${target}${partial ? ', partial' : ''})`, type: 'text', text, tr: true, lang: target, srcId: v.id });
          emit('library-render'); save(); bar.style.width = '100%';
          toast(partial ? 'Partial translation saved in Translated' : 'Translation saved in Translated');
          say(partial ? 'Partial translation saved' + (r.error ? ': ' + r.error.message : '.') : 'Done.');
          if (card.isConnected) setTimeout(() => card.isConnected && close(), partial ? 1800 : 900);
        } else say(r.error?.message || 'Stopped.');
      } catch (e) { say(e.message || 'Error'); }
      busy = false; go.hidden = false; stop.hidden = true;
    }
    extra();
    card.append(h('h2', { className: 'serif', textContent: `Translate "${v.name || 'volume'}"` }),
      h('label', { textContent: 'Target language' }, lang), h('label', { textContent: 'Engine' }, eng), extraBox,
      h('div', { className: 'tr-bar' }, bar), info,
      h('div', { className: 'tr-btns' }, shut, stop, go));
  });
}
