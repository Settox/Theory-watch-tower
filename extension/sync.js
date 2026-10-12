// Content script, injected only on YOUR app address (after you press Connect). It copies the names of your canvases and rooms
// into the extension so the popup can offer them. It reads nothing else and sends nothing anywhere.
(() => {
  try {
    const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
    const st = read('spazio-teorie-v3');
    const pages = (st && Array.isArray(st.pages) ? st.pages : []).filter((p) => p && typeof p.id === 'string').slice(0, 200).map((p) => ({ id: p.id, name: String(p.name || 'Untitled').slice(0, 60) }));
    const rooms = new Set(Object.keys(read('st-rooms') || {}));
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('spazio-teorie-room-v3:')) rooms.add(k.slice(22)); }
    chrome.storage.local.set({ lib: { pages, rooms: [...rooms].slice(0, 100), t: Date.now() } });
  } catch { /* storage blocked: the popup keeps its manual list */ }
})();
