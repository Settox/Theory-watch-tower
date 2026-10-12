import { load, grab, target, cleanRoom } from './clip.js';

const $ = (id) => document.getElementById(id), say = (t) => { $('msg').textContent = t; };
const NEW_ROOM = '__new_room__';
let S, clip = { t: '', u: '', q: '', d: '' };

const opt = (v, t) => Object.assign(document.createElement('option'), { value: v, textContent: t });
function fill() {
  const rooms = [...new Set([...(S.lib.rooms || []), ...(S.rooms || [])])].sort();
  const sp = $('space'); sp.textContent = '';
  sp.append(opt('personal', 'My personal canvases'), ...rooms.map((r) => opt('room:' + r, 'Room: ' + r)), opt(NEW_ROOM, 'Another room…'));
  sp.value = [...sp.options].some((o) => o.value === S.last.space) ? S.last.space : 'personal';
  const cv = $('canvas'); cv.textContent = '';
  cv.append(opt('', 'The canvas that is open'), opt('new', 'A new canvas'), ...(S.lib.pages || []).map((p) => opt(p.id, p.name)));
  cv.value = [...cv.options].some((o) => o.value === S.last.canvas) ? S.last.canvas : '';
  show();
}
function show() {
  const v = $('space').value;
  $('roomRow').hidden = v !== NEW_ROOM;
  $('canvasRow').hidden = v !== 'personal'; // a room opens on whatever canvas is open there
}

async function init() {
  S = await load();
  $('app').value = S.app;
  fill();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    clip = { t: (tab && tab.title) || '', u: (tab && tab.url) || '', q: '', d: '' };
    try { const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab }); if (r && r.result) clip = r.result; } catch { /* internal browser pages cannot be read: the title and address still go */ }
  } catch { /* no tab */ }
  $('ptitle').textContent = clip.t || 'This page';
  $('purl').textContent = clip.u;
  $('psel').textContent = clip.q ? '“' + clip.q.slice(0, 220) + (clip.q.length > 220 ? '…' : '') + '”' : '';
  $('clip').textContent = clip.q ? 'Clip the selection' : 'Clip this page';
}

$('space').onchange = show;
$('clip').onclick = async () => {
  let space = $('space').value;
  if (space === NEW_ROOM) {
    const r = cleanRoom($('room').value); if (!r) return say('Type a room name first.');
    space = 'room:' + r; S.rooms = [...new Set([...(S.rooms || []), r])];
  }
  const dest = { space, canvas: space === 'personal' ? $('canvas').value : '' };
  await chrome.storage.local.set({ last: dest, rooms: S.rooms || [] });
  chrome.tabs.create({ url: target($('app').value.trim() || S.app, dest, clip) });
  window.close();
};
$('app').onchange = async () => { S.app = $('app').value.trim(); await chrome.storage.local.set({ app: S.app }); say('Address saved.'); };
$('connect').onclick = async () => {
  try {
    const origin = new URL($('app').value.trim()).origin + '/*';
    if (!(await chrome.permissions.request({ origins: [origin] }))) return say('Permission was not granted.');
    await chrome.storage.local.set({ app: $('app').value.trim() });
    await chrome.scripting.unregisterContentScripts({ ids: ['fl-sync'] }).catch(() => {});
    await chrome.scripting.registerContentScripts([{ id: 'fl-sync', js: ['sync.js'], matches: [origin], runAt: 'document_idle' }]);
    say('Connected. Open the app once and your canvases and rooms will appear here.');
  } catch (e) { say('That address does not look right.'); }
};
chrome.storage.onChanged.addListener(async () => { S = await load(); fill(); });
init();
