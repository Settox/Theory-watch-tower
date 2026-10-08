// Universe view: every canvas of the project as one galaxy. Related canvases (shared words in star titles) drift together.
import { $, app, emit } from './core.js';
import * as map from './map.js';

const words = (p) => new Set(p.nodes.flatMap((n) => String(n.title || '').toLowerCase().match(/[\p{L}]{4,}/gu) || []));
const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

function layout(pages) {
  const W = pages.map(words), N = pages.length;
  const rad = pages.map((p) => 70 + 18 * Math.sqrt(p.nodes.length));
  const pos = pages.map((_, i) => { const a = i * 2.399963, r = 90 * Math.sqrt(i + 0.5) + 60; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; });
  const rel = (i, j) => { let k = 0; W[i].forEach((w) => { if (W[j].has(w)) k++; }); return k / Math.max(1, Math.min(W[i].size, W[j].size)); };
  const R = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : rel(i, j))));
  for (let it = 0; it < 160; it++) for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const dx = pos[j].x - pos[i].x, dy = pos[j].y - pos[i].y, d = Math.hypot(dx, dy) || 1, min = rad[i] + rad[j] + 40, want = min + (1 - Math.min(1, R[i][j] * 3)) * 160;
    const f = (d - want) * (d < min ? 0.2 : 0.02 + R[i][j] * 0.05), ux = dx / d, uy = dy / d;
    pos[i].x += ux * f; pos[i].y += uy * f; pos[j].x -= ux * f; pos[j].y -= uy * f;
  }
  return { pos, rad, R };
}

