// EPUB support (epub.js 0.3.93 + JSZip from cdnjs): reader with TOC, search, themes, cut to star, per-chapter text cache.
import { idb, toast, uploadBlob, loadScript, copyText, clamp, escapeHtml } from './core.js';
import { h, tb, shell, bytes, hlBar, rdx, star, prog, compact } from './pdf.js';
import { ev, EVC } from './evidence.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
async function lib() {
  if (!window.JSZip) await loadScript(CDN + 'jszip/3.10.1/jszip.min.js');
  if (!window.ePub) await loadScript('https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js');
  return window.ePub;
}
const base = (p) => String(p).split('#')[0].split('/').pop();
const flat = (a, d = 0) => a.flatMap((t) => [{ ...t, d }, ...flat(t.subitems || [], d + 1)]);

// chapters [{href,title,text}] for a book; cached in idb 'epubs' under id+':text'
async function extract(book, id) {
  await book.ready;
  const toc = flat(book.navigation.toc), out = [];
  for (const s of book.spine.spineItems) {
    const el = await s.load(book.load.bind(book)), t = toc.find((x) => base(x.href) === base(s.href));
    out.push({ href: s.href, title: t ? t.label.trim() : '', text: (el.querySelector?.('body') || el).textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim() });
    s.unload();
  }
  await idb.put('epubs', id + ':text', out); return out;
}
export async function getEpubChapters(id) {
  const c = await idb.get('epubs', id + ':text'); if (c) return c;
  const ab = await bytes('epubs', 'epub', id); if (!ab) return [];
  const book = (await lib())(ab.slice(0));
  try { return await extract(book, id); } finally { book.destroy(); }
}
export const getEpubText = async (id) => (await getEpubChapters(id)).map((c) => c.text).join('\n\n');

// store the file, return {count (chapters), cover}
export async function ingestEpub(id, file) {
  const ab = await file.arrayBuffer(); await idb.put('epubs', id, ab);
  uploadBlob(id, new Blob([ab], { type: 'application/epub+zip' }), 'epub');
  const book = (await lib())(ab.slice(0));
  try {
    const ch = await extract(book, id); let cover = null;
    try { const u = await book.coverUrl(); if (u) cover = await (await fetch(u)).blob(); } catch {}
    return { count: ch.length, cover };
  } finally { book.destroy(); }
}

// phrase -> Range inside an iframe document (whitespace/case-insensitive)
function findRange(doc, phrase) {
  const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), m = []; let s = '';
  for (let n; (n = w.nextNode()); ) for (let i = 0; i < n.nodeValue.length; i++) {
    const c = n.nodeValue[i];
    if (/\s/.test(c)) { if (s && s.at(-1) !== ' ') { s += ' '; m.push([n, i]); } } else { s += c.toLowerCase().charAt(0); m.push([n, i]); }
  }
  const q = String(phrase).replace(/\s+/g, ' ').trim().toLowerCase(), i = q ? s.indexOf(q) : -1; if (i < 0) return null;
  const r = doc.createRange(), e = m[i + q.length - 1]; r.setStart(...m[i]); r.setEnd(e[0], e[1] + 1); return r;
}

