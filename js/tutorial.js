// Tutorial canvas: every user always has one in their personal project (never in rooms).
// No static imports: home.js uses tutorialPage() on the homepage, where the map/core modules must not load.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#e8c872', '#7fd6ff', '#ff8fa8', '#8be3a4', '#c4a6ff', '#ffb27a'];

// [icon, title, text, kind of the link to the NEXT star]
const STEPS = [
  ['🧭', 'Start the guided tour', 'Want a hands-on walk through the real app? Open the Tools menu and choose "Start guided tour", or tap the gold "Start tour" pill at the bottom of this canvas. It takes about 2 minutes and you can stop any time with Esc.', 'relates'],
  ['👋', 'Welcome', 'This is your sky. The homepage lists your personal canvases and the rooms you joined, each with a live map preview. Follow the numbered stars: they are linked in order.', 'relates'],
  ['✦', 'Make a star', 'Double-click empty space or press N to create a star. Click its title or text to type. A star is one idea, quote or question.', 'relates'],
  ['✥', 'Move and resize', 'Drag a star by its grip (⠿) to move it. Drag the corner to resize. Arrow keys nudge the selection, and the lock button pins a star in place.', 'relates'],
  ['🔭', 'Navigate', 'Drag on empty space to marquee-select. Pan with middle-drag, two fingers or Space+drag. Scroll or pinch to zoom, F fits everything, and the minimap in the corner jumps anywhere.', 'relates'],
  ['🔗', 'Link ideas', 'Drag the round handle on the right edge of a star onto another star. Double-click a link to give it a label such as "because" or "leads to".', 'supports'],
  ['⚖', 'Argument maps', 'Click a link, then use Type in its bar to mark it supports, contradicts or depends. Run Argument check from the Tools menu to spot unsupported claims and contradictions.', 'relates'],
  ['🎨', 'Colours and glass', 'Select stars and pick a colour from the bar. Transparent mode makes a star see-through so the sky shines behind it.', 'relates'],
  ['◇', 'Shapes and icons', 'The Shape button in the selection bar gives a star a shape (circle, diamond, hexagon, star, note) and an emoji icon, so kinds of ideas read at a glance.', 'relates'],
  ['💬', 'Comments', 'The speech bubble on a star opens its comment thread. Great for questions to yourself or notes to teammates.', 'relates'],
  ['🖼', 'Images and video', 'Use the media button, drop a file, or paste an image to make a picture star. Paste a YouTube link to embed a video.', 'relates'],
  ['✎', 'Draw', 'Press P for the pen. Choose pen, highlighter or eraser, a colour and a width. Strokes belong to the canvas, so they save and sync too.', 'relates'],
  ['⌘', 'Command palette', 'Press Ctrl/⌘+K to find any command or star by name. Ctrl/⌘+Z undoes and Ctrl/⌘+Shift+Z redoes, as many steps as you need.', 'relates'],
  ['📚', 'The library', 'Press L for the library. Add books as PDF or EPUB, organise them in volumes and folders, set covers, and search across all your books.', 'depends'],
  ['🔖', 'Reading tools', 'The readers remember where you stopped. Add bookmarks and highlights, look up words in the dictionary, read side by side in split view, and use focus mode to read without distractions.', 'relates'],
  ['🔎', 'Evidence and connections', 'Turn a passage into a star with its source attached. Evidence mode shows the stars that cite a page, and cross-book connections link ideas between different books.', 'relates'],
  ['🔊', 'Read aloud and translate', 'Have any volume read to you, or translate it. Voices and translation keys are set in Settings and stay on your device.', 'relates'],
  ['🎓', 'Study mode', 'Tools > Study turns your stars into flashcards with spaced repetition. Rate each card Again, Hard, Good or Easy. Keys: Space, then 1 to 4.', 'relates'],
  ['🛤', 'Journeys', 'Tools > Journeys records the books you open and the stars you make, then replays them as a guided tour you can download and share.', 'relates'],
  ['🌌', 'Universe view', 'Tools > Universe shows all your canvases as one universe, and lets you jump into any constellation from there.', 'relates'],
  ['👥', 'Rooms', 'Create or join a room from the homepage or the people button to work together live. See who is here, assign editor or viewer roles, react to stars, follow the activity feed, share guest links and publish a read-only public canvas.', 'relates'],
  ['🎶', 'Skies and sound', 'Settings has night, day and sky themes (aurora, dawn, deep space) plus chimes and soft ambience in the "Sky & sound" block. Everything is optional.', 'relates'],
  ['🗝', 'A secret', 'There is a hidden easter egg somewhere in the sky. Try the classic arrow sequence, and see what happens.', 'relates'],
  ['💾', 'Keep it safe', 'Export or import your project as JSON, browse version history to roll back, and install this site as an app from your browser menu to use it offline. You are ready: make your own canvas!', ''],
];

