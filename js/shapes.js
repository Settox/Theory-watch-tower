// Star shapes + icons: the picker popover opened from the selection bar's "Shape" button.
export const SHAPES = ['rounded', 'circle', 'diamond', 'hex', 'star', 'note'];
const LABEL = { rounded: 'Card', circle: 'Circle', diamond: 'Diamond', hex: 'Hexagon', star: 'Star', note: 'Note' };
const ICONS = [
  ['Ideas', '💡 🧠 ✨ 🔮 🎯 ❓ ❗ 🧩'], ['Science', '🔬 🧪 ⚛️ 🧬 🔭 🪐 🌌 ☄️'], ['Books', '📖 📚 📜 🖋️ 🔖 🏛️ 🗝️ ⚖️'],
  ['People', '👤 👥 🗣️ 🎓 👑 🕵️ 🧙 🤖'], ['Marks', '✅ ⚠️ 🚩 ❤️ ⭐ 🔥 🌱 ⏳'],
].map(([t, s]) => [t, s.split(' ')]);

export function openShapePicker(nodes, anchor, apply) {
  document.querySelector('.shape-pop')?.remove();
  const pop = document.createElement('div'); pop.className = 'shape-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Shape and icon');
  const set = (k, v) => { nodes.forEach((n) => { if (v) n[k] = v; else delete n[k]; }); apply(); draw(); };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function draw() {
    pop.textContent = '';
    const cur = nodes[0] || {}, shp = SHAPES.includes(cur.shape) ? cur.shape : 'rounded';
    const row = el('div', 'sp-row');
    SHAPES.forEach((s) => { const b = el('button', 'sp-shape' + (shp === s ? ' on' : '')); b.type = 'button'; b.title = LABEL[s]; b.setAttribute('aria-label', LABEL[s]); b.append(Object.assign(el('i'), { className: 'sp-ico shp-' + s })); b.onclick = () => set('shape', s === 'rounded' ? null : s); row.append(b); });
    pop.append(el('div', 'mono', 'Shape'), row, el('div', 'mono', 'Icon'));
    ICONS.forEach(([t, list]) => { const r = el('div', 'sp-row'); list.forEach((e) => { const b = el('button', 'sp-emoji' + (cur.icon === e ? ' on' : ''), e); b.type = 'button'; b.title = t; b.onclick = () => set('icon', cur.icon === e ? null : e); r.append(b); }); pop.append(r); });
    const free = el('input'); free.placeholder = 'Type any emoji or letters (max 8)'; free.maxLength = 8; free.value = cur.icon || ''; free.onchange = () => set('icon', free.value.trim() || null);
    const none = el('button', 'btn', 'No icon'); none.type = 'button'; none.onclick = () => { free.value = ''; set('icon', null); };
    const done = el('button', 'btn primary', 'Done'); done.type = 'button'; done.onclick = () => pop.remove();
    pop.append(free, el('div', 'sp-row', ''), none, done);
  }
  draw(); document.body.append(pop);
  const r = anchor.getBoundingClientRect(), w = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(innerWidth - w.width - 8, r.left)) + 'px'; pop.style.top = Math.max(8, r.top - w.height - 8) + 'px';
  const off = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); removeEventListener('pointerdown', off, true); } };
  setTimeout(() => addEventListener('pointerdown', off, true), 0);
}