// v: volume {id,name}; o: {cfi, chapter, href, phrase} from a node source or a search hit
export async function openEpub(v, o = {}) {
  let book, rend;
  try {
    const ab = await bytes('epubs', 'epub', v.id); if (!ab) return toast('EPUB not found on this device or the server.');
    book = (await lib())(ab.slice(0));
  } catch (e) { console.error(e); return toast('Could not open the EPUB.'); }
  let fs = 100, selected = null, loc = null, mark = null, toc = [], fx;
  try { fs = +localStorage.getItem('st-epub-fs') || 100; } catch {}
  const dark = new MutationObserver(() => theme());
  const sh = shell(v.name || 'EPUB', () => { dark.disconnect(); fx?.dispose(); book.destroy(); }, 'ep');
  const view = h('div', { className: 'ep-view' }), side = h('nav', { className: 'ep-toc', hidden: true }), list = h('div', { className: 'ep-list' });
  const q = h('input', { type: 'search', placeholder: 'Search in book…' }), info = h('span', { className: 'mono rd-zl' });
  side.append(q, list); sh.body.append(view, side);
  rend = book.renderTo(view, { width: '100%', height: '100%', flow: 'paginated', spread: 'none' });

  const theme = () => { const day = document.documentElement.dataset.theme === 'day'; rend.themes.override('color', day ? '#141c3c' : '#f4f1e8'); rend.themes.override('background', day ? '#f3efe4' : '#0b1020'); };
  dark.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const label = () => { const t = loc && toc.find((x) => base(x.href) === base(loc.start.href)); return t ? t.label.trim() : ''; };
  const hl = (cfi) => { try { if (mark) rend.annotations.remove(mark, 'highlight'); mark = cfi; rend.annotations.highlight(cfi, {}, null, 'ep-hl', { fill: '#e8c872', 'fill-opacity': '.45' }); } catch {} };
  const show = async (target, phrase) => {
    try { await rend.display(target); } catch { await rend.display(); }
    if (!phrase) return;
    const c = rend.getContents()[0], r = c && findRange(c.document, phrase);
    if (r) { const cfi = c.cfiFromRange(r); hl(cfi); rend.display(cfi); }
  };
  const painted = new Map(); // cfi -> colour currently drawn
  const paint = () => {
    const L = ui.list();
    painted.forEach((_, c) => { if (!L.some((x) => x.cfi === c)) { try { rend.annotations.remove(c, 'highlight'); } catch {} painted.delete(c); } });
    L.forEach((x) => { if (painted.has(x.cfi)) return; painted.set(x.cfi, x.color); try { rend.annotations.highlight(x.cfi, {}, null, 'ep-uh', { fill: x.color, 'fill-opacity': '.4', 'pointer-events': 'none' }); } catch { painted.delete(x.cfi); } });
  };
  const evp = new Set(); // cfis currently drawn as evidence
  const paintEv = () => {
    const want = new Set(), items = ev.active ? ev.items.filter((x) => x.volumeId === v.id) : [], cn = rend.getContents()[0];
    items.forEach((x) => { if (!x.cfi && !x._cfi && x.phrase && cn) { const r = findRange(cn.document, x.phrase); if (r) x._cfi = cn.cfiFromRange(r); } const c = x.cfi || x._cfi; if (c) want.add(c); });
    if (mark && want.has(mark)) { try { rend.annotations.remove(mark, 'highlight'); } catch {} evp.delete(mark); mark = null; } // same cfi: evidence colour wins over the temporary jump mark
    evp.forEach((c) => { if (!want.has(c)) { try { rend.annotations.remove(c, 'highlight'); } catch {} evp.delete(c); } });
    want.forEach((c) => { if (evp.has(c)) return; evp.add(c); try { rend.annotations.highlight(c, {}, null, 'ep-ev', { fill: EVC, 'fill-opacity': '.55', 'pointer-events': 'none' }); } catch { evp.delete(c); } });
  };
  const showToc = () => { list.textContent = ''; toc.forEach((t) => list.append(h('button', { className: 'ep-item', textContent: t.label.trim(), onclick: () => { side.hidden = true; show(t.href); } }, ))); list.querySelectorAll('.ep-item').forEach((b, i) => { b.style.paddingLeft = 10 + toc[i].d * 14 + 'px'; }); };
  async function search() {
    const t = q.value.trim(); if (!t) return showToc();
    list.textContent = 'Searching…'; const hits = [];
    await Promise.all(book.spine.spineItems.map((s) => s.load(book.load.bind(book)).then(() => { hits.push(...s.find(t).map((x) => ({ ...x, i: s.index }))); s.unload(); }).catch(() => {})));
    hits.sort((a, b) => a.i - b.i); list.textContent = hits.length ? '' : 'No results.';
    hits.slice(0, 100).forEach((x) => list.append(h('button', { className: 'ep-item', textContent: x.excerpt.trim(), onclick: () => { side.hidden = true; rend.display(x.cfi); hl(x.cfi); } })));
  }
  q.onkeydown = (e) => { if (e.key === 'Enter') search(); };
  q.oninput = () => { if (!q.value) showToc(); };

  const size = (d) => { fs = clamp(fs + d, 70, 220); rend.themes.fontSize(fs + '%'); try { localStorage.setItem('st-epub-fs', fs); } catch {} };
  const cut = () => {
    if (!selected) return toast('Select some text first.');
    const ch = label();
    star({ title: ch ? `${v.name} — ${ch}` : v.name, body: escapeHtml(selected.phrase), source: { type: 'epub', volumeId: v.id, volumeName: v.name, chapter: ch, cfi: selected.cfi, phrase: selected.phrase } }); toast('Added to the map');
  };
  rend.on('selected', (cfi, c) => {
    const sel = c.window.getSelection(), phrase = sel.toString().replace(/\s+/g, ' ').trim(); if (!phrase) return;
    selected = { cfi, phrase };
    const r = sel.getRangeAt(0).getBoundingClientRect(), f = c.window.frameElement?.getBoundingClientRect() || { left: 0, top: 0 }, ch = label();
    fx.look(phrase, { left: r.left + f.left, top: r.top + f.top, bottom: r.bottom + f.top }, { type: 'epub', volumeId: v.id, volumeName: v.name, chapter: ch, cfi });
  });
  rend.on('relocated', (l) => {
    loc = l; info.textContent = `${l.start.index + 1}/${book.spine.length}${label() ? ' · ' + label() : ''}`;
    paintEv(); fx?.report();
  });
  rend.on('keyup', (e) => { if (e.key === 'ArrowRight') rend.next(); else if (e.key === 'ArrowLeft') rend.prev(); else if (e.key === 'Escape') fx?.focusOff(); });
  rend.hooks.content.register((c) => { // swipe to turn pages
    let x0 = 0; c.document.addEventListener('pointerdown', () => fx?.hide());
    c.document.addEventListener('touchstart', (e) => { x0 = e.changedTouches[0].clientX; }, { passive: true });
    c.document.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 60 && !c.window.getSelection().toString()) dx < 0 ? rend.next() : rend.prev(); }, { passive: true });
  });
  const ui = hlBar(v, sh, {
    ok: (x) => typeof x.cfi === 'string' && x.cfi.length < 600, paint,
    make: () => selected && { cfi: selected.cfi, chapter: label(), phrase: selected.phrase },
    go: (x) => rend.display(x.cfi).catch(() => {}),
    cut: (x) => { star({ title: x.chapter ? `${v.name} — ${x.chapter}` : v.name, body: escapeHtml(x.phrase), source: { type: 'epub', volumeId: v.id, volumeName: v.name, chapter: String(x.chapter || ''), cfi: x.cfi, phrase: x.phrase } }); toast('Added to the map'); },
  });
  const evHref = (x) => x.cfi || x._cfi || x.href || (x.chapter && toc.find((t) => t.label.trim() === x.chapter)?.href) || undefined;
  fx = rdx(v, sh, {
    pos: () => {
      if (!loc) return null; const d = loc.start.displayed || {}, n = Math.max(1, book.spine.length);
      return { cfi: loc.start.cfi, label: label() || 'Ch. ' + (loc.start.index + 1), pct: Math.round(((loc.start.index + (d.total ? (d.page - 1) / d.total : 0)) / n) * 100) };
    },
    go: (p) => { if (typeof p.cfi === 'string' && p.cfi !== loc?.start.cfi) rend.display(p.cfi).catch(() => {}); },
    paint, sig: () => ui.list().map((x) => x.cfi + x.color).join(), resize: () => { try { rend.resize(); } catch {} },
    goEv: async (x) => { await show(evHref(x), x.phrase); paintEv(); },
  });
  compact(sh, tb('Cut', 'Selected text to a new star', cut, '✦'), fx, [
    tb('Contents', 'Contents and search', () => { side.hidden = !side.hidden; }, '☰'), tb('Prev', 'Previous page', () => rend.prev(), '‹'), info, tb('Next', 'Next page', () => rend.next(), '›'),
    tb('Smaller text', 'Smaller text', () => size(-10), 'A−'), tb('Larger text', 'Larger text', () => size(10), 'A+'),
    tb('Copy', 'Copy selected text', () => (selected ? copyText(selected.phrase).then(() => toast('Text copied')) : toast('Select some text first.')), '⧉'),
    ...ui.btns, ...fx.btns]);
  theme(); rend.themes.fontSize(fs + '%');
  await book.ready; toc = flat(book.navigation.toc); showToc(); paint();
  const rp = !o.cfi && !o.href && !o.chapter && !o.phrase && prog()[v.id]; // resume where you left off
  let target = o.cfi || o.href || (o.chapter && toc.find((t) => t.label.trim() === o.chapter)?.href) || (rp && typeof rp.cfi === 'string' && rp.cfi.length < 600 ? rp.cfi : undefined);
  await show(target, o.phrase);
  if (o.cfi) hl(o.cfi);
  paintEv();
}