/** a fresh tutorial page; ids are stable ('tut-N') */
export function tutorialPage() {
  const cols = 6, nodes = STEPS.map(([icon, title, text], i) => {
    const r = Math.floor(i / cols), c = i % cols, col = r % 2 ? cols - 1 - c : c; // snake path
    return { id: 'tut-' + (i + 1), x: 60 + col * 330, y: 60 + r * 290 + Math.round(Math.sin(i * 1.7) * 28), w: 260, h: 200, title: `${i + 1} · ${title}`, body: `<p>${esc(text)}</p>`, source: '', color: COLORS[i % COLORS.length], icon };
  });
  const connections = STEPS.slice(0, -1).map(([, , , kind], i) => ({ id: 'tut-c' + (i + 1), from: 'tut-' + (i + 1), to: 'tut-' + (i + 2), color: COLORS[i % COLORS.length], kind: kind || 'relates' }));
  return { id: 'tutorial', name: 'Tutorial', tutorial: true, nodes, connections, drawings: [] };
}

export async function init(ui) {
  const { app, on, emit, save, toast, page, $ } = await import('./core.js');
  const map = await import('./map.js');
  const mine = () => !app.room && !app.readonly;
  const idx = () => app.state.pages.findIndex((p) => p.id === 'tutorial');
  const show = () => { map.switchPage(idx(), true); try { localStorage.setItem('st-tour-seen', '1'); } catch {} };
  function ensure() { // returns true if it had to add the page
    if (!mine() || idx() >= 0) return false;
    const cur = app.state.pages[app.state.current];
    app.state.pages.unshift(tutorialPage()); app.state.current = app.state.pages.indexOf(cur);
    save(); map.renderTabs(); return true;
  }
  let seen = false; try { seen = !!localStorage.getItem('st-tour-seen'); } catch {}
  const wanted = new URLSearchParams(location.search).get('page') === 'tutorial';
  ensure();
  if (mine() && (wanted || !seen)) show();
  const guard = (fn) => () => (mine() ? fn() : toast('The tutorial lives in your personal canvases, not in rooms'));
  emit('register-tool', { label: 'Restore tutorial', fn: guard(() => { ensure(); show(); toast('Tutorial restored'); }) });
  emit('register-tool', { label: 'Reset tutorial', fn: guard(() => emit('confirm', { title: 'Reset the tutorial to its original text?', ok: () => { const i = idx(), p = tutorialPage(); if (i >= 0) app.state.pages[i] = p; else app.state.pages.unshift(p); show(); save(); emit('state-replaced'); } })) });
  on('state-replaced', () => ensure()); // e.g. after importing a project that lacks it

  /* ---------- guided tour ---------- */
  const el = (tag, cls, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); if (cls) e.className = cls; e.append(...kids); return e; };
  const vis = (e) => { if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find((b) => re.test(b.textContent + ' ' + (b.title || '')) && vis(b));
  const last = () => page().nodes.at(-1);
  const nodeEl = (n) => n && document.querySelector(`.node[data-id="${n.id}"]`);
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const menuEl = $('menu'), palEl = $('palette'), modalEl = $('modal'), libEl = $('library');
  const libOpen = () => (innerWidth > 760 ? !document.body.classList.contains('lib-closed') : libEl.classList.contains('open'));
  const findTool = (re) => { $('btnTools').click(); return [...menuEl.children].find((d) => re.test(d.textContent)); };
  const toolItem = (re) => { const it = findTool(re); menuEl.hidden = true; return it; };
  const runTool = (re) => { const it = findTool(re); it ? it.click() : (menuEl.hidden = true); };
  const need = (n) => { let i = 0; while (page().nodes.length < n) { const c = map.viewCenter(); map.addNode({ x: Math.round(c.x - 120 + i * 300), y: Math.round(c.y - 60 + i * 40), title: 'Practice star' }); i++; } map.fitAll(); };
  const colors = () => page().nodes.map((n) => n.color || '').join();
  const cmts = () => page().nodes.reduce((a, n) => a + (n.comments?.length || 0), 0);
  const toolBtn = (re) => ({ l: 'Show me', ok: () => !!toolItem(re), fn: () => runTool(re) });
  const t = (title, text, o = {}) => ({ title, text, ...o });
  const pick = () => { need(1); map.select(last().id); };
  const S = [
    t('Welcome to your sky', 'A quick, hands-on tour of the real app. Some steps ask you to try things yourself; others just explain. Skip anything with Next, and press Esc whenever you like. Practice stars you make are yours to delete.'),
    t('Make a star', 'Press this button (or N, or double-click empty space) to place a star.', { tg: '#btnAdd', base: () => page().nodes.length, done: (b) => page().nodes.length > b }),
    t('Move around', 'Drag the empty sky to pan, or zoom with scroll, pinch, or these buttons. Try it!', { tg: '#hud', base: () => JSON.stringify(map.view), done: (b) => JSON.stringify(map.view) !== b }),
    t('Link two stars', 'Drag the round handle on a star\'s right edge onto another star to link them.', { pre: () => need(2), tg: () => nodeEl(page().nodes.at(-2))?.querySelector('.node-link'), base: () => page().connections.length, done: (b) => page().connections.length > b }),
    t('Colour it', 'Pick a colour in the bar that appears when a star is selected.', { pre: pick, tg: '#ctxbar', base: colors, done: (b) => colors() !== b }),
    t('Shapes and icons', 'The Shape button in this bar gives a star a shape and an emoji icon, so you can tell kinds of ideas apart at a glance.', { pre: pick, tg: () => byText('#ctxbar button', /shape/i) || $('ctxbar'), show: { l: 'Show me', ok: () => !!byText('#ctxbar button', /shape/i), fn: () => byText('#ctxbar button', /shape/i)?.click() } }),
    t('Leave a comment', 'Open the speech bubble on a star and add a comment.', { pre: pick, tg: () => nodeEl(last())?.querySelector('.node-cmt'), base: cmts, done: (b) => cmts() > b, keep: 'modal' }),
    t('Argument maps', 'Select a link and choose its Type: supports, contradicts or depends. Then run "Argument check" from Tools to find unsupported claims.', { pre: () => { const c = page().connections.at(-1); if (c) map.selectConn(c.id); }, tg: () => byText('#ctxbar button', /type/i) || $('ctxbar'), show: toolBtn(/argument/i) }),
    t('Images and video', 'Add pictures or videos as stars with Media (or paste an image, or paste a YouTube link into a star).', { tg: '#btnMedia' }),
    t('Draw', 'Turn the pen on to draw on the sky. Pick pen, highlighter or eraser.', { tg: '#btnPen', done: () => map.pen.on, post: () => map.pen.on && map.setPen(false) }),
    t('Command palette', 'Open the palette: it finds any command or star by name. Ctrl/⌘+K works too.', { tg: '#btnK', done: () => vis(palEl) }),
    t('The Tools menu', 'Open Tools: study, journeys, universe, argument check and more live here.', { tg: '#btnTools', done: () => vis(menuEl) }),
    t('Settings', 'Open Settings.', { tg: '#btnSettings', done: () => vis(modalEl), keep: 'modal' }),
    t('Skies and sound', 'The "Sky & sound" block switches skies (aurora, dawn, deep space) and turns chimes and ambience on. All optional.', { tg: () => modalEl.querySelector('.card'), keep: 'modal' }),
    t('Open the library', 'Open the library, home of your books.', { pre: () => ui?.toggleLib?.(false), tg: '#btnLib', done: libOpen, keep: 'lib' }),
    t('Books, evidence and reading', 'Add PDFs and EPUBs. Readers remember your place, support bookmarks, highlights, a dictionary, focus mode and split view to read two books side by side. Evidence mode shows the stars citing a page, and cross-book connections link ideas across books.', { tg: '#library', keep: 'lib' }),
    t('Study mode', 'Turns your stars into flashcards with spaced repetition.', { tg: '#btnTools', show: toolBtn(/study/i) }),
    t('Journeys', 'Record the books you open and stars you make, then replay and share the path as a guided tour.', { tg: '#btnTools', show: toolBtn(/journey/i) }),
    t('Universe view', 'See all your canvases as one universe and hop between constellations.', { tg: '#btnTools', show: toolBtn(/universe/i) }),
    t('Rooms', 'Work together live: roles, reactions, an activity feed, guest links and read-only public canvases. Rooms sync through a server, so choose hard-to-guess names.', { tg: '#btnCollab' }),
    t('Search and minimap', 'Press / to search stars. The minimap jumps anywhere; F fits everything.', { tg: () => (vis($('minimap')) ? $('minimap') : $('search')) }),
    t('Install as an app', 'Use your browser\'s install option (menu, or the icon in the address bar) to run this offline like a normal app.'),
    t('One more thing', 'There is a hidden easter egg. Try the classic arrow sequence.'),
    t('You made it', 'The Tutorial canvas stays in your tabs with every feature explained. Restart this tour any time from Tools. Happy exploring!'),
  ];
  const KEY = 'st-tour';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const keep = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };
  const tgOf = (s) => (typeof s.tg === 'function' ? s.tg() : s.tg ? document.querySelector(s.tg) : null);
  let st = null, cur = 0, ctx, timer, libWas, dir = 1;
  const ring = el('div', 'tour-ring'), card = el('div', 'tour-card'), fx = el('div', 'tour-fx');
  ring.hidden = card.hidden = true;
  document.body.append(ring, card, fx);
  const active = () => !!st && !card.hidden;

  function burst() {
    const r = ring.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    import('./audio.js').then((m) => m.chime?.()).catch(() => {});
    if (reduced()) return;
    for (let i = 0; i < 16; i++) {
      const p = el('span', 'tour-p', { textContent: i % 3 ? '✦' : '·' }), a = Math.random() * 6.28, d = 40 + Math.random() * 70;
      p.style.left = cx + 'px'; p.style.top = cy + 'px'; fx.append(p);
      p.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d}px)) scale(1.3) rotate(${Math.random() * 180}deg)`, opacity: 0 }], { duration: 800 + Math.random() * 400, easing: 'ease-out' }).onfinish = () => p.remove();
    }
  }
  function cleanup(s) {
    menuEl.hidden = true; palEl.hidden = true;
    if (s?.keep !== 'modal') { modalEl.hidden = true; modalEl.textContent = ''; }
    if (s?.keep !== 'lib' && libOpen() !== !!libWas) ui?.toggleLib?.(!!libWas);
  }
  function place() {
    const s = S[cur]; if (!s) return;
    const tg = tgOf(s), ok = vis(tg), r = ok ? tg.getBoundingClientRect() : null, pad = 6;
    ring.hidden = false; ring.classList.toggle('none', !ok);
    Object.assign(ring.style, ok ? { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' } : { left: innerWidth / 2 + 'px', top: innerHeight / 2 + 'px', width: '0px', height: '0px' });
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 8; let x, y;
    if (!ok || r.height > innerHeight * 0.6 || (r.width > innerWidth * 0.7 && r.height > innerHeight * 0.3)) { x = (innerWidth - cw) / 2; y = ok ? innerHeight - ch - 16 : (innerHeight - ch) / 2; }
    else { x = r.left + r.width / 2 - cw / 2; y = r.top + r.height / 2 < innerHeight / 2 ? r.bottom + 16 : r.top - ch - 16; if (y < 56 || y + ch > innerHeight - m) y = innerHeight - ch - 16; }
    card.style.left = Math.max(m, Math.min(x, innerWidth - cw - m)) + 'px'; card.style.top = Math.max(m, Math.min(y, innerHeight - ch - m)) + 'px';
  }
  function constellation() {
    const N = S.length, W = 100, svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${W} 14`); svg.setAttribute('class', 'tour-const'); svg.setAttribute('aria-hidden', 'true');
    const pts = S.map((_, i) => [3 + (i * (W - 6)) / (N - 1), 7 + Math.sin(i * 1.3) * 4]), lit = (i) => i < (st.max || 0) || i === cur;
    let g = '';
    pts.forEach((p, i) => { if (i && lit(i) && lit(i - 1)) g += `<line x1="${pts[i - 1][0]}" y1="${pts[i - 1][1]}" x2="${p[0]}" y2="${p[1]}"/>`; });
    pts.forEach((p, i) => { g += `<circle cx="${p[0]}" cy="${p[1]}" r="${i === cur ? 1.9 : 1.1}" class="${i === cur ? 'cur' : lit(i) ? 'lit' : ''}"/>`; });
    svg.innerHTML = g; return svg; // static numeric markup only, no user text
  }
  function render() {
    const s = S[cur], lastS = cur === S.length - 1;
    card.textContent = '';
    const acts = el('div', 'tour-acts');
    if (cur) acts.append(el('button', 'btn', { textContent: 'Back', type: 'button', onclick: () => go(cur - 1, -1) }));
    if (s.show?.ok()) acts.append(el('button', 'btn', { textContent: s.show.l, type: 'button', onclick: () => { try { s.show.fn(); } catch (e) { console.error(e); } } }));
    acts.append(el('span', 'tour-sp'), el('button', 'btn' + (s.done ? '' : ' primary'), { textContent: lastS ? 'Finish' : s.done ? 'Skip step' : cur ? 'Next' : 'Start', type: 'button', onclick: () => (lastS ? end(true) : go(cur + 1)) }));
    card.append(el('div', 'tour-top', {}, el('b', 'mono', { textContent: `${cur + 1} / ${S.length}` }), el('button', 'btn tour-x', { textContent: '✕', title: 'End tour (Esc)', type: 'button', onclick: () => end() })),
      el('h3', 'serif', { textContent: s.title }), el('p', '', { textContent: s.text }), s.done ? el('p', 'tour-try mono', { textContent: '✦ Your turn: try it' }) : '', constellation(), acts);
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Guided tour');
    place();
  }
  function go(i, d = 1) {
    clearInterval(timer); S[cur]?.post?.(); cleanup(S[i]);
    if (i >= S.length || i < 0) return end(i >= S.length);
    cur = i; dir = d; st.i = cur; st.max = Math.max(st.max || 0, cur); keep(st);
    const s = S[cur];
    try { s.pre?.(); ctx = s.base?.(); } catch (e) { console.error(e); }
    if (s.done && !vis(tgOf(s))) return go(cur + dir, dir); // task target missing: skip
    render();
    timer = setInterval(() => {
      place();
      if (s.done) { let ok = false; try { ok = s.done(ctx); } catch {} if (ok) { clearInterval(timer); burst(); setTimeout(() => active() && cur === S.indexOf(s) && go(cur + 1), 900); } }
    }, 250);
  }
  function end(fin) {
    if (!active()) return; clearInterval(timer); S[cur]?.post?.(); cleanup(null);
    ring.hidden = card.hidden = true; st.i = fin ? 0 : cur; if (fin) { st.max = S.length; st.done = 1; burst(); toast('Tour complete ✦'); } keep(st); st = null;
    try { localStorage.setItem('st-tour-seen', '1'); } catch {} sync();
  }
  function start(fresh) {
    if (!mine()) return toast('The tour runs in your personal canvases, not in rooms or read-only views');
    const o = load(); st = fresh || o.done ? { i: 0, max: 0 } : { i: o.i || 0, max: o.max || 0 };
    offer.hidden = true; try { localStorage.setItem('st-tour-offer', '1'); } catch {}
    if (page().id === 'tutorial') { const j = app.state.pages.findIndex((p) => p.id !== 'tutorial'); j >= 0 ? map.switchPage(j) : map.addPage(); }
    libWas = libOpen(); card.hidden = false; go(Math.min(st.i, S.length - 1)); sync();
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && active() && !vis(modalEl) && !vis(palEl) && !vis(menuEl)) end(); }, true);
  addEventListener('resize', () => active() && place());

  // tools, floating pill (only on the Tutorial canvas) and the one-time offer
  emit('register-tool', { label: 'Start guided tour', fn: () => start() });
  emit('register-tool', { label: 'Restart tour', fn: () => start(true) });
  const pill = el('button', 'btn primary tour-pill', { textContent: '✦ Start tour', type: 'button', onclick: () => start() }); pill.hidden = true;
  const offer = el('div', 'tour-offer'); offer.hidden = true;
  offer.append(el('b', 'serif', { textContent: 'New here?' }), el('span', '', { textContent: 'Take the 2-minute tour.' }),
    el('button', 'btn', { textContent: 'Not now', type: 'button', onclick: () => { offer.hidden = true; } }), el('button', 'btn primary', { textContent: 'Start', type: 'button', onclick: () => start() }));
  document.body.append(pill, offer);
  function sync() { pill.hidden = !(mine() && page()?.id === 'tutorial' && !active()); }
  setInterval(sync, 700);
  let offered = false; try { offered = !!localStorage.getItem('st-tour-offer') || !!localStorage.getItem(KEY); } catch {}
  if (mine() && !offered) setTimeout(() => { if (!active()) { offer.hidden = false; try { localStorage.setItem('st-tour-offer', '1'); } catch {} setTimeout(() => (offer.hidden = true), 20000); } }, 2500);
}
