// Thumbnail of a canvas (page): stars, links and pen strokes as a small SVG. No innerHTML: text via textContent.
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, a = {}) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const col = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : '#e8c872');
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

export function preview(page) {
  const nodes = (page?.nodes || []).filter((n) => n && Number.isFinite(+n.x) && Number.isFinite(+n.y));
  const svg = mk('svg', { class: 'pv', role: 'img', 'aria-label': 'Map preview' });
  if (!nodes.length) { svg.setAttribute('viewBox', '0 0 320 190'); svg.append(mk('circle', { cx: 160, cy: 95, r: 3, fill: 'var(--gold)' })); const t = mk('text', { x: 160, y: 125, 'text-anchor': 'middle', class: 'pv-empty' }); t.textContent = 'empty sky'; svg.append(t); return svg; }
  const pad = 40;
  const x0 = Math.min(...nodes.map((n) => +n.x)) - pad, y0 = Math.min(...nodes.map((n) => +n.y)) - pad;
  const x1 = Math.max(...nodes.map((n) => +n.x + num(n.w, 230))) + pad, y1 = Math.max(...nodes.map((n) => +n.y + num(n.h, 160))) + pad;
  const W = Math.max(x1 - x0, 320), H = Math.max(y1 - y0, 190), u = Math.max(W, H) / 220; // u: one "thumbnail pixel" in canvas units
  svg.setAttribute('viewBox', `${x0 - (W - (x1 - x0)) / 2} ${y0 - (H - (y1 - y0)) / 2} ${W} ${H}`);
  (page.drawings || []).forEach((s) => {
    const p = (s.pts || []).filter((q) => Array.isArray(q) && q.length > 1); if (p.length < 2) return;
    svg.append(mk('path', { d: 'M' + p.map((q) => q[0] + ' ' + q[1]).join('L'), fill: 'none', stroke: col(s.color), 'stroke-width': Math.max(num(s.w, 3), u * 0.8), 'stroke-opacity': num(s.op, 1) * 0.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  });
  const by = Object.fromEntries(nodes.map((n) => [n.id, n]));
  (page.connections || []).forEach((c) => {
    const a = by[c.from], b = by[c.to]; if (!a || !b) return;
    const ax = +a.x + num(a.w, 230) / 2, ay = +a.y + num(a.h, 160) / 2, bx = +b.x + num(b.w, 230) / 2, by2 = +b.y + num(b.h, 160) / 2;
    const d = `M${ax} ${ay} Q${(ax + bx) / 2 + 2 * num(c.bx)} ${(ay + by2) / 2 + 2 * num(c.by)} ${bx} ${by2}`;
    svg.append(mk('path', { d, fill: 'none', stroke: col(c.color), 'stroke-width': u * 5, 'stroke-opacity': 0.18, 'stroke-linecap': 'round' }), mk('path', { d, fill: 'none', stroke: col(c.color), 'stroke-width': u * 1.4, 'stroke-linecap': 'round' }));
  });
  nodes.forEach((n) => {
    const w = num(n.w, 230), h = num(n.h, 160), c = col(n.color);
    svg.append(mk('rect', { x: +n.x, y: +n.y, width: w, height: h, rx: u * 6, class: n.group ? 'pv-group' : 'pv-card', stroke: c, 'stroke-width': u * 1.2 }),
      mk('circle', { cx: +n.x, cy: +n.y, r: u * 5, fill: c }), mk('circle', { cx: +n.x, cy: +n.y, r: u * 10, fill: c, opacity: 0.25 }));
    const t = mk('text', { x: +n.x + u * 9, y: +n.y + u * 17, 'font-size': u * 11, class: 'pv-title' }); t.textContent = String(n.title || '').slice(0, 26); svg.append(t);
  });
  return svg;
}
export const countOf = (page) => ({ stars: (page?.nodes || []).length, links: (page?.connections || []).length });
