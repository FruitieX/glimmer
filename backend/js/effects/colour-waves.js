export const meta = {
  name: "Colour waves",
  description: "Curving bands of colour roll through the palette like slow surf.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#f72585" },
    { id: "b", label: "Second", default: "#ff9e00" },
    { id: "c", label: "Third", default: "#4361ee" },
    { id: "d", label: "Fourth", default: "#4cc9f0" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.02, max: 1, step: 0.01, default: 0.12 },
    size: { type: "number", label: "Waves", min: 0.2, max: 3, step: 0.05, default: 0.55 },
    bend: { type: "number", label: "Bend", min: 0, max: 1, step: 0.05, default: 0.35 },
    crest: { type: "number", label: "Crest shading", min: 0, max: 1, step: 0.05, default: 0.5 },
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
  const cols = ctx.colors.length ? ctx.colors : [[0.97, 0.15, 0.52], [1, 0.62, 0], [0.26, 0.38, 0.93]];
  const m = cols.length;
  const xs = s.line ? ctx.u : ctx.x;
  // Phase in whole cycles per loop, so every term repeats after 1 / speed.
  const w = TAU * t * params.speed;
  const size = params.size;
  const bend = params.bend;
  const crest = params.crest;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax;
    const Y = (y[i] - 0.5) * s.ay;
    // Waves roll diagonally upward; their fronts sway and bow with time.
    const along = 0.8 * Y + 0.6 * X;
    const across = 0.6 * Y - 0.8 * X;
    const sway =
      bend * (0.22 * Math.sin(TAU * across * 1.1 + w) + 0.12 * Math.sin(TAU * along * 0.7 - 2 * w + across * 3));
    const v = (along + sway) * size - t * params.speed;
    const p = (v - Math.floor(v)) * m;
    const k = Math.floor(p);
    const g = p - k;
    const ge = g * g * (3 - 2 * g);
    const c0 = cols[k % m];
    const c1 = cols[(k + 1) % m];
    // Crests: a gentle brightness swell once per colour band.
    const sh = 1 - crest * 0.55 * (0.5 - 0.5 * Math.cos(TAU * g));
    const j = i * 3;
    out[j] = (c0[0] + (c1[0] - c0[0]) * ge) * sh;
    out[j + 1] = (c0[1] + (c1[1] - c0[1]) * ge) * sh;
    out[j + 2] = (c0[2] + (c1[2] - c0[2]) * ge) * sh;
  }
}
