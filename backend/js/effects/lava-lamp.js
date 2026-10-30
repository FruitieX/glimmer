export const meta = {
  name: "Lava lamp",
  description: "Soft glowing blobs rise, merge and sink again in warm liquid.",
  category: "Plasma & flow",
  colors: [
    { id: "hot", label: "Blob (bottom)", default: "#ff3d00" },
    { id: "cool", label: "Blob (top)", default: "#ffb300" },
    { id: "liquid", label: "Liquid", default: "#3a0050" },
  ],
  params: {
    cycle: { type: "number", label: "Cycle length", min: 10, max: 120, step: 1, default: 40, unit: "s" },
    blobs: { type: "number", label: "Blobs", min: 2, max: 8, step: 1, default: 5 },
    size: { type: "number", label: "Blob size", min: 0.5, max: 2, step: 0.05, default: 1 },
  },
};

export function loop(params) {
  return params.cycle;
}

// Keeps 2D fixtures in proportion; strings and other 1D layouts run vertically.
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
  // Blob paths: per blob, whole-number speeds so the cycle loops exactly.
  const paths = [];
  for (let b = 0; b < 8; b++) {
    paths.push({
      fy: 1 + (b % 3 === 2 ? 1 : 0),
      py: hash(b, 3),
      fx: 1 + (b % 2),
      px: hash(b, 5),
      bx: (hash(b, 9) - 0.5) * 1.1,
      r: 0.09 + 0.04 * hash(b, 11),
    });
  }
  return { line, ax: line ? 0 : Math.min(1, aspect), ay: line ? 1 : Math.min(1, 1 / aspect), paths, bx: new Float32Array(8), by: new Float32Array(8), br: new Float32Array(8) };
}

export function render(ctx, s) {
  const { n, x, y, u, out, params, t } = ctx;
  const hot = ctx.colors[0] || [1, 0.24, 0];
  const cool = ctx.colors[1] || [1, 0.7, 0];
  const liq = ctx.colors[2] || [0.23, 0, 0.31];
  const ph = TAU * fract(t / params.cycle);
  const nb = Math.max(1, Math.min(8, Math.round(params.blobs)));
  const { bx, by, br, paths } = s;
  const W = 0.5 * s.ax, H = 0.5 * s.ay;
  for (let b = 0; b < nb; b++) {
    const p = paths[b];
    // Rise and fall with an eased profile; drift sideways a little.
    const c = Math.cos(p.fy * ph + TAU * p.py);
    by[b] = -H * 0.95 * c * (1 - 0.15 * c * c);
    bx[b] = W * (p.bx + 0.3 * Math.sin(p.fx * ph + TAU * p.px));
    const r = p.r * params.size;
    br[b] = r * r;
  }
  for (let i = 0; i < n; i++) {
    const X = s.line ? 0 : (x[i] - 0.5) * s.ax;
    const Y = s.line ? u[i] - 0.5 : (y[i] - 0.5) * s.ay;
    // Metaball field: blobs merge smoothly where their fields overlap.
    let f = 0;
    for (let b = 0; b < nb; b++) {
      const dx = X - bx[b], dy = Y - by[b];
      f += br[b] / (dx * dx + dy * dy + 0.004);
    }
    // Soft surface around f = 1 plus a faint glow in the liquid near blobs.
    const body = smoothstep(0.6, 1.4, f);
    const glow = Math.min(1, f * 0.35) * (1 - body);
    const hy = clamp(Y / (2 * H || 1) + 0.5);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const blob = hot[c] + (cool[c] - hot[c]) * hy;
      // Blob cores are slightly brighter than their rims.
      const core = blob * (0.8 + 0.2 * smoothstep(1.3, 4, f));
      const bg = liq[c] * (0.6 + 0.4 * (1 - hy)) + blob * glow * 0.35;
      out[j + c] = bg + (core - bg) * body;
    }
  }
}
