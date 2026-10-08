// Boot + UI glue: menus, command palette, modals, shortcuts, rooms, file drops.
import { $, uid, defaultState, idb, uploadBlob, app, page, on, emit, save, toast, status, cleanRoom, loadLocal, loadRoomFromServer, normalizeState, persistRoom, settings, saveSettings, copyText, storeBlob, escapeHtml } from './core.js';
import * as map from './map.js';
import * as io from './export.js';
import { sky } from './sky.js';
import * as ops from './canvasops.js';

sky($('sky'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
const root = document.documentElement;
const setTheme = (t) => { root.dataset.theme = t; try { localStorage.setItem('st-theme', t); } catch {} map.drawMinimap(); };
try { const t = localStorage.getItem('st-theme'); if (t) root.dataset.theme = t; } catch {}

/* ---------- menu ---------- */
const menu = $('menu');
export function showMenu(items, x, y) {
  menu.textContent = '';
  items.forEach((it) => {
    const d = document.createElement('div'); d.setAttribute('role', 'menuitem');
    if (it.sep) d.className = 'sep'; else { d.textContent = it.l; if (it.danger) d.className = 'danger'; d.onclick = () => { closeMenu(); it.fn(); }; }
    menu.appendChild(d);
  });
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}
const closeMenu = () => { menu.hidden = true; };
addEventListener('pointerdown', (e) => { if (!e.target.closest('#menu')) closeMenu(); });

/* ---------- modals ---------- */
const modal = $('modal');
function openModal(build) {
  modal.textContent = ''; const card = document.createElement('div'); card.className = 'card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); modal.appendChild(card);
  const close = () => { modal.hidden = true; modal.textContent = ''; }; build(card, close);
  modal.hidden = false; modal.onclick = (e) => { if (e.target === modal) close(); }; (card.querySelector('input,button.primary') || card).focus?.();
  return close;
}
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const btn = (t, fn, cls = '') => h('button', { className: 'btn ' + cls, textContent: t, onclick: fn, type: 'button' });
on('prompt', ({ title, value, ok }) => openModal((card, close) => {
  const i = h('input', { value: value || '' }); const go = () => { close(); ok(i.value); };
  i.onkeydown = (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') close(); };
  card.append(h('h2', { textContent: title, className: 'serif' }), i, h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, btn('Cancel', close), btn('OK', go, 'primary')));
  setTimeout(() => { i.focus(); i.select(); }, 20);
}));
on('confirm', ({ title, ok }) => openModal((card, close) => card.append(h('h2', { textContent: title, className: 'serif' }), h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, btn('Cancel', close), btn('Confirm', () => { close(); ok(); }, 'primary')))));

/* ---------- context menus ---------- */
on('node-menu', ({ n, x, y }) => { const extra = []; emit('node-menu-items', { n, items: extra }); showMenu([
  { l: 'Add image / video file…', fn: () => pickFile('image/*,video/*', (f) => map.insertImage(n.id, f)) },
  { l: 'Embed YouTube…', fn: () => emit('prompt', { title: 'YouTube link', value: '', ok: (v) => map.embedVideo(n.id, v) }) },
  { l: 'Link to another star', fn: () => toast('Drag the round handle on the right edge onto another star') },
  { sep: 1 },
  { l: n.locked ? 'Unlock' : 'Lock', fn: () => { n.locked = !n.locked; map.refreshNode(n.id); save(); } },
  { l: 'Duplicate', fn: () => map.addNode({ ...n, id: undefined, x: n.x + 30, y: n.y + 30, title: n.title + ' (copy)' }) },
  { sep: 1 },
  ...extra,
  { sep: 1 },
  { l: 'Delete star', danger: true, fn: () => map.removeNodes([n.id]) },
], x, y); });
on('conn-menu', ({ c, x, y }) => showMenu([
  { l: 'Edit relation label', fn: () => map.editLabel(c) },
  ...Object.entries(map.KIND).map(([k, v]) => ({ l: `${c.kind === k ? '✓ ' : ''}${v.g}  ${v.name}`, fn: () => map.setLinkKind(c, c.kind === k ? null : k) })),
  { l: 'Straighten', fn: () => { delete c.bx; delete c.by; map.renderLinks(); save(); } },
  { sep: 1 }, { l: 'Delete link', danger: true, fn: () => map.removeConnection(c.id) },
], x, y));
on('canvas-menu', ({ x, y, p }) => showMenu([
  { l: 'New star here', fn: () => map.addNode({ x: Math.round(p.x - 120), y: Math.round(p.y - 60) }) },
  { l: 'Fit everything', fn: () => map.fitAll() },
  { l: 'Auto-arrange', fn: map.autoLayout },
], x, y));
function pickFile(accept, cb) { const i = $('fileAny'); i.accept = accept; i.onchange = () => { [...i.files].forEach(cb); i.value = ''; }; i.click(); }

/* ---------- state replaced (import / restore / room adopt) ---------- */
on('state-replaced', () => { map.loadView(); map.render(); emit('library-render'); });

/* ---------- commands + palette ---------- */
const act = (l, k, fn) => ({ l, k, fn });
const commands = () => [
  act('New star', 'N', () => map.addNode()),
  act('New constellation (page)', '', map.addPage),
  act('Duplicate this canvas', '', () => ops.duplicate(app.state.current)),
  act('Auto-arrange stars', '', map.autoLayout),
  act('Fit everything in view', 'F', () => map.fitAll()),
  act('Toggle pen', 'P', () => map.setPen(!map.pen.on)),
  act('Toggle snap to grid', '', () => { settings.snap = !settings.snap; saveSettings(); toast('Snap ' + (settings.snap ? 'on' : 'off')); }),
  act('Undo', 'Ctrl Z', map.undo), act('Redo', 'Ctrl Shift Z', map.redo),
  act('Open library', 'L', () => toggleLib()),
  act('Export JSON', '', io.exportJSON), act('Export PNG of this constellation', '', io.exportPNG), act('Print / save as PDF', '', io.exportPDF),
  act('Import JSON…', '', () => pickFile('.json,application/json', (f) => io.importJSON(f).catch((e) => toast(e.message)))),
  act('Save a version now', '', () => io.takeSnapshot('Manual')), act('Version history…', '', versionHistory),
  act('Room / collaboration…', '', roomModal),
  act('Settings…', '', settingsModal),
  act('Toggle day / night theme', '', () => setTheme(root.dataset.theme === 'day' ? 'night' : 'day')),
  ...tools.map((t) => act(t.label, t.key || '', t.fn)),
  act('Home', '', () => { location.href = './'; }),
];
const toolsMenu = (x, y) => showMenu(tools.length ? tools.map((t) => ({ l: t.label, fn: t.fn })) : [{ l: 'No tools loaded yet', fn() {} }], x, y);
const pal = $('palette'), palIn = $('palInput'), palList = $('palList'); let palItems = [], palHl = 0;
function palRender() {
  const q = palIn.value.trim().toLowerCase();
  const cmds = commands().filter((c) => !q || c.l.toLowerCase().includes(q)).map((c) => ({ ...c, kind: c.k }));
  const stars = q ? page().nodes.filter((n) => (n.title || '').toLowerCase().includes(q)).slice(0, 8).map((n) => ({ l: '✦ ' + n.title, k: 'star', fn: () => map.focusNode(n.id) })) : [];
  palItems = [...stars, ...cmds]; palHl = Math.min(palHl, Math.max(0, palItems.length - 1)); palList.textContent = '';
  palItems.forEach((it, i) => { const li = h('li', { className: i === palHl ? 'hl' : '', onclick: () => runPal(i) }, h('span', { textContent: it.l }), h('span', { className: 'mono', textContent: it.k || '' })); palList.appendChild(li); });
}
const runPal = (i) => { const it = palItems[i]; closePal(); it?.fn(); };
function openPal() { pal.hidden = false; palIn.value = ''; palHl = 0; palRender(); palIn.focus(); }
function closePal() { pal.hidden = true; }
palIn.oninput = () => { palHl = 0; palRender(); };
palIn.onkeydown = (e) => { if (e.key === 'ArrowDown') { palHl = (palHl + 1) % palItems.length; palRender(); e.preventDefault(); } else if (e.key === 'ArrowUp') { palHl = (palHl - 1 + palItems.length) % palItems.length; palRender(); e.preventDefault(); } else if (e.key === 'Enter') runPal(palHl); else if (e.key === 'Escape') closePal(); };
addEventListener('pointerdown', (e) => { if (!e.target.closest('#palette,#btnK')) closePal(); });

/* ---------- modals: settings, room, history ---------- */
function field(label, key, type = 'text', ph = '') { const i = h('input', { type, value: settings[key] || '', placeholder: ph, autocomplete: 'off' }); i.oninput = () => { settings[key] = i.value; saveSettings(); }; return h('label', { textContent: label }, i); }
function slider(label, key, def, max = 100, unit = '%') {
  const out = h('span', { className: 'mono', textContent: (settings[key] ?? def) + unit });
  const i = h('input', { type: 'range', min: 0, max, step: max > 100 ? 1 : 5, value: settings[key] ?? def, style: 'padding:0;accent-color:var(--gold)' });
  i.oninput = () => { settings[key] = +i.value; out.textContent = i.value + unit; saveSettings(); };
  return h('label', {}, h('span', { style: 'display:flex;justify-content:space-between' }, label, out), i);
}
function toggle(label, key, def = false) {
  return h('label', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px' }, h('span', { textContent: label }),
    Object.assign(h('input', { type: 'checkbox', checked: settings[key] ?? def }), { onchange(e) { settings[key] = e.target.checked; saveSettings(); emit('settings-changed', { key }); } }));
}
function select(label, key, options, def) { // options: [[value, label], ...]
  const s = h('select', {}, ...options.map(([v, l]) => h('option', { value: v, textContent: l, selected: (settings[key] ?? def) === v })));
  s.onchange = () => { settings[key] = s.value; saveSettings(); emit('settings-changed', { key }); };
  return h('label', { textContent: label }, s);
}
const settingsSections = []; // modules add their own blocks: emit('register-settings', (card, ui) => card.append(...))
on('register-settings', (fn) => settingsSections.push(fn));
settingsSections.push((box, ui) => box.append(ui.h('p', { className: 'mono', textContent: 'Navigation' }), ui.slider('Pan smoothness (middle-drag)', 'panSmooth', 50), ui.h('p', { className: 'hint', textContent: '0% follows every mouse movement exactly. Higher values glide and ignore tiny jitters.' })));
const tools = []; // modules add actions to the Tools menu + command palette: emit('register-tool', {label, key?, fn})
on('register-tool', (t) => tools.push(t));
function settingsModal() {
  openModal((card, close) => card.append(h('h2', { textContent: 'Settings', className: 'serif' }),
    field('Your name in rooms', 'name', 'text', 'Anonymous'),
    ...(() => { const box = h('div', { style: 'display:grid;gap:10px' }); settingsSections.forEach((fn) => { try { fn(box, { h, btn, field, slider, toggle, select }); } catch (e) { console.error(e); } }); return [box]; })(),
    h('p', { className: 'mono', textContent: 'Sky' }), slider('Stars in the background', 'skyStars', 30), slider('Constellation lines between stars', 'skyLines', 55), slider('Your cursor colour (hue)', 'hue', 40, 360, '°'),
    h('label', { style: 'display:flex;align-items:center;justify-content:space-between;gap:12px' }, h('span', { textContent: 'Play the shared sound effect from other people in a room' }), Object.assign(h('input', { type: 'checkbox', checked: !!settings.allowSfx }), { onchange(e) { settings.allowSfx = e.target.checked; saveSettings(); } })),
    h('p', { className: 'mono', textContent: 'Voice, translation and AI keys' }),
    field('ElevenLabs key', 'elKey', 'password'), field('OpenAI-compatible key', 'oaKey', 'password'), field('Google Cloud TTS key', 'gcKey', 'password'), field('Gemini key', 'gemKey', 'password'), field('AI translation key', 'aiKey', 'password'),
    h('p', { className: 'hint', textContent: 'Keys stay on this device only (localStorage) and are never synced to rooms.' }),
    h('div', { style: 'display:flex;justify-content:flex-end' }, btn('Done', close, 'primary'))));
}
function roomModal() {
  openModal((card, close) => {
    const i = h('input', { value: app.room || '', placeholder: 'room-name' });
    const tool = (re, label) => { const t = tools.find((x) => re.test(x.label)); return t ? btn(label, () => { close(); t.fn(); }) : ''; };
    card.append(h('h2', { textContent: 'Room', className: 'serif' }), h('p', { className: 'hint', textContent: app.room ? `You are in “${app.room}”. Anyone with the name can edit.` : 'Rooms sync to the server and live between people. Anyone who knows the name can edit, so choose a hard-to-guess one.' }), i,
      h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, app.room ? tool(/Share links/i, 'Share links') : '', app.room ? tool(/members/i, 'Members & roles') : '', app.room ? tool(/Activity/i, 'Activity') : '', tool(/Publish/i, 'Publish canvas')),
      h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' },
        app.room ? btn('Copy link', () => copyText(`${location.origin}${location.pathname}?room=${encodeURIComponent(app.room)}`).then(() => toast('Link copied'))) : '',
        app.room ? btn('Leave', () => { location.href = 'app.html'; }) : '', btn('Join', () => { if (i.value.trim()) location.href = 'app.html?room=' + encodeURIComponent(cleanRoom(i.value)); }, 'primary')));
  });
}
async function versionHistory() {
  const list = await io.listSnapshots();
  openModal((card, close) => card.append(h('h2', { textContent: 'Version history', className: 'serif' }),
    ...(list.length ? list.map((s) => h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, h('span', { textContent: `${new Date(s.t).toLocaleString()} · ${s.label}` }), btn('Restore', () => { close(); io.restoreSnapshot(s.id); }))) : [h('p', { className: 'hint', textContent: 'No versions yet. They are saved automatically while you work.' })]),
    h('div', { style: 'display:flex;justify-content:flex-end' }, btn('Close', close))));
}

