// TTS providers (ElevenLabs, OpenAI-compatible, Google Cloud, Gemini) with an idb cache, plus shared volume-text helpers.
import { settings, idb, toast } from './core.js';
import { httpErr, retry } from './ai.js';

export const PROVS = { browser: 'Browser voice', eleven: 'ElevenLabs', openai: 'OpenAI-compatible', google: 'Google Cloud', gemini: 'Gemini' };
export const KEY = { eleven: 'elKey', openai: 'oaKey', google: 'gcKey', gemini: 'gemKey' };
const DEF = { eleven: '21m00Tcm4TlvDq8ikWAM', openai: 'alloy', google: 'en-US-Neural2-A', gemini: 'Kore' };
export const provider = () => (PROVS[settings.ttsProvider] ? settings.ttsProvider : 'browser');
export const voiceOf = (p) => settings.ttsVoices?.[p] || DEF[p] || '';
export const setVoice = (p, v) => { (settings.ttsVoices ||= {})[p] = v; };
const model = (p) => ({ eleven: settings.elModel || 'eleven_multilingual_v2', openai: settings.oaTtsModel || 'tts-1', gemini: settings.gmModel || 'gemini-2.5-flash-preview-tts' }[p] || '');
const oaBase = () => (settings.oaUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
const need = (p) => { const k = settings[KEY[p]]; if (!k) throw Object.assign(new Error(`Set the ${PROVS[p]} key in Settings.`), { fatal: true }); return k; };

function pcmToWav(b64, rate) {
  const bin = atob(b64), n = bin.length, buf = new ArrayBuffer(44 + n), dv = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n, true);
  const u = new Uint8Array(buf, 44); for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'audio/wav' });
}
const b64Blob = (b64, type) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

const gen = {
  async eleven(text, prev, next) {
    const body = { text, model_id: model('eleven'), voice_settings: { stability: 0.5, similarity_boost: 0.75 } };
    if (prev) body.previous_text = prev.slice(-300); if (next) body.next_text = next.slice(0, 300);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceOf('eleven'))}?output_format=mp3_44100_64`, { method: 'POST', headers: { 'xi-api-key': need('eleven'), 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
    if (!r.ok) throw await httpErr('ElevenLabs', r);
    return r.blob();
  },
  async openai(text) {
    const k = settings.oaKey, local = /localhost|127\.0\.0\.1/.test(oaBase());
    if (!k && !local) need('openai');
    const r = await fetch(oaBase() + '/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(k && { Authorization: 'Bearer ' + k }) }, body: JSON.stringify({ model: model('openai'), voice: voiceOf('openai'), input: text, response_format: 'mp3' }) });
    if (!r.ok) throw await httpErr('Voice service', r);
    return r.blob();
  },
  async google(text) { // Google Cloud TTS only accepts the key as a query parameter
    const vn = voiceOf('google'), lc = (vn.match(/^[a-z]{2,3}-[A-Z]{2}/) || ['en-US'])[0];
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(need('google')), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { text }, voice: { languageCode: lc, name: vn }, audioConfig: { audioEncoding: 'MP3' } }) });
    if (!r.ok) throw await httpErr('Google TTS', r);
    const j = await r.json(); if (!j.audioContent) throw new Error('Google TTS: empty response.');
    return b64Blob(j.audioContent, 'audio/mpeg');
  },
  async gemini(text) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model('gemini'))}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': need('gemini') }, body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceOf('gemini') } } } } }) });
    if (!r.ok) throw await httpErr('Gemini voice', r);
    const j = await r.json(), pt = (j.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData);
    if (!pt) throw new Error('Gemini returned no audio (invalid model or voice?).');
    return pcmToWav(pt.inlineData.data, +(String(pt.inlineData.mimeType).match(/rate=(\d+)/)?.[1] || 24000));
  },
};

// Cloud synthesis -> object URL. Cached in memory and in idb 'tts' by hash(provider+voice+model+text).
const mem = {};
export function synth(p, text, prev, next, cancel) {
  const sig = [p, p === 'openai' ? oaBase() : '', voiceOf(p), model(p), text].join('|');
  return mem[sig] ||= (async () => {
    const key = await sha(sig);
    try {
      const rec = await idb.get('tts', key);
      if (rec?.blob) return URL.createObjectURL(rec.blob);
      const blob = await retry(() => gen[p](text, prev, next), { tries: 4, cancel, onWait: (ms) => toast(`Voice service busy, retrying in ${Math.ceil(ms / 1000)} s`) });
      idb.put('tts', key, { blob, ts: Date.now() }).catch(() => {});
      return URL.createObjectURL(blob);
    } catch (e) { delete mem[sig]; throw e; }
  })();
}

/* ---------- volume text (shared with translate) ---------- */
// Returns plain text; page-aware sources may embed "— p. N —" marker lines.
export async function volumeText(v) {
  if (v.type === 'text' || !v.type) return v.text || '';
  try {
    const m = await import(v.type === 'pdf' ? './pdf.js' : './epub.js');
    const t = await (v.type === 'pdf' ? m.getPdfText : m.getEpubText)(v.id);
    return typeof t === 'string' ? t : Array.isArray(t) ? (() => { let last; return t.map((x) => { if (typeof x === 'string') return x; const mk = x.pg != null && x.pg !== last ? `— p. ${(last = x.pg)} —\n\n` : ''; return mk + (x.text ?? ''); }).join('\n\n'); })() : '';
  } catch (e) { console.warn(e); toast('Reader not available'); return ''; }
}
const PG = /^—\s*p\.\s*(\d+)\s*—$/;
export function textToBlocks(text) {
  const blocks = []; let pg = null;
  String(text || '').split(/\r?\n\s*\r?\n/).forEach((par) => {
    const t = par.replace(/\s*\n\s*/g, ' ').trim(); if (!t) return;
    const m = t.match(PG); if (m) { pg = +m[1]; return; }
    blocks.push({ pg, text: t });
  });
  return blocks;
}
