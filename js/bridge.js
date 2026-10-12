// Bridge to other tools: import highlights (Kindle My Clippings, Readwise CSV, Markdown / Obsidian, Zotero note HTML) as a constellation,
// and export everything (canvases + highlights + bookmarks) as an Obsidian-ready Markdown folder (.zip). All parsing happens in the browser.
import { app, uid, toast, escapeHtml, loadScript, download, on, emit, save } from './core.js';
import * as map from './map.js';
import { vhl, bookmarks } from './pdf.js';

const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
const MAX_BOOKS = 60, MAX_ITEMS = 400, MAX_CHARS = 1500;
const COLORS = { yellow: '#e8c872', blue: '#7fd6ff', pink: '#ff8fa8', red: '#ff8fa8', green: '#8be3a4', orange: '#ffb27a', purple: '#c4a6ff' };

/* ---------- parsers: every one returns [{title, author, items: [{text, note?, loc?, color?}]}] ---------- */
function parseClippings(txt) { // Kindle "My Clippings.txt"
  const books = new Map();
  for (const blk of txt.replace(/^﻿/, '').split(/\r?\n={5,}\s*(?:\r?\n|$)/)) {
    const L = blk.split(/\r?\n/).map((l) => l.trim()); while (L.length && !L[0]) L.shift();
    if (L.length < 2 || !/^[-–—]/.test(L[1])) continue;
    const text = clean(L.slice(2).join(' ')); if (!text) continue; // bookmarks carry no text
    const m = L[0].match(/^(.*?)\s*\(([^()]*)\)\s*$/), title = clean(m ? m[1] : L[0]) || 'Untitled', author = m ? clean(m[2]) : '';
    if (!books.has(title)) books.set(title, { title, author, items: [] });
    const bk = books.get(title), meta = L[1], pg = meta.match(/(?:page|pagina|p\.)\s*(\d+)/i), lc = meta.match(/(?:location|posizione)\s*([\d-]+)/i);
    if (/^[-–—]\s*Your Note|^[-–—]\s*La tua nota/i.test(meta) && bk.items.length) { bk.items.at(-1).note = text; continue; } // a note follows its highlight
    bk.items.push({ text, loc: pg ? 'p. ' + pg[1] : lc ? 'loc. ' + lc[1] : '' });
  }
  return [...books.values()];
}
function csvRows(t) {
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || r.length) { r.push(f); rows.push(r); }
  return rows;
}
function parseReadwise(txt) { // Readwise export CSV: Highlight, Book Title, Book Author, Note, Color, Location…
  const rows = csvRows(txt.replace(/^﻿/, '')); if (rows.length < 2) return [];
  const head = rows[0].map((c) => c.trim().toLowerCase()), ix = (...k) => head.findIndex((c) => k.includes(c)), H = ix('highlight', 'text');
  if (H < 0) return [];
  const T = ix('book title', 'title'), A = ix('book author', 'author'), N = ix('note'), C = ix('color', 'colour'), Lc = ix('location', 'page');
  const books = new Map();
  rows.slice(1).forEach((r) => {
    const text = clean(r[H]); if (!text) return;
    const title = clean(T >= 0 ? r[T] : '') || 'Untitled';
    if (!books.has(title)) books.set(title, { title, author: clean(A >= 0 ? r[A] : ''), items: [] });
    books.get(title).items.push({ text, note: clean(N >= 0 ? r[N] : ''), loc: clean(Lc >= 0 ? r[Lc] : ''), color: COLORS[clean(C >= 0 ? r[C] : '').toLowerCase()] });
  });
  return [...books.values()];
}
const tidy = (s) => clean(String(s).replace(/\^[\w-]+\s*$/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\(\s*(?:Location|Page|Loc\.?)[^)]*\)/gi, '').replace(/==/g, ''));
function parseMarkdown(txt, name) { // Obsidian / any note: > quotes and ==marks== are highlights; otherwise every paragraph is a star
  let title = name, author = '';
  const fm = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fm) { title = (fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || title; author = (fm[1].match(/^author:\s*["']?(.+?)["']?\s*$/m) || [])[1] || ''; txt = txt.slice(fm[0].length); }
  const items = [], lines = txt.split(/\r?\n/); let q = [];
  const flush = () => { const t = tidy(q.join(' ').replace(/\[![^\]]*\]\S*/g, '')); if (t.length > 2) items.push({ text: t }); q = []; };
  lines.forEach((l) => { if (/^\s*>/.test(l)) q.push(l.replace(/^\s*(>\s?)+/, '')); else { flush(); for (const m of l.matchAll(/==([^=]+)==/g)) items.push({ text: tidy(m[1]) }); } });
  flush();
  if (!items.length) {
    txt.split(/\n\s*\n/).forEach((p) => {
      const t = tidy(p.split(/\r?\n/).filter((l) => !/^\s*(#|```|---)/.test(l)).map((l) => l.replace(/^\s*[-*+]\s+/, '')).join(' '));
      if (t.length > 2) items.push({ text: t });
    });
  }
  return items.length ? [{ title: clean(title) || 'Notes', author: clean(author), items }] : [];
}
function parseHtml(txt, name) { // Zotero note export / saved page: .highlight spans (Zotero), else blockquotes, else paragraphs
  const doc = new DOMParser().parseFromString(txt, 'text/html'); // inert document: nothing runs
  const h1 = clean(doc.querySelector('h1')?.textContent), title = clean(doc.title) || (!h1 || /^annotations?$/i.test(h1) ? name : h1);
  let els = [...doc.querySelectorAll('.highlight, [data-annotation]')];
  if (!els.length) els = [...doc.querySelectorAll('blockquote')];
  if (!els.length) els = [...doc.querySelectorAll('p, li')];
  const items = els.map((e) => ({ text: clean(e.textContent).replace(/^[“"«]+|[”"»]+$/g, '') })).filter((x) => x.text.length > 2);
  return items.length ? [{ title, author: '', items }] : [];
}
async function parseFile(f) {
  const name = f.name.replace(/\.\w+$/, ''), txt = await f.text();
  if (/\.csv$/i.test(f.name)) return parseReadwise(txt);
  if (/\.html?$/i.test(f.name)) return parseHtml(txt, name);
  if (/={5,}\s*$/m.test(txt) && /^[-–—]\s*(Your |La tua )/m.test(txt)) return parseClippings(txt);
  return parseMarkdown(txt, name);
}
export const importable = (f) => /\.(csv|md|markdown|html?)$/i.test(f.name) || /clippings/i.test(f.name);

/* ---------- build a constellation page: a gold star per book, its highlights in rings around it, linked ---------- */
function buildPage(books, name) {
  const cols = Math.ceil(Math.sqrt(books.length)), GAP = 1250, nodes = [], connections = [];
  books.forEach((b, bi) => {
    const cx = (bi % cols) * GAP, cy = Math.floor(bi / cols) * GAP;
    const head = { id: uid(), x: cx - 130, y: cy - 60, w: 260, h: 120, title: b.title.slice(0, 120), body: b.author ? `<p>${escapeHtml(b.author.slice(0, 120))}</p>` : '', source: '', color: '#e8c872' };
    nodes.push(head);
    let ring = 0, slot = 0, cap = 8;
    b.items.slice(0, MAX_ITEMS).forEach((it) => {
      if (slot >= cap) { ring++; slot = 0; cap = 8 + ring * 6; }
      const R = 330 + ring * 230, a = (slot / cap) * Math.PI * 2 + ring * 0.4; slot++;
      const n = {
        id: uid(), x: Math.round(cx + R * Math.cos(a) - 120), y: Math.round(cy + R * Math.sin(a) - 75), w: 240, h: 150,
        title: (it.loc ? `${b.title} — ${it.loc}` : b.title).slice(0, 120),
        body: `<p>${escapeHtml(it.text.slice(0, MAX_CHARS))}</p>` + (it.note ? `<p><i>${escapeHtml(it.note.slice(0, 600))}</i></p>` : ''),
        source: [b.title, b.author].filter(Boolean).join(' — ').slice(0, 200), color: it.color || '#7fd6ff',
      };
      nodes.push(n); connections.push({ id: uid(), from: head.id, to: n.id, color: n.color });
    });
  });
  return { id: uid(), name: name.slice(0, 60), nodes, connections, drawings: [] };
}

function chooseFiles(accept, cb) {
  const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = accept;
  i.onchange = () => { if (i.files.length) cb([...i.files]); };
  i.click();
}
async function importFiles(files, ui) {
  if (app.readonly) return toast('This canvas is read-only');
  let books = [];
  for (const f of files) { try { books.push(...(await parseFile(f))); } catch (e) { console.warn('import', f.name, e); } }
  books = books.filter((b) => b.items.length).slice(0, MAX_BOOKS);
  if (!books.length) return toast('No highlights found in that file.');
  const total = books.reduce((n, b) => n + Math.min(b.items.length, MAX_ITEMS), 0);
  const make = () => {
    const pg = buildPage(books, books.length === 1 ? 'Highlights — ' + books[0].title : 'Imported highlights');
    app.state.pages.push(pg); map.switchPage(app.state.pages.length - 1, true); save(); toast(`Imported ${total} highlights from ${books.length} ${books.length === 1 ? 'book' : 'books'}`);
  };
  if (!ui) return make();
  ui.openModal((card, close) => card.append(
    ui.h('h2', { className: 'serif', textContent: 'Import highlights' }),
    ui.h('p', { textContent: `Found ${total} ${total === 1 ? 'highlight' : 'highlights'} in ${books.length} ${books.length === 1 ? 'book' : 'books'}:` }),
    ui.h('ul', { className: 'hint' }, ...books.slice(0, 8).map((b) => ui.h('li', { textContent: `${b.title}${b.author ? ' (' + b.author + ')' : ''}: ${b.items.length}` })), ...(books.length > 8 ? [ui.h('li', { textContent: `…and ${books.length - 8} more` })] : [])),
    ui.h('p', { className: 'hint', textContent: 'They become a new canvas: one gold star per book, with its highlights as stars around it. Nothing existing is changed.' }),
    ui.h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, ui.btn('Cancel', close), ui.btn('Create canvas', () => { close(); make(); }, 'primary'))));
}

/* ---------- export: Markdown folder for Obsidian (also fine for Logseq, Notion import, plain reading) ---------- */
const safe = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
function md(node) {
  let o = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { o += c.nodeValue; return; }
    if (c.nodeType !== 1) return;
    const t = c.tagName.toLowerCase(), inner = md(c);
    if (t === 'br') o += '\n';
    else if (/^(p|div|li|h[1-6]|blockquote|ul|ol)$/.test(t)) o += '\n' + (t === 'li' ? '- ' : t === 'blockquote' ? '> ' : '') + inner.trim() + '\n';
    else if (t === 'b' || t === 'strong') o += `**${inner}**`;
    else if (t === 'i' || t === 'em') o += `*${inner}*`;
    else if (t === 'a' && /^https?:/i.test(c.getAttribute('href') || '')) o += `[${inner}](${c.getAttribute('href')})`;
    else if (t === 'img' || t === 'video') o += ' *(media)* ';
    else if (t !== 'iframe') o += inner;
  });
  return o;
}
const bodyMd = (html) => md(new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html').body).replace(/\n{3,}/g, '\n\n').trim();
const srcText = (s) => (!s ? '' : typeof s === 'string' ? s : [s.volumeName || s.label, s.page ? 'p. ' + s.page : '', s.chapter].filter(Boolean).join(' · '));

export function markdownFiles(state = app.state) {
  const files = {}, used = new Set(), name = (base, ext = '.md') => { let n = base, i = 2; while (used.has(n + ext)) n = `${base} (${i++})`; used.add(n + ext); return n + ext; };
  const where = new Map(); // star id -> [file title, heading]
  const pagePlan = state.pages.map((p) => {
    const file = name('Canvas - ' + safe(p.name)), heads = new Set();
    p.nodes.forEach((n) => { let t = safe(n.title), k = t, i = 2; while (heads.has(k.toLowerCase())) k = `${t} (${i++})`; heads.add(k.toLowerCase()); where.set(n.id, [file.replace(/\.md$/, ''), k]); });
    return { p, file };
  });
  pagePlan.forEach(({ p, file }) => {
    const by = Object.fromEntries(p.nodes.map((n) => [n.id, n])), out = [`---\ntype: canvas\n---\n# ${safe(p.name)}\n`];
    p.nodes.forEach((n) => {
      out.push(`## ${where.get(n.id)[1]}\n`);
      const b = bodyMd(n.body); if (b) out.push(b + '\n');
      const s = srcText(n.source); if (s) out.push(`> Source: ${s}\n`);
      const rel = p.connections.filter((c) => (c.from === n.id || c.to === n.id) && by[c.from] && by[c.to]).map((c) => {
        const other = c.from === n.id ? c.to : c.from, tag = c.kind ? ` (${c.kind}${c.from === n.id ? '' : ', from'})` : '';
        return `- [[#${where.get(other)[1]}]]${tag}${c.label ? ' — ' + clean(c.label) : ''}`;
      });
      if (rel.length) out.push('Linked to:\n' + rel.join('\n') + '\n');
    });
    files[file] = out.join('\n');
  });
  state.volumes.forEach((v) => {
    const hl = vhl(v), bm = bookmarks(v); if (!hl.length && !bm.length) return;
    const out = [`---\ntype: book\n---\n# ${safe(v.name)}\n`];
    if (hl.length) {
      out.push('## Highlights\n');
      hl.forEach((x) => {
        const loc = x.page ? 'p. ' + x.page : x.chapter || '', twin = x.sid && where.get(x.sid);
        out.push(`> ${x.phrase.replace(/\n+/g, ' ')}\n${[loc, twin ? `[[${twin[0]}#${twin[1]}]]` : ''].filter(Boolean).join(' · ')}${x.note ? `\n\nNote: ${x.note}` : ''}\n`);
      });
    }
    if (bm.length) out.push('## Bookmarks\n\n' + bm.map((b) => `- ${b.page ? 'p. ' + b.page + ' — ' : ''}${clean(b.label)}`).join('\n') + '\n');
    files[name('Book - ' + safe(v.name))] = out.join('\n');
  });
  return files;
}
async function exportMarkdown() {
  const files = markdownFiles(), names = Object.keys(files);
  if (!names.length) return toast('Nothing to export yet');
  try {
    if (!window.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const z = new window.JSZip(); names.forEach((n) => z.file(n, files[n]));
    download(`forbidden-library-markdown-${new Date().toISOString().slice(0, 10)}.zip`, await z.generateAsync({ type: 'blob' }));
    toast(`Exported ${names.length} notes. Unzip into an Obsidian vault.`);
  } catch (e) { // offline and the zip library is not cached: one combined file still works
    console.warn('zip failed', e); download('forbidden-library.md', new Blob([names.map((n) => files[n]).join('\n\n---\n\n')], { type: 'text/markdown' })); toast('Exported one combined Markdown file');
  }
}

export function init(ui) {
  emit('register-tool', { label: 'Import highlights (Kindle, Readwise, Markdown, Zotero)…', fn: () => chooseFiles('.txt,.csv,.md,.markdown,.html,.htm', (fs) => importFiles(fs, ui)) });
  emit('register-tool', { label: 'Export to Markdown / Obsidian (.zip)', fn: exportMarkdown });
  on('file-drop', ({ file }) => { if (importable(file) || (/\.txt$/i.test(file.name) && file.size < 5e6)) importFiles([file], ui); });
}