/* ---------- comments on stars ---------- */
on('comments', (id) => {
  const n = page().nodes.find((x) => x.id === id); if (!n) return;
  openModal((card, close) => {
    const list = h('div'), ta = h('textarea', { placeholder: 'Write a comment…', rows: 3, maxLength: 1000 });
    const draw = () => {
      list.textContent = '';
      (n.comments || []).forEach((c) => list.append(h('div', { className: 'cmt' }, h('div', {}, h('b', { textContent: c.by || 'Anonymous' }), h('time', { textContent: new Date(c.t).toLocaleString() })), h('div', { textContent: c.text }),
        h('button', { className: 'btn', textContent: '✕', title: 'Delete comment', type: 'button', onclick: () => { n.comments = n.comments.filter((x) => x.id !== c.id); save(); map.refreshNode(n.id); draw(); } }))));
      if (!n.comments?.length) list.append(h('p', { className: 'hint', textContent: 'No comments yet.' }));
    };
    const add = () => { const t = ta.value.trim(); if (!t) return; n.comments = [...(n.comments || []), { id: uid(), by: settings.name || 'Anonymous', t: Date.now(), text: t.slice(0, 1000) }].slice(-100); ta.value = ''; save(); map.refreshNode(n.id); draw(); };
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); };
    card.append(h('h2', { textContent: 'Comments · ' + (n.title || 'Star'), className: 'serif' }), list, ta, h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, btn('Close', close), btn('Add comment', add, 'primary')));
    draw(); ta.focus();
  });
});

