// Homepage: the title over the library (and, in the public build, the constellation doorway), plus shelves of your canvases (personal) and rooms (collab), read from this device.
// Only preview.js is imported statically: everything else is optional, so one broken file can never blank the shelves.
import { preview, countOf } from './preview.js';

const soft = (p) => Promise.resolve(p).catch((e) => console.warn('home:', e));
soft(import('./themes.js'));                                                       // applies the saved sky
const skyReady = soft(import('./sky.js').then((m) => m.sky(document.getElementById('sky'))));        // animated background
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

const root = document.documentElement;
root.dataset.theme = 'night';

/* ---------- account button: shows who is signed in; the sign-in form itself lives in the app (js/auth.js) ---------- */
{
  const b = document.getElementById('accBtn'), c = window.SUPABASE_CONFIG;
  if (!(window.supabase && c && c.url && c.key)) b.hidden = true;
  else soft(import('./auth.js').then((m) => m.initHome(b)).catch((e) => { b.hidden = true; throw e; }));
}

/* ---------- the doorway: an arch made of constellation lines that draws itself once ----------
   Kept for the public release. Hidden in the friends' build: <body data-door="off"> in index.html (set "on" to show it, or open the page with ?door=1). */
const FORCE_DOOR = /[?&]door=1/.test(location.search);
let DOOR = FORCE_DOOR || document.body.dataset.door === 'on';
function doorway(svg) {
  const NS = 'http://www.w3.org/2000/svg', cx = 300, rad = (d) => (d * Math.PI) / 180;
  const el = (tag, a, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); parent.append(e); return e; };
  const ring = (R) => { // up the left pillar, over the arch, down the right pillar
    const ys = [760, 645, 530, 415, 300], l = cx - R, r = cx + R, arc = [150, 120, 90, 60, 30].map((a) => [cx + R * Math.cos(rad(a)), 300 - R * Math.sin(rad(a))]);
    return [...ys.map((y) => [l, y]), ...arc, ...ys.slice().reverse().map((y) => [r, y])];
  };
  const out = ring(220), inn = ring(184), path = (pts) => 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join('L');
  const defs = el('defs', {}), g = el('radialGradient', { id: 'doorGlow', cx: '50%', cy: '100%', r: '85%' }, defs);
  el('stop', { offset: '0', 'stop-color': 'var(--gold)', 'stop-opacity': '.34' }, g); el('stop', { offset: '.55', 'stop-color': 'var(--gold)', 'stop-opacity': '.07' }, g); el('stop', { offset: '1', 'stop-color': 'var(--gold)', 'stop-opacity': '0' }, g);
  el('path', { class: 'glow', d: 'M116 780V300A184 184 0 0 1 484 300V780Z', fill: 'url(#doorGlow)' });
  // faint keyhole behind the words
  const key = el('path', { class: 'gold draw', pathLength: 1, style: '--d:1.1s;opacity:.22', d: 'M300 470a34 34 0 1 1 0 .01M284 500 270 600h60L316 500' });
  const o = el('path', { class: 'line out draw', pathLength: 1, style: '--d:0s', d: path(out) });
  el('path', { class: 'line in draw', pathLength: 1, style: '--d:.35s', d: path(inn) });
  el('path', { class: 'line truss draw', pathLength: 1, style: '--d:.7s', d: out.slice(0, -1).map((p, i) => `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${inn[i + 1][0].toFixed(1)} ${inn[i + 1][1].toFixed(1)}`).join('') });
  const sizes = [3.4, 2.4, 3, 2.2, 3.6, 2.6, 3.2, 0, 3.2, 2.6, 3.6, 2.2, 3, 2.4, 3.4];
  out.forEach((p, i) => { if (sizes[i]) el('circle', { class: 'pt', cx: p[0], cy: p[1], r: sizes[i], style: `--d:${(0.15 + i * 0.07).toFixed(2)}s` }); });
  inn.forEach((p, i) => { if (i % 2 === 0) el('circle', { class: 'pt', cx: p[0], cy: p[1], r: 1.6, style: `--d:${(0.5 + i * 0.07).toFixed(2)}s`, opacity: .75 }); });
  // keystone: one gold star at the top of the arch, with a cross of light
  const [kx, ky] = out[7]; el('circle', { class: 'pt key', cx: kx, cy: ky, r: 6.5, style: '--d:1.2s' });
  for (const [dx, dy] of [[0, 18], [18, 0]]) el('line', { class: 'spark', x1: kx - dx, y1: ky - dy, x2: kx + dx, y2: ky + dy, style: '--d:1.35s' });
  // a few loose stars inside the doorway, as if the sky continued behind it
  [[205, 235, 1.5], [395, 250, 1.3], [250, 205, 1.1], [352, 215, 1.6], [160, 400, 1.2], [440, 380, 1.4]].forEach(([x, y, r], i) => el('circle', { class: 'pt', cx: x, cy: y, r, style: `--d:${(1.6 + i * 0.12).toFixed(2)}s`, opacity: .7 }));
}
const applyDoor = (on) => { // the door for everyone; the tea party scene only for the owner's account
  DOOR = on; document.body.dataset.door = on ? 'on' : 'off';
  const svg = document.getElementById('arch'); svg.textContent = '';
  if (on) { try { doorway(svg); } catch (e) { console.warn('doorway failed', e); } }
};
applyDoor(DOOR);
// accounts that see the tea-party scene instead of the door, as SHA-256 of the lowercase email (the list is public, the addresses are not)
const TEA_ACCOUNTS = new Set(['f1d40ca5b81e82685a926ccd1fdca17d507860ccc24294ef280ae3ef2cd2876d', '8384c1e9ca9803b963fcb194dada4470a8eab0ba27969205a4d625546681a935', '1654cb2d58e524e7212cba5275ca3bd8eb212f9c8326b4f1f997950670330f26']);
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
addEventListener('st-user', async (e) => { // sent by js/auth.js once the session is known (cosmetic only: it chooses a picture, it grants nothing)
  const u = e.detail, owner = !!(u && u.confirmed && TEA_ACCOUNTS.has(await sha256(String(u.email).toLowerCase())));
  try { owner ? localStorage.setItem('st-owner', '1') : localStorage.removeItem('st-owner'); } catch {}
  if (!FORCE_DOOR && DOOR === owner) applyDoor(!owner);
});

