// Canvas (page) operations: duplicate, copy/move to personal or to a room.
import { app, uid, save, toast, idb, cleanRoom, loadLocal, loadRoomFromServer, normalizeState, defaultState, writeRoom, uploadBlob, emit } from './core.js';

const PERSONAL = 'spazio-teorie-v3', ROOM = 'spazio-teorie-room-v3:';

/* deep copy with fresh ids; cross-project copies turn volume links into plain text labels (the volume isn't there) */
export function clonePage(p, { detach = false, name } = {}) {
  const c = JSON.parse(JSON.stringify(p)), map = {};
  c.id = uid(); c.name = name || p.name + ' (copy)';
  c.nodes.forEach((n) => { map[n.id] = n.id = uid(); if (detach && n.source && typeof n.source === 'object') n.source = `${n.source.volumeName || n.source.label || 'Volume'}${n.source.page ? ' · p.' + n.source.page : ''}`; });
  c.connections = c.connections.filter((l) => map[l.from] && map[l.to]).map((l) => ({ ...l, id: uid(), from: map[l.from], to: map[l.to] }));
  (c.drawings || []).forEach((d) => { d.id = uid(); });
  return c;
}
export function duplicate(i) {
  const p = app.state.pages[i], c = clonePage(p);
  app.state.pages.splice(i + 1, 0, c); app.state.current = i + 1; emit('state-replaced'); save(); toast('Canvas duplicated');
}
const mediaIds = (p) => { const s = new Set(); p.nodes.forEach((n) => { for (const m of (n.body || '').matchAll(/data-media-id="([^"]+)"/g)) s.add(m[1]); }); return [...s]; };

/** target: {kind:'personal'} | {kind:'room', name}; move=true removes it from the current canvas list */
export async function transfer(i, target, move) {
  const p = app.state.pages[i], sameProject = target.kind === 'personal' ? !app.room : cleanRoom(target.name) === app.room;
  if (sameProject) { if (move) return toast('That is already where this canvas lives'); return duplicate(i); }
  if (move && app.state.pages.length < 2) return toast('Keep at least one canvas here');
  const c = clonePage(p, { detach: true, name: move ? p.name : p.name + ' (copy)' });
  try {
    if (target.kind === 'personal') {
      let st = null; try { st = normalizeState(JSON.parse(localStorage.getItem(PERSONAL) || 'null')); } catch {}
      st = st || defaultState(); if (st.pages.length === 1 && !st.pages[0].nodes.length) st.pages = [];
      st.pages.push(c); localStorage.setItem(PERSONAL, JSON.stringify(st));
    } else {
      const room = cleanRoom(target.name);
      const fromServer = await loadRoomFromServer(room); if (app.loadError) return toast('Could not reach that room, so nothing was copied (it would risk overwriting it).');
      let st = fromServer || loadLocal(room) || { ...defaultState(), pages: [] };
      if (st.pages.length === 1 && !st.pages[0].nodes.length) st.pages = [];
      st.pages.push(c);
      for (const id of mediaIds(c)) { const r = await idb.get('blobs', id); if (r?.blob) await uploadBlob(id, r.blob, 'blob', room); }
      localStorage.setItem(ROOM + room, JSON.stringify(st));
      if (!(await writeRoom(room, st))) toast('Saved on this device only (server unreachable)');
      try { const reg = JSON.parse(localStorage.getItem('st-rooms') || '{}'); reg[room] = reg[room] || { t: Date.now() }; localStorage.setItem('st-rooms', JSON.stringify(reg)); } catch {}
    }
  } catch (e) { return toast('Copy failed: ' + (e.message || e)); }
  if (move) { app.state.pages.splice(i, 1); app.state.current = Math.min(app.state.current, app.state.pages.length - 1); emit('state-replaced'); save(); }
  toast(move ? 'Canvas moved' : 'Canvas copied');
}
