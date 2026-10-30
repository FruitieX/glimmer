export const meta = {
  name: "Liquid marble",
  description: "Veined marble that slowly melts and swirls like stirred paint.",
  category: "Plasma & flow",
  colors: [
    { id: "base", label: "Stone", default: "#0b3954" },
    { id: "swirl", label: "Swirl", default: "#5fa8d3" },
    { id: "vein", label: "Veins", default: "#ffd6a5" },
  ],
  params: {
    cycle: { type: "number", label: "Cycle length", min: 10, max: 180, step: 5, default: 45, unit: "s" },
    scale: { type: "number", label: "Scale", min: 0.4, max: 3, step: 0.05, default: 1 },
    turbulence: { type: "number", label: "Turbulence", min: 0, max: 2, step: 0.05, default: 1 },
    veins: { type: "number", label: "Vein brightness", min: 0, max: 1, step: 0.05, default: 0.8 },
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
  const S = ctx.colors[0] || [0.04, 0.22, 0.33];
  const W = ctx.colors[1] || [0.37, 0.66, 0.83];
  const V = ctx.colors[2] || [1, 0.84, 0.65];
  const xs = s.line ? ctx.u : ctx.x;
  const w = TAU * fract(t / params.cycle);
  // Noise sampled on a circle through noise space, so the cycle loops.
  const cx = 1.3 * Math.cos(w), cz = 1.3 * Math.sin(w);
  const sc = params.scale;
  const tb = params.turbulence;
  const vb = params.veins;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax * sc;
    const Y = (y[i] - 0.5) * s.ay * sc + (s.line ? 0.3 : 0);
    const T =
      noise(X * 1.8 + cx, Y * 1.8 - 2.3, cz) +
      0.35 * Math.sin(X * 4.1 - Y * 2.3 + 2 * w) +
      0.25 * Math.sin(Y * 5.3 + X * 1.7 - w);
    // Bands bent by the turbulence; veins sit where the band crosses zero.
    const v = Math.sin(TAU * (X * 0.45 + Y * 0.7) + tb * 1.5 * T + w);
    const av = Math.abs(v);
    let vein = 1 - av;
    vein = vein * vein * (3 - 2 * vein) * vein;
    // Broad swirls of the lighter colour through the stone.
    const sw = smoothstep(-0.7, 0.9, Math.sin(TAU * (Y * 0.5 - X * 0.35) + tb * 1.2 * T - w));
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const base = S[c] + (W[c] - S[c]) * sw * 0.75;
      out[j + c] = Math.min(1, base * (0.75 + 0.25 * av) + (V[c] - base) * vein * vb);
    }
  }
}
