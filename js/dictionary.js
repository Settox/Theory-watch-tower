// Word lookup popover for the readers (free dictionaryapi.dev; results cached in memory). Remote text only via textContent / escapeHtml.
import { toast, copyText, escapeHtml, app } from './core.js';

const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const cache = new Map(); let pop = null, off = null;
export const isWord = (s) => /^\p{L}[\p{L}'’-]{1,39}$/u.test(s);
export const isPhrase = (s) => { const w = s.split(' '); return s.length <= 60 && w.length <= 3 && w.every((x) => /^[\p{L}\p{N}'’-]+$/u.test(x)); };

const parse = (j) => {
  const e = Array.isArray(j) && j[0]; if (!e || typeof e !== 'object') return { missing: true };
  const ph = e.phonetic || (Array.isArray(e.phonetics) ? e.phonetics.find((p) => p && p.text)?.text : '') || '';
  const m = (Array.isArray(e.meanings) ? e.meanings : []).slice(0, 3).map((x) => ({ pos: String(x?.partOfSpeech || '').slice(0, 20), defs: (Array.isArray(x?.definitions) ? x.definitions : []).slice(0, 2).map((d) => String(d?.definition || '').slice(0, 240)).filter(Boolean) })).filter((x) => x.defs.length);
  return m.length ? { ph: String(ph).slice(0, 40), m } : { missing: true };
};
export async function define(word) {
  const k = word.toLowerCase(); if (cache.has(k)) return cache.get(k);
  let r;
  try { const res = await fetch('https://api.dictionaryapi.dev/v2/entries/en/' + encodeURIComponent(k)); r = res.ok ? parse(await res.json()) : { missing: true }; }
  catch { return { offline: true }; } // not cached: retry when back online
  cache.set(k, r); return r;
}

export function hide() { pop?.remove(); pop = null; off?.(); off = null; }
// text: selected string; rect: its client rect; ctx: {src(word) -> source obj, star(props)}
export function show(text, rect, ctx) {
  hide(); text = String(text || '').replace(/\s+/g, ' ').trim();
  const word = isWord(text); if (!word && !isPhrase(text)) return;
  const me = (pop = h('div', { className: 'dict-pop', role: 'dialog', onpointerdown: (e) => { if (!e.target.closest('a,button')) e.preventDefault(); } }));
  const head = h('div', { className: 'dict-head' }, h('strong', { className: 'serif', textContent: text }), h('button', { type: 'button', className: 'ico', title: 'Close', textContent: '✕', onclick: hide }));
  const body = h('div', { className: 'dict-body', textContent: word ? 'Looking up…' : '' }), acts = h('div', { className: 'dict-acts' });
  const link = (t, u) => h('a', { textContent: t, href: u, target: '_blank', rel: 'noopener noreferrer', className: 'btn' });
  const copy = h('button', { type: 'button', className: 'btn', textContent: 'Copy', onclick: () => copyText(text).then(() => toast('Copied')) });
  acts.append(copy);
  acts.append(link('Translate', 'https://translate.google.com/?sl=auto&op=translate&text=' + encodeURIComponent(text)));
  me.append(head, body, acts); document.body.append(me);
  const W = Math.min(300, innerWidth - 16), x = Math.max(8, Math.min(rect.left, innerWidth - W - 8));
  me.style.width = W + 'px'; me.style.left = x + 'px';
  const below = rect.bottom + 8 + 200 < innerHeight; me.style.top = below ? rect.bottom + 8 + 'px' : 'auto'; me.style.bottom = below ? 'auto' : innerHeight - rect.top + 8 + 'px';
  const onDown = (e) => { if (!me.contains(e.target)) hide(); }, onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); hide(); } };
  addEventListener('pointerdown', onDown, true); addEventListener('keydown', onKey, true);
  off = () => { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); };
  if (!word) return;
  define(text).then((r) => {
    if (pop !== me) return; body.textContent = '';
    if (r.missing || r.offline) {
      body.textContent = r.offline ? 'Offline: the dictionary cannot be reached.' : 'No definition found.';
      acts.prepend(link('Wiktionary', 'https://en.wiktionary.org/wiki/' + encodeURIComponent(text.toLowerCase()))); return;
    }
    if (r.ph) body.append(h('div', { className: 'mono dim', textContent: r.ph }));
    r.m.forEach((m) => body.append(h('p', {}, h('i', { textContent: m.pos + ' ' }), m.defs[0])));
    if (!app.readonly) acts.prepend(h('button', { type: 'button', className: 'btn primary', textContent: 'Save as star', onclick: () => {
      const def = r.m.map((m) => `<i>${escapeHtml(m.pos)}</i> ${escapeHtml(m.defs[0])}`).join('<br>');
      ctx.star({ title: text, body: (r.ph ? `<span>${escapeHtml(r.ph)}</span><br>` : '') + def, source: ctx.src(text) }); toast('Added to the map'); hide();
    } }));
  });
}
