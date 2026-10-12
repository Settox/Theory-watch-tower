// Web clipper: a bookmarklet (works in any browser, no extension) plus the phone share sheet (installed PWA).
// Both open the app with the clip in the URL hash / query; it becomes a star on the current canvas, then the URL is cleaned.
import { app, on, emit, toast, escapeHtml, cleanRoom, copyText } from './core.js';
import * as map from './map.js';

const httpUrl = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) && !x.username && !x.password && x.href.length < 2000 ? x.href : ''; } catch { return ''; } };
const str = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

export function bookmarklet(room) {
  const target = new URL('app.html', location.href).href + (room ? '?room=' + encodeURIComponent(room) : '');
  const code = '(function(){var d=document,m=function(n){var e=d.querySelector(\'meta[property="\'+n+\'"],meta[name="\'+n+\'"]\');return e&&e.content||""},' +
    'o={t:(m("og:title")||d.title).slice(0,200),u:location.href,q:String(getSelection()).trim().slice(0,6000),d:(m("og:description")||m("description")).slice(0,400)};' +
    'window.open(' + JSON.stringify(target) + '+"#clip="+encodeURIComponent(JSON.stringify(o)),"_blank")})()';
  return 'javascript:' + code;
}

function addClip(o) {
  if (app.readonly) return toast('This canvas is read-only, so the clip was not added.');
  const u = httpUrl(o.u), q = str(o.q, 6000), d = str(o.d, 400), host = u ? new URL(u).hostname.replace(/^www\./, '') : '';
  const title = str(o.t, 200) || host || 'Clip';
  if (!u && !q && !d) return;
  const body = (q ? `<p>${escapeHtml(q)}</p>` : d ? `<p><i>${escapeHtml(d)}</i></p>` : '') + (host ? `<p>${escapeHtml(host)}</p>` : '');
  const n = map.addNode({ title, body: body || '<p></p>', source: u ? { type: 'web', url: u, label: host } : '' });
  if (n) { map.focusNode(n.id); toast('Clip added to the map'); }
}

// what arrived with the page: #clip=<json> from the bookmarklet, or ?title&text&url from the phone share sheet
function incoming() {
  let o = null;
  const hm = location.hash.match(/^#clip=(.+)$/);
  if (hm) { try { o = JSON.parse(decodeURIComponent(hm[1])); } catch {} }
  const P = new URLSearchParams(location.search);
  if (!o && (P.has('url') || P.has('text') || P.has('title'))) {
    let u = P.get('url') || '', x = P.get('text') || '';
    if (!u) { const m = x.match(/https?:\/\/\S+/); if (m) { u = m[0]; x = x.replace(m[0], '').trim(); } } // Android puts the link inside `text`
    o = { t: P.get('title') || '', u, q: x };
  }
  if (hm || P.has('url') || P.has('text') || P.has('title')) { ['url', 'text', 'title'].forEach((k) => P.delete(k)); const qs = P.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); }
  return o && typeof o === 'object' ? o : null;
}

function dialog(ui) {
  ui.openModal((card, close) => {
    const room = ui.h('input', { value: app.room || '', placeholder: 'room name (leave empty for your personal canvases)', autocomplete: 'off' });
    const link = ui.h('a', { className: 'btn primary', textContent: '✦ Clip to Library', draggable: true, onclick: (e) => { e.preventDefault(); toast('Drag this button onto your bookmarks bar'); } });
    const set = () => { link.href = bookmarklet(room.value.trim() ? cleanRoom(room.value) : ''); };
    room.oninput = set; set();
    card.append(
      ui.h('h2', { className: 'serif', textContent: 'Web clipper' }),
      ui.h('p', { textContent: '1. Drag the button below onto your bookmarks bar.' }), ui.h('div', {}, link),
      ui.h('p', { textContent: '2. On any page, select some text (or nothing) and click the bookmark. The page opens here and the clip lands as a star.' }),
      ui.h('label', { textContent: 'Send clips to this room' }, room),
      ui.h('p', { className: 'hint', textContent: 'On a phone: install the app, then use Share → The Forbidden Library from any browser. No bookmarks bar? Copy the code and paste it as the address of a new bookmark. A few sites (GitHub, some banks) block bookmarklets by policy.' }),
      ui.h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' }, ui.btn('Copy bookmarklet code', () => copyText(link.href).then(() => toast('Copied'))), ui.btn('Done', close, 'primary')));
  });
}

export function init(ui) {
  emit('register-tool', { label: 'Web clipper (bookmarklet)…', fn: () => dialog(ui) });
  const clip = incoming();
  if (clip) on('booted', () => addClip(clip)); // after the room has loaded, or it would be replaced by the server copy
  on('open-source', (s) => { if (s && s.type === 'web') { const u = httpUrl(s.url); if (u) window.open(u, '_blank', 'noopener,noreferrer'); } });
}
