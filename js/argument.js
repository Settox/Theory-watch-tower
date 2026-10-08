// Argument maps: link legend + "Argument check" (unsupported claims, tensions, isolated stars, circular dependencies).
// Direction matters: A —supports→ B means A is evidence for B; A —contradicts→ B challenges B; A —depends→ B means A needs B.
import { $, app, page, on, emit, findNode } from './core.js';
import * as map from './map.js';

export function analyse(p = page()) {
  const nodes = p.nodes, by = Object.fromEntries(nodes.map((n) => [n.id, n])), typed = p.connections.filter((c) => map.KIND[c.kind] && by[c.from] && by[c.to]);
  const inc = (id, k) => typed.filter((c) => c.to === id && c.kind === k), out = (id, k) => typed.filter((c) => c.from === id && c.kind === k);
  const inArg = new Set(typed.flatMap((c) => [c.from, c.to]));
  const supported = (id) => inc(id, 'supports').length > 0;
  const unsupported = nodes.filter((n) => inArg.has(n.id) && !supported(n.id) && !out(n.id, 'supports').length && (inc(n.id, 'contradicts').length || out(n.id, 'depends').length || inc(n.id, 'depends').length));
  const tensions = typed.filter((c) => c.kind === 'contradicts' && supported(c.from) && supported(c.to)).map((c) => [by[c.from], by[c.to]]);
  const linked = new Set(p.connections.flatMap((c) => [c.from, c.to]));
  const isolated = nodes.length >= 3 ? nodes.filter((n) => !linked.has(n.id) && !n.group) : [];
  const cycles = []; // circular 'depends' chains (DFS)
  const dep = Object.fromEntries(nodes.map((n) => [n.id, out(n.id, 'depends').map((c) => c.to)])), state = {}, stack = [];
  (function walk() {
    const go = (id) => { state[id] = 1; stack.push(id); for (const t of dep[id] || []) { if (state[t] === 1) { cycles.push(stack.slice(stack.indexOf(t)).map((x) => by[x])); } else if (!state[t]) go(t); } stack.pop(); state[id] = 2; };
    nodes.forEach((n) => { if (!state[n.id]) go(n.id); });
  })();
  const strength = nodes.filter((n) => inc(n.id, 'supports').length || inc(n.id, 'contradicts').length).map((n) => ({ n, pro: inc(n.id, 'supports').length, con: inc(n.id, 'contradicts').length }));
  return { unsupported, tensions, isolated, cycles, strength, typed: typed.length };
}

function pulse(id) { map.focusNode(id); const el = document.querySelector(`.node[data-id="${id}"]`); if (el) { el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 2400); } }

export function init(H) {
  const { h } = H;
  /* legend: only when the canvas has typed links; click to fold */
  const legend = h('div', { id: 'arg-legend', hidden: true, title: 'Link types (click to fold)' });
  $('stage').append(legend);
  legend.onclick = () => legend.classList.toggle('min');
  const drawLegend = () => {
    const used = new Set(page().connections.map((c) => c.kind).filter((k) => map.KIND[k])); legend.hidden = !used.size; legend.textContent = '';
    legend.append(h('b', { textContent: 'Links' }));
    Object.entries(map.KIND).forEach(([k, v]) => { if (!used.has(k)) return; const sw = h('i'); sw.style.borderTopColor = v.c || 'var(--star)'; sw.style.borderTopStyle = v.dash ? 'dashed' : 'solid'; legend.append(h('span', {}, sw, `${v.g} ${v.name}`)); });
  };
  let t; const later = () => { clearTimeout(t); t = setTimeout(drawLegend, 200); };
  on('changed', later); on('state-replaced', later); on('link-created', later); drawLegend();

  const panel = h('div', { className: 'arg-panel', hidden: true, role: 'dialog', 'aria-label': 'Argument check' }); document.body.append(panel);
  const item = (n, extra) => h('button', { type: 'button', className: 'arg-item', textContent: `${n.icon ? n.icon + ' ' : ''}${n.title || 'Untitled'}${extra ? '  ·  ' + extra : ''}`, onclick: () => pulse(n.id) });
  function flags(r) { // ⚠ badge on stars that need attention
    document.querySelectorAll('.node.flag').forEach((e) => e.classList.remove('flag'));
    [...r.unsupported, ...r.tensions.flat()].forEach((n) => document.querySelector(`.node[data-id="${n.id}"]`)?.classList.add('flag'));
  }
  function draw() {
    const r = analyse(); panel.textContent = ''; flags(r);
    panel.append(h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, h('b', { className: 'serif', textContent: 'Argument check' }), h('button', { className: 'btn', type: 'button', textContent: '✕', 'aria-label': 'Close', onclick: () => { panel.hidden = true; document.querySelectorAll('.node.flag').forEach((e) => e.classList.remove('flag')); } })),
      h('p', { className: 'hint', textContent: r.typed ? 'Arrow direction matters: A supports B means A is evidence for B.' : 'Give your links a type (select a link → Supports / Contradicts / Depends) and this check will start working.' }));
    const sec = (title, list, ok) => { panel.append(h('h3', { textContent: `${title} (${list.length})` })); if (!list.length) panel.append(h('div', { className: 'arg-ok', textContent: ok })); list.forEach((x) => panel.append(x)); };
    sec('Claims without support', r.unsupported.map((n) => item(n)), 'Every claim has evidence.');
    sec('Tensions to resolve', r.tensions.map(([a, b]) => h('button', { type: 'button', className: 'arg-item', textContent: `${a.title || 'Untitled'}  ⟷  ${b.title || 'Untitled'}`, onclick: () => pulse(a.id) })), 'No two well-supported ideas contradict each other.');
    sec('Circular dependencies', r.cycles.map((c) => h('button', { type: 'button', className: 'arg-item', textContent: c.map((n) => n.title || 'Untitled').join(' → ') + ' → …', onclick: () => pulse(c[0].id) })), 'No circular chains.');
    sec('Stars not connected to anything', r.isolated.map((n) => item(n)), 'Everything is connected.');
    if (r.strength.length) { panel.append(h('h3', { textContent: 'Support balance' })); r.strength.sort((a, b) => (b.pro - b.con) - (a.pro - a.con)).forEach((s) => panel.append(item(s.n, `+${s.pro} / −${s.con}`))); }
  }
  on('changed', () => { if (!panel.hidden) { clearTimeout(draw.t); draw.t = setTimeout(draw, 300); } });
  emit('register-tool', { label: 'Argument check', fn: () => { panel.hidden = !panel.hidden; if (!panel.hidden) draw(); } });
}