/* ---------- canvas (tab) menu: rename, duplicate, copy / move to personal or a room ---------- */
function transferModal(i, move) {
  openModal((card, close) => {
    const room = h('input', { placeholder: 'room-name', value: '' });
    card.append(h('h2', { textContent: (move ? 'Move “' : 'Copy “') + app.state.pages[i].name + '”', className: 'serif' }),
      h('p', { className: 'hint', textContent: 'Choose where it goes. Links to library volumes become plain text labels in another project.' }),
      app.room ? btn('To my personal canvases', () => { close(); ops.transfer(i, { kind: 'personal' }, move); }) : '',
      h('label', { textContent: 'Or to a room' }, room),
      h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, btn('Cancel', close), btn(move ? 'Move to room' : 'Copy to room', () => { if (room.value.trim()) { close(); ops.transfer(i, { kind: 'room', name: room.value }, move); } }, 'primary')));
  });
}
on('tab-menu', ({ i, x, y }) => showMenu([
  { l: 'Rename', fn: () => emit('prompt', { title: 'Rename canvas', value: app.state.pages[i].name, ok: (v) => { if (v.trim()) { app.state.pages[i].name = v.trim(); map.renderTabs(); save(); } } }) },
  { l: 'Duplicate', fn: () => ops.duplicate(i) },
  { l: 'Copy to…', fn: () => transferModal(i, false) },
  { l: 'Move to…', fn: () => transferModal(i, true) },
  { sep: 1 }, { l: 'Delete', danger: true, fn: () => map.deletePage(i) },
], x, y));

