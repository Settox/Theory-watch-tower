// Evidence mode (passages backing a star, lit up in the readers) + cross-book "find this idea" search.
import { app, emit, on, toast, idb, escapeHtml, findNode, page } from './core.js';
import * as map from './map.js';
import { h, tb, star } from './pdf.js';

export const EVC = '#ff9a3d'; // evidence colour (distinct from the 4 highlight colours)
export const ev = { active: false, hide: false, dep: false, items: [], idx: 0, nodeId: null };
let cur = null, openModal; // cur: dock of the open reader {v, a, render}

/* ---------- cached text of a volume: [{t, page?|chapter,href?|text}] ---------- */
export async function volParts(v) {
  const parts = [], arr = (x) => (Array.isArray(x) ? x : []);
  if (v.text) parts.push({ t: String(v.text), text: true });
  if (v.type === 'pdf') arr(await idb.get('pdfs', v.id + ':text').catch(() => null)).forEach((t, i) => parts.push({ t: String(t), page: i + 1 }));
  if (v.type === 'epub') arr(await idb.get('epubs', v.id + ':text').catch(() => null)).forEach((c) => parts.push({ t: String(c?.text || ''), chapter: c?.title, href: c?.href }));
  return parts;
}

/* ---------- collect: the star's own source + sources of stars linked by 'supports' (optionally 'depends'), depth <= 3 (links treated as undirected) ---------- */
export function collect(nodeId) {
  const P = page(), kinds = ev.dep ? ['supports', 'depends'] : ['supports'], seen = new Set([nodeId]), out = [], keys = new Set();
  const add = (n, backs) => {
    const s = n.source; if (!s || typeof s !== 'object') return;
    const v = app.state.volumes.find((x) => x.id === s.volumeId); if (!v) return;
    const type = v.type === 'epub' ? 'epub' : v.pdf ? 'pdf' : 'text', pg = Number.isInteger(s.page) && s.page > 0 ? s.page : undefined;
    if (type === 'pdf' && !pg) return;
    const phrase = typeof s.phrase === 'string' ? s.phrase.slice(0, 600) : '', cfi = typeof s.cfi === 'string' && s.cfi.length < 600 ? s.cfi : undefined;
    const chapter = typeof s.chapter === 'string' ? s.chapter.slice(0, 120) : '', href = typeof s.href === 'string' ? s.href.slice(0, 300) : undefined;
    const k = [v.id, pg, cfi, phrase.slice(0, 60)].join('|'); if (keys.has(k)) return; keys.add(k);
    out.push({ i: out.length, volumeId: v.id, volumeName: v.name || 'Untitled', type, page: pg, cfi, chapter, href, phrase, backs: String(backs).slice(0, 80), label: pg ? 'p. ' + pg : chapter || (type === 'epub' ? 'chapter' : 'note') });
  };
  let front = [[nodeId, null]];
  for (let d = 0; d <= 3 && front.length; d++) {
    const next = [];
    front.forEach(([id, parent]) => {
      const n = P.nodes.find((x) => x.id === id); if (!n) return;
      add(n, parent ? parent.title || 'star' : n.title || 'this star');
      if (d < 3) P.connections.forEach((c) => {
        if (!kinds.includes(c.kind)) return;
        const o = c.from === id ? c.to : c.to === id ? c.from : null; if (o && !seen.has(o)) { seen.add(o); next.push([o, n]); }
      });
    });
    front = next;
  }
  return out;
}

