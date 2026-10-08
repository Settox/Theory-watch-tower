// Study mode: spaced repetition (SM-2-like) over stars. Progress is per user in localStorage, never synced.
import { app, page, on, emit, toast, sanitize } from './core.js';

const D = 864e5, NEW_PER_SESSION = 10;
/** SM-2-like step. q: 0 again, 1 hard, 2 good, 3 easy. Pure: returns a new record. */
export function schedule(rec, q, now = Date.now()) {
  const r = { int: 0, ease: 2.5, reps: 0, ...rec };
  if (q === 0) { r.reps = 0; r.int = 0; r.due = now + 6e5; r.ease = Math.max(1.3, r.ease - 0.2); return r; }
  r.int = r.reps === 0 ? (q === 3 ? 4 : 1) : r.reps === 1 ? [0, 2, 3, 6][q] : Math.max(r.int + 1, Math.round(r.int * (q === 1 ? 1.2 : q === 2 ? r.ease : r.ease * 1.3)));
  r.ease = Math.max(1.3, r.ease + (q === 1 ? -0.15 : q === 3 ? 0.15 : 0));
  r.reps++; r.due = now + r.int * D;
  return r;
}
export function selfTest() {
  const t = 1e12;
  let r = schedule({}, 0, t); console.assert(r.reps === 0 && r.due - t < 36e5, 'again is soon');
  r = schedule({}, 2, t); console.assert(r.int === 1 && r.reps === 1, 'first good = 1d');
  r = schedule(r, 2, t); console.assert(r.int === 3, 'second good = 3d');
  r = schedule(r, 2, t); console.assert(r.int === Math.round(3 * 2.5), 'then x ease');
  console.assert(schedule(r, 3, t).int > schedule(r, 2, t).int && schedule(r, 1, t).int < schedule(r, 2, t).int, 'easy > good > hard');
  for (let i = 0; i < 20; i++) r = schedule(r, 0, t);
  console.assert(r.ease === 1.3, 'ease floor');
  console.log('study selftest done');
}
if (location.hash === '#selftest') selfTest();

