// Web pages inside the app: a star whose body IS the live page (an embedded frame, like Obsidian canvas web nodes).
// Optional extra: save a readable text copy to the library through a reader service (browsers can't read most sites directly, so that copy goes via a third party; said in the dialog).
import { $, app, uid, on, emit, save, toast, settings, saveSettings, escapeHtml } from './core.js';
import * as map from './map.js';
import { ic } from './icons.js';

const SERVICES = {
  jina: { label: 'r.jina.ai reader (recommended)', build: (u) => 'https://r.jina.ai/' + u, kind: 'markdown' },
  allorigins: { label: 'allorigins.win proxy', build: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), kind: 'html' },
  direct: { label: 'Direct (only works if the site allows it)', build: (u) => u, kind: 'html' },
};
const MAX_CHARS = 1_500_000;

export function cleanUrl(raw) {
  let s = String(raw || '').trim(); if (!s) throw new Error('Paste a link first.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https links can be imported.');
  if (u.username || u.password) throw new Error('Links with a password inside are not allowed.');
  if (u.origin === location.origin) throw new Error('That is this app itself, not a web page.');
  if (location.protocol === 'https:' && u.protocol === 'http:') u.protocol = 'https:'; // an http page can't be framed inside https
  return u.href;
}

/* markdown (from the reader service) → plain paragraphs */
export function mdToText(md) {
  let title = (md.match(/^Title:\s*(.+)$/m) || [])[1] || '';
  md = md.replace(/^(Title|URL Source|Published Time|Markdown Content|Warning):.*$/gm, (l) => (/^Markdown Content:/.test(l) ? '' : ''));
  const t = md
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*/g, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                 // images
    .replace(/\[([^\]]+)\]\((?:[^)(]|\([^)]*\))*\)/g, '$1') // links → their text
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')                    // heading marks
    .replace(/^\s*>\s?/gm, '')                             // quotes
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '• ')                // list marks
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2').replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')                    // rules
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: title.trim(), text: t };
}

/* html → plain paragraphs (largest article-like block; scripts/menus dropped; never inserted into the page) */
export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = (doc.querySelector('meta[property="og:title"]')?.content || doc.title || '').trim();
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,iframe,svg,canvas,button,select,[aria-hidden="true"],.nav,.menu,.sidebar,.footer,.header,.cookie,.advert,.ad').forEach((n) => n.remove());
  let root = doc.querySelector('article') || doc.querySelector('main') || doc.querySelector('[role=main]');
  if (!root) { let best = doc.body, score = 0; doc.body?.querySelectorAll('div,section').forEach((d) => { const sc = [...d.children].filter((c) => c.tagName === 'P').reduce((a, p) => a + p.textContent.length, 0); if (sc > score) { score = sc; best = d; } }); root = best; }
  const parts = []; root?.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre').forEach((n) => { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (t.length > (n.tagName === 'LI' ? 3 : 1)) parts.push(n.tagName === 'LI' ? '• ' + t : t); });
  return { title, text: parts.join('\n\n') };
}

export async function fetchPage(url, service = 'jina', fetchFn = fetch) {
  const s = SERVICES[service] || SERVICES.jina, ac = new AbortController(), timer = setTimeout(() => ac.abort(), 20000);
  try {
    const r = await fetchFn(s.build(url), { signal: ac.signal, headers: s.kind === 'markdown' ? { Accept: 'text/plain' } : {} });
    if (!r.ok) throw new Error(`The page could not be read (HTTP ${r.status}).`);
    const body = await r.text();
    const out = s.kind === 'markdown' ? mdToText(body) : (/^\s*</.test(body) ? htmlToText(body) : { title: '', text: body });
    if (out.text.replace(/\s/g, '').length < 80) throw new Error('Almost no readable text was found on that page (it may need a login or be built with scripts).');
    return out;
  } catch (e) { throw new Error(e.name === 'AbortError' ? 'Timed out after 20 seconds.' : /Failed to fetch|NetworkError/i.test(e.message) ? 'The page could not be reached (blocked by the site, or you are offline). Try another service below.' : e.message); }
  finally { clearTimeout(timer); }
}

export function addVolumeFromWeb(url, { title, text }) {
  const trunc = text.length > MAX_CHARS;
  const v = { id: uid(), name: (title || new URL(url).hostname).slice(0, 120), text: trunc ? text.slice(0, MAX_CHARS) : text, type: 'text', pdf: null, folderId: null, url };
  app.state.volumes.push(v); save(); emit('library-render'); return { v, trunc };
}