/* ---------- navigation ---------- */
export function goTo(i) {
  const x = ev.items[i]; if (!x) return; ev.idx = i;
  if (cur && cur.v.id === x.volumeId) { cur.a.goEv(x); cur.render(); }
  else emit('open-source', { type: x.type, volumeId: x.volumeId, page: x.page, cfi: x.cfi, chapter: x.chapter, href: x.href, phrase: x.phrase, ei: i });
}
const refresh = () => cur?.render(true);
const end = () => { ev.active = false; refresh(); };
export function openEvidence(nodeId) {
  if (!findNode(nodeId)) return toast('Select a star first.');
  const items = collect(nodeId); if (!items.length) return toast('No book passages are linked to this star yet.');
  Object.assign(ev, { active: true, hide: false, items, idx: 0, nodeId }); refresh();
  const here = cur ? items.findIndex((x) => x.volumeId === cur.v.id) : -1, first = items.findIndex((x) => x.type !== 'text');
  if (here >= 0 || first >= 0 || cur) return goTo(here >= 0 ? here : Math.max(0, first));
  openModal((card, close) => { // text-only evidence: plain list
    card.append(h('h2', { className: 'serif', textContent: 'Evidence' }));
    items.forEach((x, i) => card.append(h('button', { type: 'button', className: 'ev-item', onclick: () => { close(); goTo(i); } }, h('b', { textContent: `${x.volumeName} · ${x.label}` }), h('span', { className: 'snip', textContent: x.phrase.slice(0, 160) }), h('span', { className: 'mono dim', textContent: 'backs: ' + x.backs }))));
  });
}

// docked panel inside a reader. a: {goEv(x), paint(), resize()}; returns {btn, dispose}
export function dock(v, sh, a) {
  const R = sh.bar.parentNode, panel = h('aside', { className: 'ev-panel', hidden: true }), btn = tb('Evidence', 'Show or hide the evidence panel', () => { ev.hide = !ev.hide; me.render(); }, '◈');
  let was = ev.active && !ev.hide;
  const me = cur = { v, a, render(repaint) {
    const on = ev.active && !ev.hide; btn.hidden = !ev.active; panel.hidden = !on; R.classList.toggle('ev-open', on);
    if (on) {
      panel.textContent = ''; panel.style.top = sh.body.offsetTop + 'px'; const n = ev.items.length, nd = findNode(ev.nodeId);
      panel.append(h('div', { className: 'ev-head' }, h('strong', { className: 'serif', textContent: 'Evidence' }), h('span', { className: 'mono', textContent: `${ev.idx + 1}/${n}` }),
        tb('Prev', 'Previous passage', () => goTo((ev.idx - 1 + n) % n), '‹'), tb('Next', 'Next passage', () => goTo((ev.idx + 1) % n), '›'), h('button', { type: 'button', className: 'ico', title: 'Close evidence', textContent: '✕', onclick: end })),
        h('p', { className: 'dim ev-for', textContent: 'For: ' + (nd?.title || 'star') }),
        h('label', { className: 'ev-opt' }, h('input', { type: 'checkbox', checked: ev.dep, onchange: (e) => { ev.dep = e.target.checked; ev.items = collect(ev.nodeId); ev.idx = 0; refresh(); } }), " include 'depends' links"));
      const list = h('div', { className: 'ev-list' });
      ev.items.forEach((x, i) => list.append(h('button', { type: 'button', className: 'ev-item' + (i === ev.idx ? ' on' : ''), onclick: () => goTo(i) }, h('b', { textContent: `${x.volumeName} · ${x.label}` }), h('span', { className: 'snip', textContent: x.phrase.slice(0, 160) }), h('span', { className: 'mono dim', textContent: 'backs: ' + x.backs }))));
      panel.append(list); list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    }
    if (on !== was) { was = on; a.resize?.(); }
    if (repaint) a.paint?.();
  } };
  R.append(panel); me.render();
  return { btn, render: () => me.render(), dispose: () => { panel.remove(); R.classList.remove('ev-open'); if (cur === me) cur = null; } };
}

