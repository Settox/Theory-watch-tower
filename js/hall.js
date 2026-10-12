// The Hall: a circular library drawn with stars and lines, the homepage background behind the doorway. Galleries ring the wall in
// tiers of real-looking books (spines of every width, height and colour, some leaning), with pillars and balconies.
// Nothing spins: the camera stands still, with a slight lean toward the pointer.
// Subaru and Echidna at their tea table (constellation line-art) sit in the hall: they lean with the camera, and the dust and stars drift in front of them.
// (An optional `frame` element would clip the scene to a doorway's opening; the page does not use it.)
import { NODES, ASPECT } from './tea.js';

export function hall(canvas, frame) {
  const ctx = canvas.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2, DEG = Math.PI / 180, rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ss = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TIERS = [-0.42, -0.14, 0.14, 0.42, 0.7], SHELF = 0.27, ROWS = 3, ROWH = SHELF / ROWS, FLOOR = -0.45, RIM = 1.02;
  const D = 0.9;                       // the camera stands this far behind the centre of the room, so the wall curves toward you
  const SPAN = 80 * DEG;
  const HUES = [350, 22, 38, 140, 175, 205, 268, 12, 48]; // burgundy, rust, ochre, green, teal, blue, violet, red, gold
  let SCR = 1, W = 0, H = 0, F = 0, cx = 0, cy = 0, cam = 0, camTo = 0, raf = 0, last = 0, running = false;
  let wall = [], dust = [], glow = null;
  const tea = new Image(); tea.src = 'img/tea.webp'; tea.onload = () => { if (running && reduce) draw(0, day()); };
  const phase = NODES.map((_, i) => (i * 2.399963) % TAU);  const day = () => document.documentElement.dataset.theme === 'day';

  const P = (X, Y, Z) => { Z = Math.max(0.2, Z); return { x: cx + (F * (X - cam)) / Z, y: cy - (F * Y) / Z }; };
  const C = (a, y, rad = 1) => P(rad * Math.sin(a), y, D + rad * Math.cos(a)); // a point on the round wall
  const rowY = (t, r) => TIERS[t] + 0.02 + r * ROWH;
  const tint = (hue, l) => ({ fn: `hsl(${hue},45%,${l}%)`, en: `hsl(${hue},60%,${l + 24}%)`, fd: `hsl(${hue},40%,${l + 14}%)`, ed: `hsl(${hue},45%,${l - 12}%)` });

  let FX = 0, FY = 0, FW = 0, FH = 0;
  function fit() { // size the hall to the door's opening (or to the whole window when there is no frame)
    let w = innerWidth, h = innerHeight, ox = 0, oy = 0;
    if (frame) { const r = frame.getBoundingClientRect(), k = r.width / 600; if (r.width > 20) { w = 368 * k; h = 664 * k; ox = r.left + 116 * k; oy = r.top + 116 * k; } }
    FX = ox; FY = oy; FW = w; FH = h;
    if (w !== W || h !== H) { W = w; H = h; F = Math.max(H * 0.9, W * 0.5); cx = W / 2; cy = H * 0.46; }
  }
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); SCR = dpr;
    fit();
  }
  function seed() {
    // the round wall: five tiers of shelves, books in runs with empty stretches between
    wall = TIERS.map((_, t) => Array.from({ length: ROWS }, () => {
      const row = []; let a = -SPAN + rnd(0, 0.05), run = 0;
      while (a < SPAN) {
        const w = rnd(0.0095, 0.021);
        if (run <= 0) { a += rnd(0.04, 0.2); run = 4 + ((Math.random() * 18) | 0); continue; } // an empty stretch of shelf, then a run of books
        run--;
        row.push({ a, w, h: ROWH * rnd(0.66, 0.93), lean: Math.random() < 0.1 ? rnd(-0.012, 0.012) : 0, band: Math.random() < 0.65, out: 0, hide: false, ...tint(HUES[(Math.random() * HUES.length) | 0], rnd(27, 40)) });
        a += w + 0.0015;
      }
      return row;
    }));
    dust = Array.from({ length: 34 }, () => ({ X: rnd(-0.8, 0.8), Y: rnd(-0.4, 0.9), Z: rnd(D - 0.3, D + 1.0), ph: rnd(0, TAU) }));
    const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'), r = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    r.addColorStop(0, 'rgba(255,214,140,1)'); r.addColorStop(0.35, 'rgba(255,160,70,.35)'); r.addColorStop(1, 'rgba(255,120,30,0)'); g.fillStyle = r; g.fillRect(0, 0, 96, 96); glow = c;
  }

  /* ---------- drawing ---------- */
  function quad(p0, p1, p2, p3, b, light, edge) {
    if ((p0.x < -40 && p1.x < -40) || (p0.x > W + 40 && p1.x > W + 40)) return null;
    ctx.fillStyle = light ? b.fd : b.fn;
    const w = Math.abs(p1.x - p0.x); if (w < 0.8) { ctx.fillRect(p0.x, p3.y, 1, p0.y - p3.y); return null; }
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.fill();
    if (edge) { ctx.strokeStyle = light ? b.ed : b.en; ctx.lineWidth = 0.8; ctx.stroke(); }
    return w;
  }
  function wallBook(b, t, r, light) {
    const rad = 1 - 0.09 * b.out, y0 = rowY(t, r), a0 = b.a, a1 = b.a + b.w;
    const p0 = C(a0, y0, rad), p1 = C(a1, y0, rad), p2 = C(a1 + b.lean, y0 + b.h, rad), p3 = C(a0 + b.lean, y0 + b.h, rad);
    const w = quad(p0, p1, p2, p3, b, light, true); if (w === null) return;
    if (b.band) { const a = C(a0 + b.lean * 0.7, y0 + b.h * 0.7, rad), c = C(a1 + b.lean * 0.7, y0 + b.h * 0.7, rad); ctx.strokeStyle = 'hsla(44,80%,62%,.75)'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
    if (w > 3) { ctx.fillStyle = 'hsla(44,90%,72%,.9)'; ctx.fillRect(p3.x - 0.8, p3.y - 0.8, 1.6, 1.6); ctx.fillRect(p2.x - 0.8, p2.y - 0.8, 1.6, 1.6); } // a star on each top corner
  }

  function draw(tm, light) {
    ctx.setTransform(SCR, 0, 0, SCR, 0, 0); ctx.clearRect(0, 0, innerWidth, innerHeight);
    fit(); if (FW < 20) return;
    ctx.save(); ctx.translate(FX, FY);
    if (frame) { // clip to the arch: straight sides, round top
      ctx.beginPath(); ctx.moveTo(0, FH); ctx.lineTo(0, FW / 2); ctx.arc(FW / 2, FW / 2, FW / 2, Math.PI, 0); ctx.lineTo(FW, FH); ctx.closePath(); ctx.clip();
      ctx.fillStyle = 'rgba(8,10,26,.9)'; ctx.fillRect(0, 0, FW, FH); // the library is dim and warm, the night sky does not show through
    }
    const line = (a, b, col, w, al = 1) => { ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    const arc = (y, a0, a1, rad, col, w, al) => { ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); for (let a = a0, i = 0; a <= a1; a += 0.03, i++) { const p = C(a, y, rad); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } ctx.stroke(); };
    const wood = light ? 'hsl(28,45%,35%)' : 'hsl(30,55%,46%)', edge = light ? 'hsl(32,60%,30%)' : 'hsl(38,70%,58%)', gold = 'hsl(44,90%,70%)';
    // warm lamp-light across the far wall
    const g = ctx.createRadialGradient(cx, cy - F * 0.1, 0, cx, cy - F * 0.1, Math.max(W, H) * 0.7);
    g.addColorStop(0, light ? 'rgba(255,170,70,.16)' : 'rgba(255,150,50,.13)'); g.addColorStop(1, 'rgba(255,120,30,0)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // the round wall: balconies, books, pillars
    TIERS.forEach((y, t) => arc(y, -SPAN, SPAN, 1, wood, t ? 1.6 : 1.8, 0.85));
    arc(RIM, -SPAN, SPAN, 1, wood, 1.4, 0.7);
    wall.forEach((rows, t) => rows.forEach((row, r) => row.forEach((b) => { if (b.hide) return; ctx.globalAlpha = light ? 0.78 : 0.6; wallBook(b, t, r, light); })));
    for (let a = -75 * DEG; a <= 75.1 * DEG; a += 15 * DEG) {
      line(C(a, TIERS[0] - 0.03), C(a, RIM), wood, 3.4, 0.9);
      TIERS.forEach((y) => { const p = C(a, y); ctx.globalAlpha = 0.9; ctx.fillStyle = gold; ctx.fillRect(p.x - 1.3, p.y - 1.3, 2.6, 2.6); });
      const q = C(a, RIM - 0.02), s = (F * 0.12) / (D + Math.cos(a)); ctx.globalAlpha = 0.65; ctx.drawImage(glow, q.x - s, q.y - s, s * 2, s * 2); // lamp on each pillar
    }
    // floor: pale gold rings and spokes, a dais in the middle
    [0.4, 0.62, 0.84, 0.99].forEach((r, i) => { ctx.globalAlpha = 0.28 - i * 0.04; ctx.strokeStyle = edge; ctx.lineWidth = 1.1; ctx.beginPath(); for (let a = -2.1, k = 0; a <= 2.1; a += 0.05, k++) { const p = P(r * Math.sin(a), FLOOR, D + r * Math.cos(a)); k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); } ctx.stroke(); });
    for (let a = -75 * DEG; a <= 75.1 * DEG; a += 15 * DEG) line(P(0.4 * Math.sin(a), FLOOR, D + 0.4 * Math.cos(a)), P(0.99 * Math.sin(a), FLOOR, D + 0.99 * Math.cos(a)), edge, 0.7, 0.16);

    // keep the doorway and its words readable: thin the hall out in the middle of the page
    ctx.globalCompositeOperation = 'destination-out';
    const m = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, Math.min(W * 0.8, H * 0.74));
    m.addColorStop(0, 'rgba(0,0,0,.8)'); m.addColorStop(0.6, 'rgba(0,0,0,.5)'); m.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = m; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // the tea party: leans with the camera, its nodes twinkle, and the dust below drifts in front of it
    if (document.body.dataset.door === 'off' && tea.complete && tea.naturalWidth) {
      const ih = Math.min(H * 0.594, W * 0.432), iw = ih * ASPECT, x0 = (W - iw) / 2 - (F * cam) / (D + 0.15), y0 = H - ih, r0 = Math.max(2, iw / 360);
      ctx.globalAlpha = 0.9; ctx.drawImage(tea, x0, y0, iw, ih);
      ctx.globalCompositeOperation = 'lighter';
      NODES.forEach(([nx, ny], i) => {
        const k = reduce ? 0.7 : 0.5 + 0.5 * Math.sin(tm * 1.43 + phase[i] * 3), a = 0.1 + 0.7 * k * k, r = r0 * (1 + 1.2 * k), x = x0 + nx * iw, y = y0 + ny * ih;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r * 1.8); gr.addColorStop(0, `rgba(255,243,200,${a})`); gr.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,248,220,${a})`; ctx.lineWidth = Math.max(1, r0 * 0.35); ctx.beginPath();
        ctx.moveTo(x - r * 2, y); ctx.lineTo(x + r * 2, y); ctx.moveTo(x, y - r * 2); ctx.lineTo(x, y + r * 2); ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    // dust in the light
    ctx.fillStyle = gold;
    dust.forEach((d) => { const p = P(d.X, d.Y + 0.02 * Math.sin(tm * 0.5 + d.ph), d.Z); ctx.globalAlpha = 0.15 + 0.3 * Math.sin(tm * 0.9 + d.ph) ** 2; ctx.fillRect(p.x, p.y, 1.5, 1.5); });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function frameStep(now) {
    raf = 0; if (!running) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    cam += (camTo - cam) * Math.min(1, dt * 2.2); draw(now / 1000, day()); raf = requestAnimationFrame(frameStep);
  }
  addEventListener('resize', () => { resize(); if (!running || reduce) draw(0, day()); });
  addEventListener('scroll', () => { if (reduce && running) draw(0, day()); }, { passive: true }); // the still frame follows the page
  addEventListener('pointermove', (e) => { camTo = ((e.clientX / Math.max(1, W)) - 0.5) * 0.16; }, { passive: true });
  resize(); seed();
  return {
    get on() { return running; },
    set(v) {
      v = !!v; if (v === running) return; running = v;
      if (!v) { cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, W, H); return; }
      if (reduce) { draw(0, day()); return; } // one still frame
      last = 0; raf = requestAnimationFrame(frameStep);
    },
  };
}