const key = () => 'st-srs:' + (app.room || 'personal');
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const plain = (html) => new DOMParser().parseFromString(sanitize(String(html || '')).replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n'), 'text/html').body.textContent.trim();
const srcLabel = (s) => !s ? '' : typeof s === 'string' ? s : `${s.volumeName || s.label || 'Volume'}${s.page ? ' · p.' + s.page : ''}${s.chapter ? ' · ' + s.chapter : ''}`;
const cardsOf = (scope) => (scope === 'all' ? app.state.pages : [page()]).flatMap((p) => p.nodes.filter((n) => !n.group && (n.title || '').trim()).map((n) => ({ id: n.id, title: n.title.trim(), icon: n.icon || '', text: plain(n.body), src: srcLabel(n.source) })));
const dueCount = () => { const recs = load(key(), {}), now = Date.now(); return cardsOf('all').filter((c) => recs[c.id] && !recs[c.id].susp && recs[c.id].due <= now).length; };
const day = (t = Date.now()) => new Date(t).toLocaleDateString('sv');
function bumpStreak() {
  const s = load('st-streak', { last: '', days: 0 });
  if (s.last === day()) return;
  s.days = s.last === day(Date.now() - D) ? s.days + 1 : 1; s.last = day(); store('st-streak', s);
}
const streakNow = () => { const s = load('st-streak', { last: '', days: 0 }); return s.last === day() || s.last === day(Date.now() - D) ? s.days : 0; };

export function init({ h, btn }) {
  const tool = { label: 'Study', key: '', fn: () => open() };
  emit('register-tool', tool);
  const badge = () => { const n = dueCount(); tool.label = n ? `Study (${n} due)` : 'Study'; };
  badge(); on('state-replaced', badge); on('changed', () => { clearTimeout(badge.t); badge.t = setTimeout(badge, 1500); });

  let ov, off;
  const close = () => { ov?.remove(); ov = null; removeEventListener('keydown', off, true); badge(); };
  function open() {
    close(); ov = h('div', { className: 'study-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Study' }); document.body.append(ov);
    off = (e) => { if (!ov) return; if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (ov.onkey && ov.onkey(e)) { e.preventDefault(); e.stopPropagation(); } };
    addEventListener('keydown', off, true); setup();
  }
  function setup() {
    ov.textContent = ''; ov.onkey = null;
    const prefs = load('st-study-prefs', { scope: 'page', reverse: false });
    const info = h('p', { className: 'mono' });
    const scope = h('select', {}, h('option', { value: 'page', textContent: 'This canvas' }), h('option', { value: 'all', textContent: 'All canvases' }));
    scope.value = prefs.scope;
    const rev = h('input', { type: 'checkbox', checked: prefs.reverse });
    const recs = load(key(), {});
    const refresh = () => { const cs = cardsOf(scope.value), now = Date.now(), live = cs.filter((c) => !recs[c.id]?.susp); info.textContent = `${live.filter((c) => recs[c.id] && recs[c.id].due <= now).length} due · ${Math.min(NEW_PER_SESSION, live.filter((c) => !recs[c.id]).length)} new today · ${cs.length - live.length} suspended`; };
    scope.onchange = refresh; refresh();
    const susp = Object.values(recs).filter((r) => r.susp).length;
    const go = () => { store('st-study-prefs', { scope: scope.value, reverse: rev.checked }); session(scope.value, rev.checked); };
    ov.append(h('div', { className: 'study-card' }, h('h2', { className: 'serif', textContent: 'Study' }),
      h('p', { className: 'hint', textContent: 'Every star becomes a flashcard: title on the front, text on the back. Progress stays on this device and is not synced.' }),
      h('label', { textContent: 'Cards from' }, scope),
      h('label', { style: 'display:flex;gap:10px;align-items:center' }, rev, h('span', { textContent: 'Reverse cards (text first, guess the title)' })), info,
      h('p', { className: 'mono', textContent: `Streak: ${streakNow()} day${streakNow() === 1 ? '' : 's'}` }),
      h('div', { className: 'study-row' }, susp ? btn(`Unsuspend all (${susp})`, () => { Object.values(recs).forEach((r) => delete r.susp); store(key(), recs); setup(); }) : '', btn('Close', close), btn('Start', go, 'primary'))));
  }
  function session(scope, reverse) {
    const recs = load(key(), {}), now = Date.now(), all = cardsOf(scope).filter((c) => !recs[c.id]?.susp);
    const due = all.filter((c) => recs[c.id] && recs[c.id].due <= now).sort(() => Math.random() - 0.5);
    const queue = [...due, ...all.filter((c) => !recs[c.id]).slice(0, NEW_PER_SESSION)], tally = [0, 0, 0, 0], t0 = Date.now(); let total = queue.length, done = 0, shown = false;
    if (!total) { ov.textContent = ''; ov.append(h('div', { className: 'study-card' }, h('h2', { className: 'serif', textContent: 'All caught up' }), h('p', { className: 'hint', textContent: 'Nothing due right now. Add stars or come back later.' }), h('div', { className: 'study-row' }, btn('Back', setup), btn('Close', close, 'primary')))); return; }
    const bar = h('i'), cnt = h('span', { className: 'mono' }), front = h('div', { className: 'study-front' }), back = h('div', { className: 'study-back' }), src = h('div', { className: 'study-src mono' });
    const show = h('button', { className: 'btn primary', type: 'button', textContent: 'Show answer (Space)', onclick: () => reveal() });
    const rateRow = h('div', { className: 'study-row study-rates', hidden: true }, ...['Again', 'Hard', 'Good', 'Easy'].map((l, q) => h('button', { className: 'btn r' + q, type: 'button', textContent: `${l} (${q + 1})`, onclick: () => rate(q) })));
    const sus = h('button', { className: 'btn', type: 'button', textContent: 'Suspend this star', title: 'Hide this star from study', onclick: () => { const c = queue.shift(); recs[c.id] = { ...recs[c.id], susp: 1 }; store(key(), recs); total--; toast('Suspended'); next(); } });
    const card = h('div', { className: 'study-card study-flash', tabIndex: 0 }, front, back, src);
    ov.textContent = ''; ov.append(h('div', { className: 'study-top' }, btn('✕', close), h('div', { className: 'study-bar' }, bar), cnt), card, h('div', { className: 'study-row' }, show, rateRow), h('div', { className: 'study-row' }, sus));
    function reveal() { if (shown) return; shown = true; card.classList.add('shown'); show.hidden = true; rateRow.hidden = false; }
    function rate(q) {
      if (!shown) return; const c = queue.shift(); tally[q]++;
      recs[c.id] = schedule(recs[c.id], q); store(key(), recs); bumpStreak();
      if (q === 0) queue.push(c); else done++;
      next();
    }
    function next() {
      bar.style.width = (total ? (done / total) * 100 : 100) + '%'; cnt.textContent = `${done}/${total}`;
      if (!queue.length) return summary();
      const c = queue[0], ic = c.icon ? c.icon + ' ' : '';
      shown = false; card.classList.remove('shown'); show.hidden = false; rateRow.hidden = true;
      front.textContent = reverse ? c.text || '(no text)' : ic + c.title;
      back.textContent = reverse ? ic + c.title : c.text || '(this star has no text yet)'; src.textContent = c.src ? 'Source: ' + c.src : '';
    }
    function summary() {
      const n = tally.reduce((a, b) => a + b, 0), s = streakNow();
      ov.textContent = ''; ov.onkey = null;
      ov.append(h('div', { className: 'study-card' }, h('h2', { className: 'serif', textContent: 'Session complete' }),
        h('p', { textContent: `${n} reviews in ${Math.max(1, Math.round((Date.now() - t0) / 6e4))} min · Again ${tally[0]} · Hard ${tally[1]} · Good ${tally[2]} · Easy ${tally[3]}` }),
        h('p', { className: 'mono', textContent: `Streak: ${s} day${s === 1 ? '' : 's'}` }), h('div', { className: 'study-row' }, btn('Back', setup), btn('Done', close, 'primary'))));
    }
    ov.onkey = (e) => { if (e.key === ' ') { reveal(); return true; } if (/^[1-4]$/.test(e.key)) { rate(+e.key - 1); return true; } };
    let x0 = null; // swipe: right = Good, left = Again
    card.onpointerdown = (e) => { x0 = e.clientX; };
    card.onpointerup = (e) => { const dx = e.clientX - x0; x0 = null; if (!shown) return reveal(); if (dx > 90) rate(2); else if (dx < -90) rate(0); };
    next();
  }
}
