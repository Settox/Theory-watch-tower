// Echidna's butterflies for the home sky: the black swallowtail with a green band and pale spots she wears in her hair.
// Slow wanderers with flapping wings, drawn instead of the stars when the Butterflies switch is on.
export function butterflies(W, H, reduce) {
  const n = Math.max(3, Math.min(8, Math.round((W * H) / 150000)));
  const list = Array.from({ length: n }, () => ({
    x: Math.random() * W, y: Math.random() * H, a: Math.random() * 6.283, s: 0.32 + Math.random() * 0.26, v: 14 + Math.random() * 16,
    ph: Math.random() * 6.283, wob: Math.random() * 6.283, hue: 128 + Math.random() * 20, fl: 6 + Math.random() * 3,
  }));
  let last = 0;
  // local space: the body runs along y, the head is at -y; one side, mirrored for the other
  const FORE = new Path2D('M0-1C2-14 9-28 20-35C25-26 27-14 24-8C20-2 10 1 0 3Z');
  const HIND = new Path2D('M0 3C9 0 18 2 20 9L17 13L20 16L15 19L17 28C11 25 6 19 3 13C1 10 0 7 0 3Z');
  const BAND = new Path2D('M2-8C6-18 11-26 17-31L18.500-28C14-23 10-16 6-6Z');
  const BAND2 = new Path2D('M7-4C12-12 17-19 21-24L21.500-20C18-15 14-9 10-3Z');
  const BAND3 = new Path2D('M3 5C9 3 15 5 17 10C13 9 8 8 3 8Z');
  const SPOTS = [[23.500, -18, 1.3], [22, -11, 1.2], [18.500, -4.500, 1.1], [17, 15.500, 1]];
  return {
    step(ctx, t, W, H, day) {
      const dt = reduce ? 0 : Math.min(0.05, last ? (t - last) / 1000 : 0.016); last = t;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const b of list) {
        b.a += Math.sin(t * 0.0007 + b.wob) * 0.9 * dt; b.x += Math.cos(b.a) * b.v * dt; b.y += (Math.sin(b.a) * b.v + Math.sin(t * 0.004 + b.ph) * 8) * dt;
        if (b.x < -40) b.x = W + 40; else if (b.x > W + 40) b.x = -40; if (b.y < -40) b.y = H + 40; else if (b.y > H + 40) b.y = -40;
        const flap = reduce ? 0.85 : 0.2 + 0.8 * Math.abs(Math.sin(t * 0.001 * b.fl + b.ph));
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a + Math.PI / 2); ctx.scale(b.s, b.s);
        for (const side of [1, -1]) {
          ctx.save(); ctx.scale(side * flap, 1);
          ctx.shadowColor = `hsla(${b.hue},90%,60%,${day ? 0 : 0.8})`; ctx.shadowBlur = day ? 0 : 8; // a soft green glow lifts the dark wings off the night sky
          ctx.globalAlpha = 0.92; ctx.fillStyle = day ? '#101a14' : '#0c1612'; ctx.fill(FORE); ctx.fill(HIND);
          ctx.shadowBlur = 0; ctx.fillStyle = `hsl(${b.hue},58%,${day ? 40 : 55}%)`; ctx.fill(BAND); ctx.fill(BAND2); ctx.fill(BAND3);
          ctx.fillStyle = `hsl(${b.hue - 8},65%,86%)`; for (const [x, y, r] of SPOTS) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill(); }
          ctx.strokeStyle = `hsl(${b.hue},70%,${day ? 22 : 62}%)`; ctx.lineWidth = 0.8 / b.s; ctx.stroke(FORE); ctx.stroke(HIND); // thin outline, constellation style
          ctx.restore();
        }
        ctx.globalAlpha = 1; ctx.strokeStyle = day ? '#0a120e' : `hsl(${b.hue},60%,70%)`; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(0, -6); ctx.lineTo(0, 17); ctx.moveTo(0, -6); ctx.quadraticCurveTo(-2, -14, -7, -17); ctx.moveTo(0, -6); ctx.quadraticCurveTo(2, -14, 7, -17); ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  };
}
