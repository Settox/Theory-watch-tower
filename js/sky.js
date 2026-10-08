// Cosmic backdrop: drifting nebulae, three parallax star layers, constellation lines, shooting stars.
export function sky(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let W, H, stars = [], dust = [], neb = [], shoots = [], poolArea = 1;
  const mouse = { x: 0.5, y: 0.5, px: -999, py: -999 };
  // user setting (Settings → Sky): star amount and constellation lines, 0-100, stored with the app settings
  const dens = () => { let s = {}; try { s = JSON.parse(localStorage.getItem('spazio-teorie-settings') || '{}') || {}; } catch {} return { stars: (s.skyStars ?? 30) / 100, lines: (s.skyLines ?? 55) / 100 }; };
  const TINTS = { deep: ['#ffffff', '#cfe2ff', '#ffe9b8', '#ffd1c4', '#bfe9ff'], aurora: ['#ffffff', '#c8fff0', '#d6c8ff', '#bff5ff', '#e6fff8'], dawn: ['#fff4e0', '#ffe0c0', '#ffd0d8', '#fff0b8', '#ffffff'],
    ocean: ['#e6fbff', '#9ff4ff', '#7fe0ff', '#c8f0ff', '#b8fff0'], ember: ['#fff0e0', '#ffc890', '#ffa060', '#ffd8b0', '#ffe8c8'], nebula: ['#fff0fb', '#ffc0ec', '#d8b8ff', '#ff9de0', '#c8d8ff'],
    forest: ['#f6ffe0', '#f2e35a', '#d8ff9a', '#c8f0b0', '#fff6a0'], void: ['#ffffff', '#ffffff', '#f0f0ff', '#ffffff', '#e8e8ff'], sakura: ['#fff2f6', '#ffd0e0', '#ffc2d4', '#f0d0ff', '#ffffff'], solar: ['#fff6dc', '#ffe08a', '#ffcf4a', '#ffd8a0', '#ffffff'] };
  // signature effects: [count, colour, spawn(p), step(p, t)]; cheap arcs only
  const FX = { ocean: [22, '160,245,255'], ember: [34, '255,150,60'], forest: [20, '240,230,90'], sakura: [26, '255,176,200'] };
  let fx = [], fxKey = '';
  const spawn = (k, p, init) => {
    p.x = Math.random() * W; p.y = init ? Math.random() * H : k === 'sakura' ? -10 : H + 10; p.r = 1 + Math.random() * (k === 'ocean' ? 3 : k === 'sakura' ? 3.5 : 1.8); p.v = 0.15 + Math.random() * 0.45; p.ph = Math.random() * 6.28;
    if (k === 'forest') { p.y = Math.random() * H; p.r = 1.2 + Math.random() * 1.4; }
  };
  let themeKey = '', NEB = [[92, 70, 210], [40, 120, 220], [200, 80, 170], [30, 170, 190]], star = '#f4f1e8', gold = '#e8c872';
  const theme = () => { // re-read palette vars only when the sky/day theme changes
    const k = document.documentElement.dataset.sky + '|' + document.documentElement.dataset.theme;
    if (k !== themeKey) { themeKey = k; NEB = [1, 2, 3, 4].map((i) => (css('--neb' + i) || '').split(',').map(Number)).map((c, i) => c.length === 3 && c.every(Number.isFinite) ? c : NEB[i]); star = css('--star') || star; gold = css('--gold') || gold; }
  };
  const sk = () => document.documentElement.dataset.sky || 'deep';
  const rib = [{ y: 0.18, h: 0.3, c: 0, f: 0.004, s: 0.00012, a: 0.1 }, { y: 0.26, h: 0.28, c: 1, f: 0.0055, s: 0.00009, a: 0.08 }, { y: 0.12, h: 0.26, c: 2, f: 0.0033, s: 0.00015, a: 0.07 }];

  // The star pool is created ONCE. Resizing only rescales the positions already there, so stars glide with the window
  // instead of being re-rolled at random places (which is what looked "crazy" while dragging the sidebar edge).
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2), nw = innerWidth, nh = innerHeight, first = !stars.length;
    if (!first && nw === W && nh === H) return;
    const sx = first ? 1 : nw / W, sy = first ? 1 : nh / H;
    W = nw; H = nh; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!first) { for (const d of dust) { d.x *= sx; d.y *= sy; } for (const q of stars) { q.x *= sx; q.y *= sy; } return; }
    const area = poolArea = Math.max(W * H, (screen.width || 0) * (screen.height || 0)); // sized for the biggest window, so growing the window never runs short
    dust = Array.from({ length: Math.round(area / 1800) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 0.7 + 0.2, a: Math.random() * 0.5 + 0.15, ph: Math.random() * 6.28 }));
    stars = Array.from({ length: Math.round(Math.min(220, area / 6000)) }, () => ({
      x: Math.random() * W, y: Math.random() * H, r: 0.8 + Math.random() * 1.8, vx: (Math.random() - 0.5) * 0.1, vy: (Math.random() - 0.5) * 0.1,
      ph: Math.random() * 6.28, sp: 0.6 + Math.random() * 1.6, ci: (Math.random() * 5) | 0, par: 6 + Math.random() * 26,
    }));
    neb = [
      { x: 0.2, y: 0.25, r: 0.55, a: 0.22, s: 0.00006 }, { x: 0.8, y: 0.2, r: 0.5, a: 0.16, s: 0.00005 },
      { x: 0.65, y: 0.85, r: 0.6, a: 0.14, s: 0.00007 }, { x: 0.1, y: 0.9, r: 0.45, a: 0.12, s: 0.00004 },
    ].map((n, i) => ({ ...n, ph: i * 1.7 }));
  }
  let rz = 0; // many resize events per frame (sidebar drags) collapse into one
  addEventListener('resize', () => { if (!rz) rz = requestAnimationFrame(() => { rz = 0; resize(); }); });
  addEventListener('pointermove', (e) => { mouse.px = e.clientX; mouse.py = e.clientY; mouse.x = e.clientX / W; mouse.y = e.clientY / H; });
  resize();
  const day = () => document.documentElement.dataset.theme === 'day';

  function frame(t) {
    ctx.clearRect(0, 0, W, H);
    const D = dens(), fit = Math.min(1, (W * H) / poolArea), nStars = Math.round(stars.length * D.stars * fit), nDust = Math.round(dust.length * D.stars * fit), isDay = day(), skyName = sk(), tint = TINTS[skyName] || TINTS.deep; theme();
    // nebulae: soft coloured clouds (screen-blended, faded in the light theme)
    ctx.globalCompositeOperation = isDay ? 'multiply' : 'screen';
    for (const [ni, n] of neb.entries()) {
      const cx = (n.x + Math.sin(t * n.s + n.ph) * 0.06) * W, cy = (n.y + Math.cos(t * n.s * 1.3 + n.ph) * 0.05) * H, R = n.r * Math.max(W, H);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); const [r, gg, b] = NEB[ni], k = isDay ? n.a * 0.35 : n.a;
      g.addColorStop(0, `rgba(${r},${gg},${b},${k})`); g.addColorStop(0.5, `rgba(${r},${gg},${b},${k * 0.35})`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (skyName === 'aurora' && !isDay && !reduce) { // slow curtains: sine-modulated vertical gradient bands
      for (const b of rib) {
        const [r, gg, bl] = NEB[b.c], top = b.y * H, bh = b.h * H, g = ctx.createLinearGradient(0, top, 0, top + bh * 1.4);
        g.addColorStop(0, `rgba(${r},${gg},${bl},0)`); g.addColorStop(0.35, `rgba(${r},${gg},${bl},${b.a})`); g.addColorStop(1, `rgba(${r},${gg},${bl},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, H);
        const yy = (x) => top + Math.sin(x * b.f + t * b.s * 6) * bh * 0.35 + Math.sin(x * b.f * 2.3 - t * b.s * 4) * bh * 0.12;
        for (let x = 0; x <= W + 30; x += 30) ctx.lineTo(x, yy(x));
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // dust
    ctx.fillStyle = star;
    for (let di = 0; di < nDust; di++) { const d = dust[di]; ctx.globalAlpha = d.a * (0.6 + 0.4 * Math.sin(t * 0.001 + d.ph)) * (isDay ? 0.4 : 1); ctx.fillRect(d.x, d.y, d.r * 1.4, d.r * 1.4); }
    // stars drift + parallax, link nearby ones into constellations
    const ox = (mouse.x - 0.5), oy = (mouse.y - 0.5), pos = [];
    for (let si = 0; si < nStars; si++) { const s = stars[si];
      if (!reduce) { s.x += s.vx; s.y += s.vy; if (s.x < -20) s.x = W + 20; if (s.x > W + 20) s.x = -20; if (s.y < -20) s.y = H + 20; if (s.y > H + 20) s.y = -20; }
      pos.push([s.x - ox * s.par, s.y - oy * s.par]);
    }
    ctx.lineWidth = 1.1; ctx.lineCap = 'round'; const LINK = 150;
    for (let i = 0; i < nStars; i++) {
      const [ax, ay] = pos[i];
      for (let j = i + 1; D.lines > 0 && j < nStars; j++) {
        const d = Math.hypot(ax - pos[j][0], ay - pos[j][1]);
        if (d < LINK * D.lines * 1.6) { const gl = ctx.createLinearGradient(ax, ay, pos[j][0], pos[j][1]); gl.addColorStop(0, 'rgba(180,200,255,0.0)'); gl.addColorStop(0.5, isDay ? 'rgba(40,50,110,0.5)' : 'rgba(190,210,255,0.55)'); gl.addColorStop(1, 'rgba(180,200,255,0.0)'); ctx.globalAlpha = (1 - d / (LINK * D.lines * 1.6)); ctx.strokeStyle = gl; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(pos[j][0], pos[j][1]); ctx.stroke(); }
      }
      const dm = Math.hypot(ax - mouse.px, ay - mouse.py);
      if (D.lines > 0 && dm < 170) { ctx.globalAlpha = (1 - dm / 170) * 0.7; ctx.strokeStyle = gold; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(mouse.px, mouse.py); ctx.stroke(); }
    }
    for (let i = 0; i < nStars; i++) {
      const s = stars[i], [x, y] = pos[i], tw = 0.55 + 0.45 * Math.sin(t * 0.0016 * s.sp + s.ph);
      const c = isDay ? star : tint[s.ci];
      const g = ctx.createRadialGradient(x, y, 0, x, y, s.r * 6); g.addColorStop(0, c); g.addColorStop(0.2, c); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = tw * (isDay ? 0.35 : skyName === 'dawn' ? 0.3 : 0.5); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s.r * 6, 0, 6.28); ctx.fill();
      ctx.globalAlpha = tw * (skyName === 'dawn' && !isDay ? 0.75 : 1); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.28); ctx.fill();
      if (s.r > 2) { ctx.globalAlpha = tw * 0.7; ctx.strokeStyle = c; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(x - s.r * 5, y); ctx.lineTo(x + s.r * 5, y); ctx.moveTo(x, y - s.r * 5); ctx.lineTo(x, y + s.r * 5); ctx.stroke(); ctx.lineWidth = 0.7; }
    }
    // signature sky effect (ocean bubbles, ember sparks, forest fireflies, sakura petals)
    const F = FX[skyName];
    if (F && !reduce && !isDay) {
      if (fxKey !== skyName) { fxKey = skyName; fx = Array.from({ length: F[0] }, () => { const p = {}; spawn(skyName, p, 1); return p; }); }
      ctx.fillStyle = ctx.strokeStyle = `rgb(${F[1]})`;
      for (const p of fx) {
        if (skyName === 'sakura') { p.y += p.v * 0.8 + 0.1; p.x += Math.sin(t * 0.0008 + p.ph) * 0.5 + 0.12; if (p.y > H + 10) spawn(skyName, p); ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 1.5, p.r * 0.8, t * 0.0005 + p.ph, 0, 6.28); ctx.fill(); continue; }
        if (skyName === 'forest') { p.x += Math.sin(t * 0.0004 + p.ph) * 0.4; p.y += Math.cos(t * 0.0005 + p.ph * 2) * 0.3; ctx.globalAlpha = Math.max(0, Math.sin(t * 0.0013 + p.ph)) ** 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, 6.28); ctx.fill(); continue; }
        p.y -= p.v * (skyName === 'ember' ? 1.6 : 0.7); p.x += Math.sin(t * 0.001 + p.ph) * 0.35; if (p.y < -10) spawn(skyName, p);
        const fade = Math.min(1, p.y / (H * 0.5) + 0.2);
        if (skyName === 'ocean') { ctx.globalAlpha = 0.35 * fade; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.stroke(); }
        else { ctx.globalAlpha = (0.5 + 0.5 * Math.sin(t * 0.01 + p.ph)) * fade; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.7, 0, 6.28); ctx.fill(); }
      }
    }
    // shooting stars
    if (!reduce && !isDay && skyName !== 'sakura' && shoots.length < 2 && Math.random() < 0.004) shoots.push({ x: Math.random() * W * 0.8 + W * 0.2, y: Math.random() * H * 0.4, vx: -(5 + Math.random() * 5), vy: 2 + Math.random() * 3, life: 1 });
    for (const s of shoots) {
      s.x += s.vx; s.y += s.vy; s.life -= 0.014;
      const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12); g.addColorStop(0, `rgba(255,255,255,${s.life})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 12, s.y - s.vy * 12); ctx.stroke();
    }
    shoots = shoots.filter((s) => s.life > 0);
    ctx.globalAlpha = 1;
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { redraw: () => reduce && requestAnimationFrame(frame) };
}
