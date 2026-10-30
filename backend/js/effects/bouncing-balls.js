export const meta = {
  name: "Bouncing Balls",
  description: "Rubber balls dropping under gravity, squashing as they bounce off the floor.",
  category: "Particles & physics",
  colors: [
    { id: "a", label: "Ball 1", default: "#ff4d6d" },
    { id: "b", label: "Ball 2", default: "#ffd23f" },
    { id: "c", label: "Ball 3", default: "#3ec1d3" },
    { id: "background", label: "Background", default: "#000000" },
  ],
  params: {
    balls: { type: "number", label: "Balls", min: 1, max: 8, step: 1, default: 4 },
    gravity: { type: "number", label: "Gravity", min: 0.3, max: 4, step: 0.05, default: 1.6 },
    bounce: { type: "number", label: "Bounciness", min: 0.5, max: 0.97, step: 0.01, default: 0.82 },
    size: { type: "number", label: "Ball size", min: 0.03, max: 0.2, step: 0.01, default: 0.08 },
  },
};

const MAX = 8;

function gapOf(a, n, spacing) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.round(a[i] * 500);
  v.sort();
  let d = 0;
  for (let i = 1; i < n; i++) if (v[i] !== v[i - 1]) d++;
  return d === 0 ? 0 : Math.max(spacing, 1 / d);
}

export function setup(ctx) {
  const { n, x, y, spacing, aspect } = ctx;
  const gx = gapOf(x, n, spacing), gy = gapOf(y, n, spacing);
  const flat = gy === 0;
  // On a straight string the string itself is the height: the floor is its start.
  const hx = new Float32Array(n), vy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hx[i] = flat ? 0.5 : x[i];
    vy[i] = flat ? x[i] : y[i];
  }
  const s = {
    flat, hx, vy,
    gx: flat ? 0 : gx,
    gy: flat ? gx : gy,
    asp: flat ? 1 : clamp(aspect || 1, 0.3, 3),
    px: new Float32Array(MAX), py: new Float32Array(MAX),
    vx: new Float32Array(MAX), vv: new Float32Array(MAX),
    sq: new Float32Array(MAX),
    best: new Float32Array(n), who: new Int8Array(n),
  };
  for (let b = 0; b < MAX; b++) launch(s, b, true);
  return s;
}

function launch(s, b, first) {
  s.px[b] = 0.1 + Math.random() * 0.8;
  s.py[b] = first ? 0.4 + Math.random() * 0.6 : 0;
  s.vx[b] = (Math.random() - 0.5) * 0.5;
  s.vv[b] = first ? 0 : 1;
}

function step(s, dt, p) {
  const count = Math.round(p.balls);
  const r = p.size;
  for (let b = 0; b < count; b++) {
    s.vv[b] -= p.gravity * dt;
    s.py[b] += s.vv[b] * dt;
    s.px[b] += s.vx[b] * dt;
    if (s.px[b] < r / s.asp) { s.px[b] = r / s.asp; s.vx[b] = Math.abs(s.vx[b]); }
    if (s.px[b] > 1 - r / s.asp) { s.px[b] = 1 - r / s.asp; s.vx[b] = -Math.abs(s.vx[b]); }
    if (s.py[b] < r && s.vv[b] < 0) {
      const v = -s.vv[b];
      s.sq[b] = Math.max(s.sq[b], Math.min(0.45, v * 0.35));
      s.py[b] = r;
      // Tired balls get a fresh kick so the show never stops.
      const kick = Math.sqrt(2 * p.gravity * (0.75 + Math.random() * 0.2));
      s.vv[b] = v * p.bounce < 0.35 * Math.sqrt(p.gravity) ? kick : v * p.bounce;
    }
    s.sq[b] *= Math.exp(-14 * dt);
  }
}

export function render(ctx, s) {
  const { n, out, params, colors } = ctx;
  let dt = Math.min(ctx.dt, 0.5);
  while (dt > 0) {
    const h = Math.min(dt, 1 / 60);
    step(s, h, params);
    dt -= h;
  }
  const bg = colors[3] || [0, 0, 0];
  const pal = [colors[0] || [1, 0.3, 0.43], colors[1] || [1, 0.82, 0.25], colors[2] || [0.24, 0.76, 0.83]];
  const count = Math.round(params.balls);
  const r = params.size;
  const { hx, vy, best, who } = s;
  best.fill(0);
  for (let b = 0; b < count; b++) {
    const q = s.sq[b];
    // Squash: wider and flatter on impact, keeping the bottom on the floor.
    const ry = r * (1 - q * 0.6) + s.gy * 0.6;
    const rx = (r * (1 + q * 0.5)) / s.asp + s.gx * 0.6;
    const cy = s.py[b] - r * q * 0.6;
    const cx = s.px[b];
    const ix = s.flat ? 0 : 1 / rx, iy = 1 / ry;
    // Soft edge about one LED wide, as a fraction of the radius.
    const soft = Math.min(0.9, Math.max(s.gx / rx, s.gy / ry) * (s.flat ? 3 : 0.9));
    for (let i = 0; i < n; i++) {
      const dy = (vy[i] - cy) * iy;
      if (dy > 1 || dy < -1) continue;
      const dx = (hx[i] - cx) * ix;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const w = smoothstep(1, 1 - soft, d);
      if (w > best[i]) {
        best[i] = w;
        who[i] = b;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const c = best[i] > 0 ? pal[who[i] % 3] : bg;
    const w = best[i];
    out[i * 3] = bg[0] + (c[0] - bg[0]) * w;
    out[i * 3 + 1] = bg[1] + (c[1] - bg[1]) * w;
    out[i * 3 + 2] = bg[2] + (c[2] - bg[2]) * w;
  }
}