/* ---------- toolbar ---------- */
const lib = $('library');
const wide = () => innerWidth > 760;
function toggleLib(force) {
  const open = force ?? (wide() ? document.body.classList.contains('lib-closed') : !lib.classList.contains('open'));
  lib.hidden = false;
  if (wide()) { document.body.classList.toggle('lib-closed', !open); try { localStorage.setItem('st-lib', open ? 'open' : 'closed'); } catch {} setTimeout(() => dispatchEvent(new Event('resize')), 260); }
  else lib.classList.toggle('open', open);
  emit('library-toggle', open);
}
try { if (localStorage.getItem('st-lib') === 'closed') document.body.classList.add('lib-closed'); } catch {}
$('btnAdd').onclick = () => map.addNode();
const mediaStars = (files, at) => [...files].filter((f) => /^(image|video)\//.test(f.type)).forEach((f, i) => { const c = at || map.viewCenter(); const n = map.addNode({ x: Math.round(c.x - 120 + i * 40), y: Math.round(c.y - 90 + i * 40), title: f.name.replace(/\.\w+$/, ''), body: '' }); map.insertImage(n.id, f); });
$('btnMedia').onclick = () => { const i = $('fileAny'); i.accept = 'image/*,video/*'; i.onchange = () => { mediaStars(i.files); i.value = ''; }; i.click(); };
on('add-media', (id) => pickFile('image/*,video/*', (f) => map.insertImage(id, f)));
addEventListener('paste', (e) => { if (typing()) return; const fs = [...(e.clipboardData?.files || [])]; if (fs.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); mediaStars(fs); } });
$('btnPen').onclick = () => map.setPen(!map.pen.on);
$('btnCollab').onclick = roomModal;
$('btnLib').onclick = () => toggleLib();
$('libClose').onclick = () => toggleLib(false);
$('libTab').onclick = () => toggleLib(true);
$('btnK').onclick = openPal;
$('btnSettings').onclick = settingsModal;
$('btnTools').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); toolsMenu(r.left, r.bottom + 6); };
$('search').oninput = (e) => map.search(e.target.value);
$('search').onkeydown = (e) => { if (e.key === 'Enter') map.search(e.target.value, e.shiftKey ? -1 : 1); if (e.key === 'Escape') { e.target.value = ''; map.search(''); e.target.blur(); } };