export function init(H) {
  const { h } = H;
  const root = h('div', { id: 'universe', hidden: true, role: 'dialog', 'aria-label': 'Universe view' }), cv = h('canvas'), tip = h('div', { id: 'uv-tip', hidden: true });
  const close = h('button', { className: 'btn', type: 'button', textContent: '✕  Close', onclick: () => hide() });
  root.append(cv, h('div', { id: 'uv-bar' }, close, h('span', { className: 'mono', textContent: 'Drag to move · wheel or pinch to zoom · click a galaxy to enter' })), tip);
  document.body.append(root);
  const c = cv.getContext('2d'), V = { x: 0, y: 0, z: 1 }; let L, pages, hover = -1, W = 0, Ht = 0, raf = 0, t0 = 0;

  const fit = () => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; L.pos.forEach((p, i) => { x0 = Math.min(x0, p.x - L.rad[i]); y0 = Math.min(y0, p.y - L.rad[i]); x1 = Math.max(x1, p.x + L.rad[i]); y1 = Math.max(y1, p.y + L.rad[i]); }); V.z = Math.min(1.4, Math.min(W / (x1 - x0 + 120), Ht / (y1 - y0 + 160))); V.x = W / 2 - ((x0 + x1) / 2) * V.z; V.y = Ht / 2 - ((y0 + y1) / 2) * V.z; };
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = root.clientWidth; Ht = root.clientHeight; cv.width = W * d; cv.height = Ht * d; c.setTransform(d, 0, 0, d, 0, 0); };
  const toW = (sx, sy) => ({ x: (sx - V.x) / V.z, y: (sy - V.y) / V.z });
  const at = (sx, sy) => { const p = toW(sx, sy); return L.pos.findIndex((q, i) => Math.hypot(p.x - q.x, p.y - q.y) < L.rad[i]); };

  function draw(t) {
    raf = 0; c.clearRect(0, 0, W, Ht); c.save(); c.translate(V.x, V.y); c.scale(V.z, V.z);
    const cs = getComputedStyle(document.documentElement), star = cs.getPropertyValue('--star').trim() || '#fff', gold = cs.getPropertyValue('--gold').trim() || '#e8c872';
    pages.forEach((p, i) => { for (let j = i + 1; j < pages.length; j++) if (L.R[i][j] > 0.08) { c.globalAlpha = Math.min(0.5, L.R[i][j]); c.strokeStyle = gold; c.setLineDash([4, 6]); c.beginPath(); c.moveTo(L.pos[i].x, L.pos[i].y); c.lineTo(L.pos[j].x, L.pos[j].y); c.stroke(); c.setLineDash([]); } });
    pages.forEach((p, i) => {
      const { x, y } = L.pos[i], r = L.rad[i], hu = hue(p.id + p.name), cur = i === app.state.current, hv = i === hover;
      const g = c.createRadialGradient(x, y, 0, x, y, r * 1.25); g.addColorStop(0, `hsla(${hu},80%,60%,${hv ? 0.4 : 0.26})`); g.addColorStop(0.6, `hsla(${hu},80%,55%,0.1)`); g.addColorStop(1, 'transparent');
      c.globalAlpha = 1; c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 1.25, 0, 7); c.fill();
      if (cur || hv) { c.strokeStyle = cur ? gold : star; c.globalAlpha = 0.7; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); }
      const ns = p.nodes; if (ns.length) {
        const x0 = Math.min(...ns.map((n) => n.x)), y0 = Math.min(...ns.map((n) => n.y)), x1 = Math.max(...ns.map((n) => n.x + n.w)), y1 = Math.max(...ns.map((n) => n.y + n.h));
        const s = (r * 1.5) / Math.max(x1 - x0, y1 - y0, 1), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, P = (n) => [x + (n.x + n.w / 2 - cx) * s, y + (n.y + n.h / 2 - cy) * s], by = Object.fromEntries(ns.map((n) => [n.id, n]));
        c.lineWidth = 0.8 / V.z + 0.3; c.strokeStyle = star; c.globalAlpha = 0.4;
        p.connections.forEach((k) => { const a = by[k.from], b = by[k.to]; if (a && b) { const [ax, ay] = P(a), [bx, by2] = P(b); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by2); c.stroke(); } });
        ns.forEach((n, k) => { const [sx, sy] = P(n); c.globalAlpha = 0.65 + 0.35 * Math.sin(t / 700 + k); c.fillStyle = n.color || star; c.beginPath(); c.arc(sx, sy, 2.4, 0, 7); c.fill(); });
      }
      c.globalAlpha = 1; c.fillStyle = star; c.font = `600 ${Math.max(13, 15 / V.z)}px Fraunces, Georgia, serif`; c.textAlign = 'center'; c.fillText(p.name, x, y + r + 20 / V.z + 4);
    });
    c.restore(); raf = requestAnimationFrame(draw);
  }
  const kick = () => { if (!raf && !root.hidden) raf = requestAnimationFrame(draw); };

  function show() {
    pages = app.state.pages; L = layout(pages); root.hidden = false; size(); fit(); kick();
  }
  function hide() { root.hidden = true; cancelAnimationFrame(raf); raf = 0; tip.hidden = true; }
  const enter = (i) => { hide(); if (i !== app.state.current) map.switchPage(i); map.fitAll(); };

  /* pan, pinch, zoom, click */
  const ptr = new Map(); let down = null, pinch = 0;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, [e.clientX, e.clientY]); down = { x: e.clientX, y: e.clientY, moved: false, vx: V.x, vy: V.y }; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (ptr.has(e.pointerId)) {
      ptr.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptr.size === 2) { const [a, b] = [...ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom((a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top, d / pinch); pinch = d; down.moved = true; }
      else if (down) { if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) down.moved = true; if (down.moved) { V.x = down.vx + e.clientX - down.x; V.y = down.vy + e.clientY - down.y; } }
    } else { const i = at(sx, sy); if (i !== hover) { hover = i; cv.style.cursor = i >= 0 ? 'pointer' : 'grab'; } }
    if (hover >= 0) { const p = pages[hover]; tip.hidden = false; tip.textContent = `${p.name} · ${p.nodes.length} stars · ${p.connections.length} links`; tip.style.left = sx + 'px'; tip.style.top = sy + 'px'; } else tip.hidden = true;
  });
  const up = (e) => { ptr.delete(e.pointerId); if (down && !down.moved && ptr.size === 0) { const r = cv.getBoundingClientRect(), i = at(e.clientX - r.left, e.clientY - r.top); if (i >= 0) enter(i); } if (!ptr.size) down = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  function zoom(sx, sy, f) { const z = Math.max(0.15, Math.min(3, V.z * f)), k = z / V.z; V.x = sx - (sx - V.x) * k; V.y = sy - (sy - V.y) * k; V.z = z; }
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoom(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !root.hidden) { hide(); e.stopPropagation(); } }, true);
  addEventListener('resize', () => { if (!root.hidden) { size(); } });

  emit('register-tool', { label: 'Universe', key: '', fn: show });
}
