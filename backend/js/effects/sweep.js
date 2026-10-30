export const meta = {
  name: "Sweep",
  description: "A conic gradient turning around the centre like a slow lighthouse beam.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#ff006e" },
    { id: "b", label: "Second", default: "#8338ec" },
    { id: "c", label: "Third", default: "#00b4ff" },
  ],
  params: {
    speed: { type: "number", label: "Turns per minute", min: 1, max: 60, step: 1, default: 8 },
    arms: { type: "number", label: "Repeats around", min: 1, max: 4, step: 1, default: 1 },
    twist: { type: "number", label: "Spiral twist", min: -3, max: 3, step: 0.1, default: 0.6 },
    beam: { type: "number", label: "Beam", min: 0, max: 1, step: 0.05, default: 0.7 },
  },
};

export function loop(params) {
  return 60 / params.speed;
}

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
  const { n, x, y, u, out, params, t } = ctx;
  const cols = ctx.colors.length ? ctx.colors : [[1, 0, 0.43], [0.5, 0.2, 0.92], [0.23, 0.53, 1]];
  const m = cols.length;
  const turn = (t * params.speed) / 60;
  const arms = Math.round(params.arms);
  const beam = params.beam;
  for (let i = 0; i < n; i++) {
    let a, r;
    if (s.line) {
      // Along a string the sweep becomes a gradient travelling end to end.
      a = u[i];
      r = 0.25;
    } else {
      const X = (x[i] - 0.5) * s.ax;
      const Y = (y[i] - 0.5) * s.ay;
      a = Math.atan2(Y, X) / TAU;
      r = Math.sqrt(X * X + Y * Y);
    }
    const v = (a + r * params.twist - turn) * arms;
    const f = v - Math.floor(v);
    // Palette across each repeat, with a brighter leading edge (the "beam").
    const p = f * m;
    const k = Math.floor(p);
    const g = p - k;
    const c0 = cols[k % m];
    const c1 = cols[(k + 1) % m];
    const lead = f * f * f * f;
    const tail = f < 0.08 ? 1 - f / 0.08 : 0;
    const bright = 1 - beam * 0.75 + beam * 0.75 * Math.max(lead, tail * tail);
    const j = i * 3;
    out[j] = (c0[0] + (c1[0] - c0[0]) * g) * bright;
    out[j + 1] = (c0[1] + (c1[1] - c0[1]) * g) * bright;
    out[j + 2] = (c0[2] + (c1[2] - c0[2]) * g) * bright;
  }
}
