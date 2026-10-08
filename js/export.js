// Import / export (JSON, PNG, printable PDF) and version history snapshots.
import { app, page, idb, uid, toast, download, normalizeState, blobToDataURL, dataURLToBlob, save, emit } from './core.js';

const stripTags = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };

/* ---- JSON (v1-compatible: media travel as data URLs under `media`) ---- */
export async function exportJSON() {
  const out = JSON.parse(JSON.stringify(app.state)), media = {};
  const ids = new Set();
  out.pages.forEach((p) => p.nodes.forEach((n) => { for (const m of (n.body || '').matchAll(/data-media-id="([^"]+)"/g)) ids.add(m[1]); }));
  out.volumes.forEach((v) => v.coverId && ids.add(v.coverId));
  for (const id of ids) { const r = await idb.get('blobs', id); if (r?.blob) media[id] = await blobToDataURL(r.blob); }
  out.media = media;
  download(`forbidden-library-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
}
export async function importJSON(file) {
  const o = JSON.parse(await file.text());
  const s = normalizeState(o); if (!s) throw new Error('Not a Forbidden Library file');
  if (o.media) for (const id in o.media) await idb.put('blobs', id, { blob: dataURLToBlob(o.media[id]), type: '' });
  delete s.media; app.state = s; emit('state-replaced'); save(); toast('Imported');
}

/* ---- PNG: draw the current constellation straight onto a canvas ---- */
export function exportPNG() {
  const p = page(); if (!p.nodes.length) return toast('Nothing to export');
  const cs = getComputedStyle(document.documentElement), ink = cs.getPropertyValue('--ink').trim(), star = cs.getPropertyValue('--star').trim(), card = cs.getPropertyValue('--ink2').trim();
  const pad = 60, x0 = Math.min(...p.nodes.map((n) => n.x)) - pad, y0 = Math.min(...p.nodes.map((n) => n.y)) - pad;
  const W = Math.max(...p.nodes.map((n) => n.x + n.w)) + pad - x0, H = Math.max(...p.nodes.map((n) => n.y + n.h)) + pad - y0;
  const sc = Math.min(2, 4000 / Math.max(W, H)), cv = document.createElement('canvas'); cv.width = W * sc; cv.height = H * sc;
  const c = cv.getContext('2d'); c.scale(sc, sc); c.translate(-x0, -y0); c.fillStyle = ink; c.fillRect(x0, y0, W, H);
  p.drawings.forEach((s) => { c.strokeStyle = s.color; c.lineWidth = s.w || 3; c.globalAlpha = s.op || 1; c.lineCap = c.lineJoin = 'round'; c.beginPath(); (s.pts || []).forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.stroke(); c.globalAlpha = 1; });
  const by = Object.fromEntries(p.nodes.map((n) => [n.id, n]));
  p.connections.forEach((l) => { const a = by[l.from], b = by[l.to]; if (!a || !b) return; const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by2 = b.y + b.h / 2; c.strokeStyle = l.color; c.lineWidth = 1.6; c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo((ax + bx) / 2 + 2 * (l.bx || 0), (ay + by2) / 2 + 2 * (l.by || 0), bx, by2); c.stroke(); });
  p.nodes.forEach((n) => {
    c.fillStyle = n.bare ? 'transparent' : card; c.strokeStyle = n.color; c.lineWidth = 1.2;
    c.beginPath(); c.roundRect(n.x, n.y, n.w, n.h, 10); if (!n.bare) c.fill(); c.stroke();
    c.fillStyle = n.color; c.beginPath(); c.arc(n.x, n.y, 5, 0, 7); c.fill();
    c.fillStyle = star; c.font = '600 15px Georgia, serif'; c.fillText(n.title || '', n.x + 12, n.y + 24, n.w - 24);
    c.font = `${n.fs || 13}px sans-serif`; const words = stripTags(n.body).split(' '); let line = '', y = n.y + 46;
    for (const w of words) { const t = line + w + ' '; if (c.measureText(t).width > n.w - 24 && line) { c.fillText(line, n.x + 12, y); line = w + ' '; y += (n.fs || 13) * 1.45; if (y > n.y + n.h - 8) break; } else line = t; }
    if (y <= n.y + n.h - 8) c.fillText(line, n.x + 12, y);
  });
  cv.toBlob((b) => download(`${p.name}.png`, b));
}
export function exportPDF() { // browser print dialog → "Save as PDF"; print css hides chrome
  window.print();
}

/* ---- version history (IndexedDB 'history', max 30 per project) ---- */
const hkey = () => 'h:' + (app.room || 'personal');
export async function listSnapshots() { return (await idb.get('history', hkey())) || []; }
export async function takeSnapshot(label = 'Manual') {
  const list = await listSnapshots();
  list.unshift({ id: uid(), t: Date.now(), label, state: JSON.stringify(app.state) });
  await idb.put('history', hkey(), list.slice(0, 30)); if (label === 'Manual') toast('Version saved');
}
export async function restoreSnapshot(id) {
  const s = (await listSnapshots()).find((x) => x.id === id); if (!s) return;
  await takeSnapshot('Before restore');
  app.state = normalizeState(JSON.parse(s.state)); emit('state-replaced'); save();
}
// auto-snapshot at most once per 10 min, only when something changed
let lastAuto = 0;
export function autoSnapshot() { if (Date.now() - lastAuto > 600000) { lastAuto = Date.now(); takeSnapshot('Auto').catch(() => {}); } }