/* ---------- cross-book: find this idea in other books ---------- */
const STOP = new Set('this that with from have were been their which would there about these those into than then them they what when where while will your also such more most some only over under between because other being does done'.split(' '));
const plain = (s) => new DOMParser().parseFromString(String(s || ''), 'text/html').body.textContent;
function keywords(n) {
  let t = plain(n.title); const own = n.source?.volumeName;
  if (!t.trim() || /^new star$/i.test(t.trim()) || (own && t.startsWith(own))) t = plain(n.body).slice(0, 400);
  const w = {}; (t.toLowerCase().match(/\p{L}{4,}/gu) || []).forEach((x) => { if (!STOP.has(x)) w[x] = (w[x] || 0) + x.length; });
  return Object.keys(w).sort((a, b) => w[b] - w[a]).slice(0, 5);
}
async function findIdea(nodeId) {
  const n = findNode(nodeId ?? [...map.sel][0]); if (!n) return toast('Select a star first.');
  const kw = keywords(n); if (!kw.length) return toast('This star has no usable keywords.');
  toast('Searching other books…'); const need = kw.length > 3 ? 2 : 1, res = [];
  for (const v of app.state.volumes) {
    if (v.id === n.source?.volumeId) continue;
    const found = [];
    for (const p of await volParts(v)) {
      const low = p.t.toLowerCase(), hit = kw.filter((k) => low.includes(k)); if (hit.length < need) continue;
      const sents = p.t.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
      let best = '', bs = 0; sents.forEach((s, i) => { const t = s.toLowerCase(), sc = kw.filter((k) => t.includes(k)).length; if (sc > bs) { bs = sc; best = s; } });
      if (!best) continue;
      const phrase = best.replace(/\s+/g, ' ').trim().slice(0, 300), type = v.type === 'epub' ? 'epub' : v.pdf ? 'pdf' : 'text';
      found.push({ v, p, score: hit.length * 10 + bs, phrase, type });
    }
    res.push(...found.sort((a, b) => b.score - a.score).slice(0, 3));
  }
  res.sort((a, b) => b.score - a.score); const top = res.slice(0, 25);
  openModal((card, close) => {
    card.append(h('h2', { className: 'serif', textContent: 'Find this idea in other books' }), h('p', { className: 'dim', textContent: 'Keywords: ' + kw.join(', ') + '. Only books whose text is already read are searched.' }));
    if (!top.length) card.append(h('p', { textContent: 'No matching passages in other books.' }));
    top.forEach(({ v, p, phrase, type }) => {
      const where = p.page ? 'p. ' + p.page : p.chapter || (p.text ? 'note' : 'chapter');
      const src = type === 'pdf' ? { type, volumeId: v.id, volumeName: v.name, page: p.page, phrase } : type === 'epub' ? { type, volumeId: v.id, volumeName: v.name, chapter: p.chapter || '', href: p.href, phrase } : { type: 'text', volumeId: v.id, volumeName: v.name, label: v.name, phrase, start: Math.max(0, p.t.indexOf(phrase)) };
      let done = false;
      const add = h('button', { type: 'button', className: 'btn primary', textContent: 'Add as star + link', disabled: app.readonly, onclick: (e) => {
        if (done) return; done = true; e.target.textContent = 'Added';
        const s = star({ title: `${v.name} — ${where}`, body: escapeHtml(phrase), source: src });
        if (s) map.addConnection(s.id, n.id, { kind: 'supports' });
      } });
      card.append(h('div', { className: 'hit' }, h('b', { textContent: `${v.name} · ${where}` }), h('span', { className: 'snip', textContent: phrase }),
        h('div', { className: 'dict-acts' }, h('button', { type: 'button', className: 'btn', textContent: 'Open', onclick: () => { close(); emit('open-source', src); } }), add)));
    });
  });
}

export function init(helpers) {
  openModal = helpers.openModal;
  on('evidence', (d) => openEvidence(d?.nodeId));
  emit('register-tool', { label: 'Show evidence for selected star', fn: () => openEvidence([...map.sel][0]) });
  emit('register-tool', { label: 'Find this idea in other books', fn: () => findIdea() });
}