/* ---------- scenery: the library is always the background; the butterflies switch swaps the stars for green butterflies ---------- */
{
  const butBtn = document.getElementById('butBtn');
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  let butOn = get('st-bfly') === 'on'; // off by default: stars are the sky
  let H, Sk;
  const sync = () => {
    document.body.classList.add('hall-on');
    H?.set(true); Sk?.butterflies(butOn);
    butBtn.setAttribute('aria-pressed', String(butOn));
  };
  butBtn.onclick = () => { butOn = !butOn; put('st-bfly', butOn ? 'on' : 'off'); sync(); };
  skyReady.then((s) => { Sk = s; sync(); });
  sync();
  soft(import('./hall.js').then(({ hall }) => { H = hall(document.getElementById('hall')); sync(); }));
}

/* ---------- helpers ---------- */
const cleanRoom = (r) => String(r || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'room';
const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const pagesOf = (s) => (s && Array.isArray(s.pages) ? s.pages.filter((p) => p && typeof p === 'object') : []);
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const placeholder = (text) => el('div', 'placeholder', text);
const safePreview = (page) => { try { return preview(page); } catch (e) { console.warn('preview failed', e); return placeholder('Preview unavailable'); } }; // a bad canvas still gets its book

/* a book on the shelf: constellation on the cover, title, one plain line of facts */
function book(href, name, meta, thumb, seed) {
  const h = hash(seed || name), cell = el('div', 'cell'), a = el('a', 'book'); a.href = href;
  a.style.setProperty('--h', String(h % 360)); a.style.setProperty('--bh', 232 + (h % 5) * 9 + 'px');
  const t = el('div', 'bk-thumb'); t.append(thumb); a.append(t, el('div', 'bk-title', name), el('div', 'bk-meta', meta));
  cell.append(a); return cell;
}
const slot = (tag, cls = '') => { const cell = el('div', 'cell'), s = el(tag, 'book slot ' + cls); cell.append(s); return [cell, s]; };

/* ---------- shelf 2: collab canvases (rooms) ---------- */
const sb = (() => { try { const c = window.SUPABASE_CONFIG; return window.supabase && c?.url && c?.key ? window.supabase.createClient(c.url, c.key) : null; } catch { return null; } })();
const rGrid = document.getElementById('roomGrid');
function joinSlot() {
  const [cell, f] = slot('form'); f.id = 'roomForm';
  const label = el('label'), input = el('input'); input.id = 'roomName'; input.type = 'text'; input.maxLength = 80; input.autocomplete = 'off'; input.placeholder = 'room-name'; input.setAttribute('aria-label', 'Room name');
  label.append('Join or create a room', input);
  const go = el('button', 'btn primary', 'Enter room'); go.type = 'submit';
  f.append(label, go, el('small', null, 'A new name creates a new room.'));
  f.onsubmit = (e) => { e.preventDefault(); if (input.value.trim()) location.href = 'app.html?room=' + encodeURIComponent(cleanRoom(input.value)); };
  return cell;
}
function renderRooms() {
  rGrid.textContent = ''; rGrid.append(joinSlot());
  const reg = read('st-rooms') || {}, names = new Set(Object.keys(reg));
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('spazio-teorie-room-v3:')) names.add(k.slice(22)); } } catch {}
  const list = [...names].filter(Boolean).sort((a, b) => (reg[b]?.t || 0) - (reg[a]?.t || 0));
  list.forEach((r) => {
    const href = 'app.html?room=' + encodeURIComponent(r), when = reg[r]?.t ? new Date(reg[r].t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    const fill = (state, old) => { // (re)build one room's book; never throws
      let n;
      try {
        const pgs = pagesOf(state), pg = pgs[state?.current] || pgs[0], c = countOf(pg);
        const meta = pgs.length ? `${plural(pgs.length, 'canvas').replace('canvass', 'canvases')}, ${plural(c.stars, 'star')}${when ? ', visited ' + when : ''}` : (when ? 'Visited ' + when : 'Open to load');
        n = book(href, r, meta, pg ? safePreview(pg) : placeholder('Open to load'), r);
      } catch (e) { console.warn('room failed', r, e); n = book(href, r, 'Open to load', placeholder('Open to load'), r); }
      old ? old.replaceWith(n) : rGrid.append(n); return n;
    };
    const st = read('spazio-teorie-room-v3:' + r), node = fill(st);
    if (!pagesOf(st).length && sb) sb.from('spazio_teorie_projects').select('state').eq('server_id', r).maybeSingle().then(({ data }) => { if (pagesOf(data?.state).length) fill(data.state, node); }).catch(() => {});
  });
  if (!list.length) rGrid.append(el('p', 'empty', 'No rooms yet. Type a name in the empty slot to start one, and it will appear here.'));
}
try { renderRooms(); } catch (e) { console.warn('rooms failed', e); }
addEventListener('pageshow', (e) => { if (e.persisted) { try { renderRooms(); } catch {} } });

/* ---------- shelf 1: personal canvases ---------- */
const pGrid = document.getElementById('personalGrid');
function newSlot() {
  const [cell, a] = slot('a'); a.href = 'app.html?new=1';
  a.append(el('span', 'plus', '+'), el('strong', null, 'New canvas'), el('span', 's', 'Start a blank sky'));
  return cell;
}
try {
  const pgs = pagesOf(read('spazio-teorie-v3'));
  pgs.forEach((p) => {
    try { const c = countOf(p); pGrid.append(book('app.html?page=' + encodeURIComponent(p.id), p.name || 'Untitled', `${plural(c.stars, 'star')}, ${plural(c.links, 'link')}`, safePreview(p), p.id + p.name)); } catch (e) { console.warn('canvas failed', e); }
  });
  if (!pgs.some((p) => p.id === 'tutorial')) soft(import('./tutorial.js').then((m) => { const t = m.tutorialPage(), c = countOf(t); pGrid.prepend(book('app.html?page=tutorial', 'Tutorial', `${plural(c.stars, 'star')}, ${plural(c.links, 'link')}`, safePreview(t), 'tutorial')); }));
} catch (e) { console.warn('personal failed', e); }
pGrid.append(newSlot());
