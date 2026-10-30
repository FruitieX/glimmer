export const meta = {
  name: "Warped plasma",
  description: "Plasma folded through itself into slow swirling ink-like currents.",
  category: "Plasma & flow",
  colors: [
    { id: "deep", label: "Deep", default: "#1b0a4a" },
    { id: "middle", label: "Middle", default: "#c2185b" },
    { id: "bright", label: "Bright", default: "#ffb84d" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.01, max: 0.5, step: 0.01, default: 0.05 },
    scale: { type: "number", label: "Scale", min: 0.5, max: 5, step: 0.1, default: 2.2 },
    warp: { type: "number", label: "Warp", min: 0, max: 2.5, step: 0.05, default: 1.3 },
  },
};

export function loop(params) {
  return 1 / params.speed;
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
  const D = ctx.colors[0] || [0.1, 0.04, 0.29];
  const M = ctx.colors[1] || [0.76, 0.09, 0.36];
  const B = ctx.colors[2] || [1, 0.72, 0.3];
  const xs = s.line ? ctx.u : ctx.x;
  // Every time term uses a whole number of cycles per loop.
  const w = TAU * fract(t * params.speed);
  const sc = params.scale;
  const k = params.warp;
  for (let i = 0; i < n; i++) {
    const px = (xs[i] - 0.5) * s.ax * sc;
    const py = (y[i] - 0.5) * s.ay * sc + (s.line ? 0.37 : 0);
    // First warp layer.
    const qx = Math.sin(py * 1.3 + w) + 0.5 * Math.sin(px * 2.1 - 2 * w + 1.0);
    const qy = Math.sin(px * 1.1 - w + 2.0) + 0.5 * Math.sin(py * 1.9 + 3 * w + 0.4);
    // Second warp layer, fed by the first.
    const rx = px + k * qx;
    const ry = py + k * qy;
    const sx = Math.sin(ry * 1.2 - w * 2 + 0.7);
    const sy = Math.sin(rx * 1.5 + w + 1.9);
    const v = Math.sin(rx * 0.9 + ry * 0.7 + k * 0.8 * (sx + sy) + w);
    // v in -1..1 → deep → middle → bright; the warp strength adds a sheen.
    const f = 0.5 + 0.5 * v;
    const sheen = 0.15 * (sx * sy);
    let r, g, b;
    if (f < 0.55) {
      const e = f / 0.55;
      const h = e * e * (3 - 2 * e);
      r = D[0] + (M[0] - D[0]) * h;
      g = D[1] + (M[1] - D[1]) * h;
      b = D[2] + (M[2] - D[2]) * h;
    } else {
      const e = (f - 0.55) / 0.45;
      const h = e * e;
      r = M[0] + (B[0] - M[0]) * h;
      g = M[1] + (B[1] - M[1]) * h;
      b = M[2] + (B[2] - M[2]) * h;
    }
    const j = i * 3;
    const l = 1 + sheen;
    out[j] = clamp(r * l);
    out[j + 1] = clamp(g * l);
    out[j + 2] = clamp(b * l);
  }
}