/* ---------- keyboard ---------- */
const typing = () => { const a = document.activeElement; return a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName)); };
addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.hidden ? openPal() : closePal(); return; }
  if (e.key === 'Escape') { closePal(); closeMenu(); if (map.pen.on) map.setPen(false); else map.clearSel(); return; }
  if (typing()) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? map.redo() : map.undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); map.redo(); }
  else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); page().nodes.forEach((n) => map.sel.add(n.id)); map.select(null, true); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (map.sel.size) map.removeNodes([...map.sel]); else if (map.selConn) map.removeConnection(map.selConn); }
  else if (!mod && e.key.toLowerCase() === 'n') { e.preventDefault(); map.addNode(); }
  else if (!mod && e.key.toLowerCase() === 'm') $('btnMedia').click();
  else if (!mod && e.key.toLowerCase() === 'p') map.setPen(!map.pen.on);
  else if (!mod && e.key.toLowerCase() === 'f') map.fitAll();
  else if (!mod && e.key.toLowerCase() === 'l') toggleLib();
  else if (e.key === '/') { e.preventDefault(); $('search').focus(); }
  else if (e.key.startsWith('Arrow') && map.sel.size) { e.preventDefault(); const s = e.shiftKey ? 40 : 10; map.selNodes().forEach((n) => { if (n.locked) return; if (e.key === 'ArrowLeft') n.x -= s; if (e.key === 'ArrowRight') n.x += s; if (e.key === 'ArrowUp') n.y -= s; if (e.key === 'ArrowDown') n.y += s; }); map.render(); save(); }
});

