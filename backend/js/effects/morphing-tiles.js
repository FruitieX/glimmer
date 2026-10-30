export const meta = {
  name: "Morphing tiles",
  description: "A soft checkerboard that slowly turns into diamonds and back while breathing in size.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#ffd166" },
    { id: "b", label: "Second", default: "#118ab2" },
    { id: "c", label: "Accent", default: "#ef476f" },
  ],
  params: {
    cycle: { type: "number", label: "Cycle length", min: 4, max: 60, step: 1, default: 16, unit: "s" },
    tiles: { type: "number", label: "Tiles", min: 1, max: 8, step: 0.5, default: 2 },
    softness: { type: "number", label: "Softness", min: 0, max: 1, step: 0.05, default: 0.35 },
    accent: { type: "number", label: "Accent glow", min: 0, max: 1, step: 0.05, default: 0.35 },
  },
};

export function loop(params) {
  return params.cycle;
}

// Keeps 2D fixtures in proportion; strings and other 1D layouts use u.
export function setup(ctx) {
  const { n, x, y, aspect } = ctx;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < x0) x0 = x[i];
    if (x[i] > x1) x1 = x[i];
    if (y[i] < y0) y0 = y[i];
    if (y[i] > y1) y1 = y[i];
  }
  const line = !(x1 - x0 > 1e-3 && y1 - y0 > 1e-3);
  return { line, ax: line ? 1 : Math.min(1, aspect), ay: line ? 0 : Math.min(1, 1 / aspect) };
}

export function render(ctx, s) {
  const { n, y, out, params, t } = ctx;
  const A = ctx.colors[0] || [1, 0.82, 0.4];
  const B = ctx.colors[1] || [0.07, 0.54, 0.7];
  const C = ctx.colors[2] || [0.94, 0.28, 0.44];
  const xs = s.line ? ctx.u : ctx.x;
  const ph = TAU * fract(t / params.cycle);
  // A half turn per cycle: the pattern looks the same after 180°, and at 45°
  // the squares read as diamonds.
  const rot = ph / 2;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const k = PI * params.tiles * (1 + 0.25 * Math.sin(ph * 2));
  // The tile edges soften as the field changes over about a LED or more.
  const e = 0.06 + params.softness * 0.5 + ctx.spacing * k * 0.5;
  const acc = params.accent;
  // Drift the whole pattern along a closed loop so it never sits still.
  const ox = 0.12 * Math.sin(ph), oy = 0.1 * Math.sin(ph * 2);
  for (let i = 0; i < n; i++) {
    const X0 = (xs[i] - 0.5) * s.ax;
    const Y0 = s.line ? 0.07 : (y[i] - 0.5) * s.ay;
    const X = X0 * cr - Y0 * sr + ox;
    const Y = X0 * sr + Y0 * cr + oy;
    const sx = Math.sin(k * X), sy = Math.sin(k * Y);
    const f = sx * sy;
    const v = smoothstep(-e, e, f);
    // Tile seams (where f crosses zero) glow in the accent colour.
    const seam = acc * Math.max(0, 1 - Math.abs(f) / (e * 0.9)) * (0.6 + 0.4 * Math.sin(ph * 3 + X0 * 4));
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const base = B[c] + (A[c] - B[c]) * v;
      out[j + c] = base + (C[c] - base) * seam * 0.8;
    }
  }
}
