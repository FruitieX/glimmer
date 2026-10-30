export const meta = {
  name: "Summer fireflies",
  description: "Fireflies wandering and blinking softly on a warm summer night.",
  category: "Seasonal",
  colors: [
    { id: "fly", label: "Fireflies", default: "#c6ff3a" },
    { id: "core", label: "Bright core", default: "#fff6b0" },
    { id: "night", label: "Night", default: "#06183a" },
    { id: "grass", label: "Grass", default: "#0c3a18" },
  ],
  params: {
    count: { type: "number", label: "Fireflies", min: 1, max: 30, step: 1, default: 12 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    blink: { type: "number", label: "Blinking", min: 0.2, max: 3, step: 0.01, default: 1 },
    night: { type: "number", label: "Night brightness", min: 0, max: 1, step: 0.01, default: 0.35 },
  },
};

const PERIOD = 40;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const fly = colors[0] || [0.78, 1, 0.23];
  const core = colors[1] || [1, 0.96, 0.69];
  const night = colors[2] || [0.02, 0.09, 0.23];
  const grass = colors[3] || [0.05, 0.23, 0.09];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const nb = params.night;
  for (let i = 0; i < n; i++) {
    const g = wide ? 0.3 : smoothstep(0.3, 0.05, y[i]) * (0.7 + 0.3 * Math.sin(x[i] * 23 + TAU * p * 2));
    const o = i * 3;
    out[o] = (night[0] + (grass[0] - night[0]) * g) * nb;
    out[o + 1] = (night[1] + (grass[1] - night[1]) * g) * nb;
    out[o + 2] = (night[2] + (grass[2] - night[2]) * g) * nb;
  }
  const r = wide ? Math.max(spacing * 2.5, 0.012) : Math.max(spacing * 0.9, 0.035);
  const blinks = Math.max(1, Math.round(params.blink * 10));
  for (let f = 0; f < params.count; f++) {
    // Lazy wandering paths made of whole-number cycles per loop.
    const a1 = TAU * (p * (1 + (f % 3)) + hash(f, 1));
    const a2 = TAU * (p * (2 + (f % 4)) + hash(f, 2));
    const a3 = TAU * (p * (3 + (f % 2)) + hash(f, 3));
    const fx = fract(hash(f, 4) + 0.18 * Math.sin(a1) + 0.07 * Math.sin(a3) + (wide ? 0.1 * Math.sin(a2) : 0));
    const fy = 0.15 + 0.7 * hash(f, 5) + 0.15 * Math.sin(a2) + 0.05 * Math.cos(a3);
    // Each firefly glows in its own rhythm: a slow swell and a quick fade.
    const bph = fract(p * (blinks + (f % 3)) + hash(f, 6));
    const on = bph < 0.25 ? Math.sin((bph / 0.25) * PI) : 0;
    const k = on * on;
    if (k < 0.01) continue;
    for (let i = 0; i < n; i++) {
      let dx = x[i] - fx;
      dx -= Math.round(dx);
      const ex = dx / (wide ? r : r * 1.8);
      if (ex > 3 || ex < -3) continue;
      const ey = wide ? 0 : (y[i] - fy) / r;
      const d2 = ex * ex + ey * ey;
      if (d2 > 9) continue;
      const v = Math.exp(-d2 * 1.3) * k;
      const hot = v * v;
      const o = i * 3;
      out[o] += fly[0] * v + (core[0] - fly[0]) * hot * 0.5;
      out[o + 1] += fly[1] * v + (core[1] - fly[1]) * hot * 0.5;
      out[o + 2] += fly[2] * v + (core[2] - fly[2]) * hot * 0.5;
    }
  }
}