/* ---------- drop / paste files ---------- */
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault(); const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) { const link = (e.dataTransfer?.getData('text/uri-list') || '').split(/\r?\n/).find((l) => /^https?:\/\//i.test(l)); if (link && !app.readonly) emit('import-url', link.trim()); return; } // a link dragged from the address bar
  const p = map.worldPos(e.clientX, e.clientY), rest = [];
  files.forEach((f) => { if (f.type.startsWith('image/') || f.type.startsWith('video/')) { const n = map.addNode({ x: p.x - 120, y: p.y - 60, title: f.name.replace(/\.\w+$/, '') }); map.insertImage(n.id, f); } else rest.push(f); });
  rest.forEach((f) => { if (/\.json$/i.test(f.name)) io.importJSON(f).catch((er) => toast(er.message)); else emit('file-drop', { file: f }); });
});

/* ---------- save hooks ---------- */
on('changed', () => { io.autoSnapshot(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persistRoom(); });

/* ---------- reader split view: reader on the left, map stays usable; Focus = full screen ---------- */
{
  const rd = $('reader'), grip = h('div', { id: 'rdGrip', title: 'Drag to resize' });
  document.body.append(grip);
  try { const w = +localStorage.getItem('st-rw'); if (w) root.style.setProperty('--rw', w + 'px'); } catch {}
  const sync = () => { document.body.classList.toggle('reader-open', !rd.hidden); setTimeout(() => dispatchEvent(new Event('resize')), 30); };
  new MutationObserver(sync).observe(rd, { attributes: true, attributeFilter: ['hidden'] }); sync();
  grip.onpointerdown = (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const mv = (ev) => { const w = Math.max(320, Math.min(innerWidth * 0.75, ev.clientX)); root.style.setProperty('--rw', w + 'px'); try { localStorage.setItem('st-rw', Math.round(w)); } catch {} dispatchEvent(new Event('resize')); };
    const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up);
  };
}

/* ---------- library sidebar: drag its edge to resize (double-click resets, arrow keys nudge) ---------- */
{
  const DEF = 380, MIN = 280, max = () => Math.min(760, Math.round(innerWidth * 0.6));
  const grip = h('div', { id: 'libGrip', role: 'separator', ariaOrientation: 'vertical', ariaLabel: 'Resize the library', title: 'Drag to resize (double-click to reset)', tabIndex: 0 });
  document.body.append(grip);
  const set = (w, keep = true) => { w = Math.max(MIN, Math.min(max(), Math.round(w))); root.style.setProperty('--lw', w + 'px'); if (keep) { try { localStorage.setItem('st-lw', w); } catch {} } dispatchEvent(new Event('resize')); return w; };
  try { const w = +localStorage.getItem('st-lw'); if (w) set(w, false); } catch {}
  grip.onpointerdown = (e) => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId); document.body.classList.add('dragging-lw');
    const mv = (ev) => set(ev.clientX), up = () => { document.body.classList.remove('dragging-lw'); grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  };
  grip.ondblclick = () => { try { localStorage.removeItem('st-lw'); } catch {} root.style.setProperty('--lw', DEF + 'px'); dispatchEvent(new Event('resize')); };
  grip.onkeydown = (e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); set($('library').getBoundingClientRect().width + (e.key === 'ArrowRight' ? 20 : -20)); };
}