/* ---------- the live page inside a star (node.web = {url}) ---------- */
let H;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation'; // no top-navigation: the page can't take over the app

export function addWebStar(url, at) {
  if (app.readonly) { toast('This canvas is read-only'); return null; }
  const n = map.addNode({ ...(at || {}), w: 560, h: 440, title: hostOf(url) || 'Web page', body: '' });
  if (!n) return null;
  n.web = { url }; map.refreshNode(n.id); save(); return n;
}

function mountWeb({ n, el }) {
  el.classList.toggle('is-web', !!n.web); el.querySelector(':scope > .node-web')?.remove();
  const url = n.web && typeof n.web.url === 'string' && /^https?:\/\//i.test(n.web.url) ? n.web.url : null; if (!url || !H) return;
  const { h } = H, frame = h('iframe', { className: 'web-frame', title: n.title || hostOf(url), src: url, loading: 'lazy', referrerPolicy: 'no-referrer', allow: 'fullscreen; clipboard-write', sandbox: SANDBOX });
  const addr = h('input', { className: 'web-url', type: 'url', value: url, spellcheck: false, 'aria-label': 'Web address', disabled: app.readonly });
  const go = (u) => { try { const c = cleanUrl(u); n.web = { url: c }; addr.value = c; frame.src = c; save(); } catch (e) { toast(e.message); addr.value = n.web.url; } };
  addr.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') go(addr.value); };
  addr.onpointerdown = (e) => e.stopPropagation();
  const ico = (t, title, fn) => h('button', { type: 'button', className: 'web-btn', textContent: t, title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); fn(); } });
  const bar = h('div', { className: 'web-bar' },
    ico('↻', 'Reload', () => { frame.src = n.web.url; }), addr,
    ico('↗', 'Open in a new tab', () => window.open(n.web.url, '_blank', 'noopener,noreferrer')),
    ico('📖', 'Save a readable text copy to the library (uses a reader service)', async () => {
      if (app.readonly) return; toast('Reading the page…');
      try { const p = await fetchPage(n.web.url, settings.webService || 'jina'), { v } = addVolumeFromWeb(n.web.url, p); toast('Saved “' + v.name + '” to your library'); } catch (e) { toast(e.message); }
    }));
  const hint = h('div', { className: 'web-hint', textContent: 'Blank page? That site does not allow embedding. Use ↗ to open it in a tab, or 📖 to keep its text.' });
  el.insertBefore(h('div', { className: 'node-web' }, bar, frame, hint), el.querySelector('.node-body'));
}

export function init(H_) {
  H = H_; const { h, btn, openModal } = H;
  on('node-rendered', mountWeb);
  function dialog(prefill = '', at) {
    openModal((card, close) => {
      const input = h('input', { type: 'url', placeholder: 'https://…', value: prefill, autocomplete: 'off', inputMode: 'url' });
      const msg = h('p', { className: 'hint', textContent: '' }), go = btn('Embed page', run, 'primary');
      function run() {
        let url; try { url = cleanUrl(input.value); } catch (e) { msg.textContent = e.message; return; }
        const n = addWebStar(url, at); if (!n) return; close(); map.focusNode(n.id); toast('Web page added: click the star to interact with it');
      }
      input.onkeydown = (e) => { if (e.key === 'Enter') run(); };
      card.append(h('h2', { className: 'serif', textContent: 'Web page' }),
        h('label', { textContent: 'Address of the page' }, input),
        h('p', { className: 'hint', textContent: 'The page opens live inside a star, like a browser window you can move and resize. Your browser loads it directly (no middleman). Some sites refuse to be embedded and stay blank: use the ↗ button on the star, or 📖 to save a readable text copy to your library.' }),
        msg, h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, btn('Cancel', close), go));
      setTimeout(() => input.focus(), 30);
    });
  }
  emit('register-tool', { label: 'Web page in a star…', fn: () => dialog() });
  const row = document.querySelector('.lib-actions');
  if (row && !app.readonly) row.append(Object.assign(btn('', () => dialog(), ''), { title: 'Embed a web page as a star' }));
  row?.lastElementChild?.replaceChildren(ic('globe', 14), 'Web');
  on('import-url', (u) => dialog(u));
}
