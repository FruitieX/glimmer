export const meta = {
  name: "Digital Rain",
  description: "Matrix-style streams of flickering green glyphs pouring down the columns.",
  category: "Simulations & games",
  colors: [
    { id: "head", label: "Leading glyph", default: "#d6ffe4" },
    { id: "trail", label: "Trail", default: "#19d45a" },
    { id: "background", label: "Background", default: "#000703" },
  ],
  params: {
    speed: { type: "number", label: "Fall speed", min: 1, max: 20, step: 0.5, default: 7 },
    density: { type: "number", label: "Streams per column", min: 0.3, max: 3, step: 0.1, default: 1 },
    length: { type: "number", label: "Trail length", min: 2, max: 16, step: 0.5, default: 7 },
    flicker: { type: "number", label: "Glyph flicker", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
};

// Logical grid mapped onto the LEDs by position: one stream per LED column on
// a curtain; on a straight string, streams pour along the string.
export function setup(ctx) {
  const { n, x, y } = ctx;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = 10, H = 20;
  if (line) { W = 1; H = Math.max(16, Math.min(60, Math.round(n / 2))); }
  else {
    const cx = count(x), cy = count(y);
    if (cx >= 4 && cx <= 32) W = cx;
    if (cy >= 4 && cy <= 48) H = cy;
  }
  const col = new Int32Array(n), gy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i] = line ? 0 : Math.round(x[i] * (W - 1));
    // On a string, rain pours from the far end towards the start.
    gy[i] = (line ? x[i] : y[i]) * (H - 1);
  }
  // Per-frame stream positions (head row and trail length, length 0 when unused).
  return { W, H, line, col, gy, hy: new Float32Array(W * 32), len: new Float32Array(W * 32) };
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const head = colors[0] || [0.85, 1, 0.9];
  const trail = colors[1] || [0.1, 0.85, 0.35];
  const bg = colors[2] || [0, 0, 0];
  const { H, col, gy, line } = s;
  const len = params.length * (line ? 1.5 : 1);
  const want = params.density * (line ? 4 : 1);
  const drops = Math.min(32, Math.ceil(want * 2));
  const fill = want / drops;
  const span = H + len + 2;
  const fl = params.flicker;
  const ft = t * 6;
  const fk = Math.floor(ft), ff = smoothstep(0, 1, ft - fk);
  for (let c = 0; c < s.W; c++) {
    for (let j = 0; j < drops; j++) {
      // Each slot is used by a stream on some passes; each has its own pace.
      const id = c * 32 + j, k = c * 32 + j;
      const sp = params.speed * (0.6 + 0.8 * hash(id, 3));
      const pos = (t * sp) / span + hash(id, 5);
      const cycle = Math.floor(pos);
      s.len[k] = hash(cycle * 64 + id, 9) > fill ? 0 : len * (0.6 + 0.8 * hash(cycle * 64 + id, 11));
      s.hy[k] = H - (pos - cycle) * span;
    }
  }
  for (let i = 0; i < n; i++) {
    const c = col[i], Y = gy[i];
    let tr = 0, hd = 0;
    for (let j = 0; j < drops; j++) {
      const L = s.len[c * 32 + j];
      if (L <= 0) continue;
      const d = Y - s.hy[c * 32 + j];
      if (d >= 0 && d < L) {
        const a = 1 - d / L;
        tr = Math.max(tr, a * a);
      }
      hd = Math.max(hd, Math.exp(-d * d * 2.2));
    }
    if (tr <= 0 && hd < 0.01) { out[i * 3] = bg[0]; out[i * 3 + 1] = bg[1]; out[i * 3 + 2] = bg[2]; continue; }
    // Each cell shows a "glyph" whose brightness changes now and then.
    const r = Math.round(Y);
    const g0 = hash(c * 977 + r * 31 + fk * 7919, 1), g1 = hash(c * 977 + r * 31 + (fk + 1) * 7919, 1);
    const glyph = 1 - fl + fl * (0.25 + 0.75 * lerp(g0, g1, ff));
    const k = tr * glyph * 0.85;
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) out[o + ch] = bg[ch] + trail[ch] * k + (head[ch] - trail[ch] * k) * hd * 0.85;
  }
}