/* ---------- easter egg: ↑ ↑ ↓ ↓ ← → ← → plays the secret sound (and, if allowed, for everyone in the room) ---------- */
{
  const SEQ = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
  let k = 0, last = 0;
  const secret = new Audio('sfx/sfx.mp3'); secret.preload = 'auto'; secret.volume = 0.5;
  window.__konami = () => { try { secret.currentTime = 0; secret.play().catch(() => toast('Sound blocked by the browser: click the page once and try again')); } catch {} toast('✦ Secret constellation unlocked'); document.body.classList.add('konami'); setTimeout(() => document.body.classList.remove('konami'), 1600); import('./collab.js').then((c) => c.net.send('sfx', 1)).catch(() => {}); };
  addEventListener('keydown', (e) => {
    const a = document.activeElement; if (a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { k = 0; return; }
    const now = Date.now(); if (now - last > 2500) k = 0; last = now;
    k = e.key === SEQ[k] ? k + 1 : e.key === SEQ[0] ? 1 : 0;
    if (k === SEQ.length) { k = 0; window.__konami(); }
  }, true);
}

/* ---------- entering a room: read first, write later ---------- */
const TIMEOUT = Symbol('timeout');
const starsOf = (s) => s.pages.reduce((n, p) => n + p.nodes.length, 0);
const keepLocalCopy = () => { try { localStorage.setItem('spazio-teorie-room-v3:' + app.room, JSON.stringify(app.state)); } catch {} };
function adopt(s) { const cur = app.state.current; app.state = s; app.state.current = Math.min(cur || 0, s.pages.length - 1); app.serverStars = starsOf(s); emit('state-replaced'); keepLocalCopy(); }

async function enterRoom() {
  const pending = loadRoomFromServer(app.room), server = await Promise.race([pending, new Promise((r) => setTimeout(() => r(TIMEOUT), 10000))]);
  if (server === TIMEOUT || app.loadError) { // we could NOT read the room: stay read-safe, never upload over it
    status('Offline copy · not saving to the server');
    toast('Could not reach the room on the server. Your edits stay on this device and are NOT uploaded, so the room cannot be overwritten. Reload to retry.');
    if (server === TIMEOUT) pending.then((s) => { if (!s) return; if (!app.dirty) { adopt(s); app.writeBlock = false; status('Room · ' + app.room); toast('The room finished loading.'); } else toast('The room finally loaded. Reload to see it (your edits on this device were not uploaded).'); });
    return;
  }
  app.writeBlock = false;
  if (server) {
    if (starsOf(app.state) > 0 && JSON.stringify(app.state.pages) !== JSON.stringify(server.pages)) { try { localStorage.setItem(`spazio-teorie-backup-${app.room}-${Date.now()}`, JSON.stringify(app.state)); } catch {} } // never silently drop what this device had
    adopt(server);
  } else if (app.serverReady) await newRoomChoice();
  status('Room · ' + app.room); keepLocalCopy();
}

/* a room that does not exist yet: ask what it should start with (and say plainly who can read it) */
function newRoomChoice() {
  const mine = loadLocal(null);
  if (!mine || (starsOf(mine) === 0 && !mine.volumes.length)) return;
  return new Promise((resolve) => {
    let done = false; const finish = (how) => { if (done) return; done = true; mo.disconnect(); modal.hidden = true; modal.textContent = ''; resolve(how); };
    const mo = new MutationObserver(() => { if (modal.hidden) finish('empty'); }); mo.observe(modal, { attributes: true, attributeFilter: ['hidden'] });
    openModal((card) => card.append(
      h('h2', { className: 'serif', textContent: `New room “${app.room}”` }),
      h('p', { textContent: 'This room does not exist yet. What should it start with?' }),
      h('p', { className: 'hint', textContent: 'Anyone who knows the room name can read and edit what you put in it. Your personal canvases stay on this device either way: this only makes a copy.' }),
      h('div', { style: 'display:grid;gap:8px' }, btn('Start with an empty canvas', () => finish('empty')), btn('Bring a copy of my canvases and library', () => finish('bring'), 'primary'))));
  }).then(async (how) => {
    if (how !== 'bring') return;
    const copy = JSON.parse(JSON.stringify(mine)); copy.pages = copy.pages.filter((p) => p.id !== 'tutorial'); if (!copy.pages.length) copy.pages = defaultState().pages; copy.current = 0;
    app.state = copy; emit('state-replaced'); keepLocalCopy();
    const ids = new Set(); copy.pages.forEach((p) => p.nodes.forEach((n) => { for (const x of (n.body || '').matchAll(/data-media-id="([^"]+)"/g)) ids.add(x[1]); })); copy.volumes.forEach((v) => v.coverId && ids.add(v.coverId));
    if (app.serverReady) { for (const id of ids) { const r = await idb.get('blobs', id).catch(() => null); if (r?.blob) uploadBlob(id, r.blob, 'blob'); } }
    persistRoom(); toast('Room created with a copy of your canvases');
  });
}

/* ---------- boot ---------- */
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
async function boot() {
  const q = new URLSearchParams(location.search).get('room');
  if (q) { app.room = cleanRoom(q); app.state = loadLocal(app.room) || defaultState(); app.writeBlock = true; status('Connecting · ' + app.room); } // nothing is uploaded until the room's real content has been read
  if (q) { try { const r = JSON.parse(localStorage.getItem('st-rooms') || '{}'); r[app.room] = { t: Date.now() }; localStorage.setItem('st-rooms', JSON.stringify(r)); } catch {} }
  const P = new URLSearchParams(location.search), pid = P.get('page');
  if (pid) { const i = app.state.pages.findIndex((x) => x.id === pid); if (i >= 0) app.state.current = i; }
  if (P.get('new')) { app.state.pages.push({ id: uid(), name: 'Constellation ' + (app.state.pages.length + 1), nodes: [], connections: [], drawings: [] }); app.state.current = app.state.pages.length - 1; save(); history.replaceState(null, '', location.pathname + (q ? '?room=' + encodeURIComponent(q) : '')); }
  const view = P.get('view'); // published read-only canvas: ?view=<id>
  if (view) {
    app.readonly = true; document.body.classList.add('readonly'); status('Read-only · published canvas');
    const row = app.serverReady ? await withTimeout(app.supabase.from('spazio_teorie_projects').select('state').eq('server_id', 'pub-' + cleanRoom(view)).maybeSingle().then((r) => r.data), 8000) : null;
    const st = row && normalizeState(row.state);
    if (st) { app.state = st; app.state.current = 0; } else toast('This published canvas was not found.');
  }
  map.loadView(); map.render();
  // modules load right away; the server never blocks the UI
  const helpers = { showMenu, openModal, h, btn, pickFile, toggleLib, field, slider, toggle, select };
  const load = async (m) => { try { (await import(`./${m}.js`)).init?.(helpers); } catch (e) { if (/Failed to fetch dynamically|error loading dynamically|Failed to load module/i.test(String(e.message))) console.info('module not present:', m); else { console.error(m, e); toast(`${m} failed to load: ${e.message || e}`); } } };
  for (const m of ['themes', 'audio', 'library', 'webimport', 'voice', 'study', 'journey', 'argument', 'universe', 'tutorial']) await load(m);
  if (view) { await load('social'); return; } // read-only viewers never join the live room
  if (q) await enterRoom();
  await load('collab'); // after the server state, so peers diff against the right baseline
  await load('social'); // roles, presence, reactions, activity, share links: needs collab's channel
}
boot();
