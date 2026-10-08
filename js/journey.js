// Reading journeys: record what you open/make, replay as a guided tour, share as .json (journeys also live in state, so they travel with published canvases).
import { app, page, on, emit, save, toast, uid, download } from './core.js';
import * as map from './map.js';

const TYPES = ['open-volume', 'page', 'star', 'link', 'highlight', 'canvas'], MAX = 500;
const s200 = (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined);
const n9 = (v) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : undefined);
const clean = (d) => { // untrusted step -> safe step
  if (!d || !TYPES.includes(d.type)) return null;
  const s = { t: n9(d.t) ?? Date.now(), type: d.type, volumeId: s200(d.volumeId), volumeName: s200(d.volumeName), page: n9(d.page), cfi: s200(d.cfi), stype: ['text', 'pdf', 'epub'].includes(d.stype) ? d.stype : undefined, nodeId: s200(d.nodeId), title: s200(d.title), canvasId: s200(d.canvasId), label: s200(d.label) };
  Object.keys(s).forEach((k) => s[k] === undefined && delete s[k]);
  s.label = s.label || label(s); return s;
};
function label(s) {
  const v = s.volumeName || 'a volume', p = s.page ? ` p.${s.page}` : '';
  return { 'open-volume': `Open “${v}”`, page: `Read “${v}”${p}`, highlight: `Highlight in “${v}”${p}`, star: `Star “${s.title || ''}”`, link: `Link: ${s.title || 'stars'}`, canvas: `Canvas “${s.title || ''}”` }[s.type];
}
export function init({ h, btn, openModal }) {
  const list = () => (app.state.journeys = Array.isArray(app.state.journeys) ? app.state.journeys : []);
  let rec = null, ui = null, known = new Set(), pid = null;
  const name = (id) => page().nodes.find((n) => n.id === id)?.title || 'star';

  /* ---- record ---- */
  const push = (d) => { if (rec && rec.steps.length < MAX) { const s = clean({ t: Date.now(), ...d }); if (s) { rec.steps.push(s); ui.cnt.textContent = rec.steps.length + ' steps'; } } };
  const diff = () => {
    if (!rec) return; const p = page();
    if (p.id !== pid) { pid = p.id; known = new Set(p.nodes.map((n) => n.id)); push({ type: 'canvas', canvasId: p.id, title: p.name }); return; }
    p.nodes.forEach((n) => { if (!known.has(n.id)) { known.add(n.id); push({ type: 'star', canvasId: p.id, nodeId: n.id, title: n.title }); } });
  };
  on('journey-event', (d) => d && push(d));
  on('link-created', ({ from, to }) => push({ type: 'link', canvasId: page().id, nodeId: from, title: `${name(from)} → ${name(to)}` }));
  on('changed', diff); on('state-replaced', () => { pid = null; });
  setInterval(diff, 900);
  function start() {
    if (app.readonly) return toast('Read-only canvas: you can replay journeys but not record');
    if (rec) return;
    rec = { id: uid(), name: '', created: Date.now(), steps: [] }; pid = page().id; known = new Set(page().nodes.map((n) => n.id));
    ui = { cnt: h('span') };
    push({ type: 'canvas', canvasId: pid, title: page().name });
    ui.el = h('div', { className: 'jr-rec' }, h('b', { textContent: '●' }), h('span', { textContent: 'Recording' }), ui.cnt, btn('Stop', stop, 'primary'));
    document.body.append(ui.el); toast('Recording your journey: open books, add stars, link ideas');
  }
  function stop() {
    const r = rec; rec = null; ui?.el.remove(); ui = null; if (!r) return;
    if (r.steps.length < 2) return toast('Nothing recorded');
    emit('prompt', { title: 'Name this journey', value: 'Journey ' + (list().length + 1), ok: (v) => { r.name = (v.trim() || 'Journey').slice(0, 80); list().push(r); save(); toast('Journey saved'); } });
  }

  /* ---- replay ---- */
  let tour = null;
  const goto = (s) => {
    const i = app.state.pages.findIndex((p) => p.id === s.canvasId);
    if (i >= 0) map.switchPage(i);
    if (s.nodeId && page().nodes.some((n) => n.id === s.nodeId)) map.focusNode(s.nodeId);
    if (s.volumeId && ['open-volume', 'page', 'highlight'].includes(s.type)) emit('open-source', { type: s.stype || (s.cfi ? 'epub' : 'pdf'), volumeId: s.volumeId, volumeName: s.volumeName, page: s.page, cfi: s.cfi });
  };
  function play(j) {
    endTour();
    const steps = j.steps; if (!steps.length) return;
    let i = 0, timer = null;
    const cap = h('div', { className: 'jr-cap' }), strip = h('div', { className: 'jr-strip' }, ...steps.map((_, k) => h('i', { onclick: () => show(k), title: 'Step ' + (k + 1) })));
    const auto = btn('▶ Auto', () => { if (timer) { clearInterval(timer); timer = null; auto.textContent = '▶ Auto'; } else { auto.textContent = '❚❚ Pause'; timer = setInterval(() => (i < steps.length - 1 ? show(i + 1) : (clearInterval(timer), timer = null, auto.textContent = '▶ Auto')), 4000); } });
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); endTour(); } else if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); };
    const el = h('div', { className: 'jr-bar', role: 'region', 'aria-label': 'Journey: ' + j.name }, h('div', { className: 'mono', textContent: j.name }), cap, strip, h('div', { className: 'study-row' }, btn('◀ Prev', () => show(i - 1)), auto, btn('Next ▶', () => show(i + 1)), btn('End', endTour)));
    function show(k) { i = Math.max(0, Math.min(steps.length - 1, k)); cap.textContent = `${i + 1}/${steps.length} · ${steps[i].label}`; [...strip.children].forEach((c, q) => c.classList.toggle('on', q <= i)); goto(steps[i]); }
    addEventListener('keydown', key, true); document.body.append(el);
    tour = () => { clearInterval(timer); removeEventListener('keydown', key, true); el.remove(); }; show(0);
  }
  const endTour = () => { tour?.(); tour = null; };

  /* ---- share ---- */
  const exportJ = (j) => download((j.name || 'journey').replace(/[^\w-]+/g, '_') + '.journey.json', new Blob([JSON.stringify({ format: 'forbidden-library-journey', v: 1, name: j.name, steps: j.steps }, null, 1)], { type: 'application/json' }));
  async function importJ(f) {
    try {
      const d = JSON.parse(await f.text()); if (!d || typeof d.name !== 'string' || !Array.isArray(d.steps)) throw 0;
      const steps = d.steps.slice(0, MAX).map(clean).filter(Boolean); if (!steps.length) throw 0;
      list().push({ id: uid(), name: d.name.slice(0, 80) || 'Imported', created: Date.now(), steps }); save(); toast(`Imported “${d.name.slice(0, 40)}” (${steps.length} steps)`); modal();
    } catch { toast('That is not a valid journey file'); }
  }

  /* ---- manager ---- */
  let closeM;
  function modal() {
    closeM?.();
    closeM = openModal((card, close) => {
      const ro = app.readonly, js = list();
      card.append(h('h2', { className: 'serif', textContent: 'Journeys' }),
        h('p', { className: 'hint', textContent: 'Record a path through your books and canvas, then replay it as a guided tour. Journeys are stored with the project, so they travel with published canvases and rooms. You can also download one as a file.' }),
        ...(js.length ? js.map((j) => h('div', { className: 'jr-item' }, h('span', { textContent: `${j.name} · ${j.steps.length} steps` }),
          h('span', { className: 'study-row' }, btn('Play', () => { close(); play(j); }, 'primary'), btn('Download', () => exportJ(j)),
            ro ? '' : btn('Rename', () => emit('prompt', { title: 'Rename journey', value: j.name, ok: (v) => { j.name = v.trim().slice(0, 80) || j.name; save(); modal(); } })),
            ro ? '' : btn('Delete', () => emit('confirm', { title: `Delete “${j.name}”?`, ok: () => { app.state.journeys = list().filter((x) => x !== j); save(); modal(); } })))))
          : [h('p', { className: 'hint', textContent: 'No journeys yet.' })]),
        h('div', { className: 'study-row' }, ro ? '' : btn('Import…', () => { const i = h('input', { type: 'file', accept: '.json,application/json' }); i.onchange = () => i.files[0] && importJ(i.files[0]); i.click(); }),
          ro ? '' : btn(rec ? 'Stop recording' : '● Record new', () => { close(); rec ? stop() : start(); }), btn('Close', close)));
    });
  }
  emit('register-tool', { label: 'Journeys', fn: modal });
}
