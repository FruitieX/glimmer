export const meta = {
  name: "Palette drift",
  description: "Soft clouds of colour drifting gently through the palette.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#ff7e5f" },
    { id: "b", label: "Second", default: "#feb47b" },
    { id: "c", label: "Third", default: "#c06c84" },
    { id: "d", label: "Fourth", default: "#6a82fb" },
  ],
  params: {
    cycle: { type: "number", label: "Cycle length", min: 10, max: 300, step: 5, default: 60, unit: "s" },
    scale: { type: "number", label: "Cloud size", min: 0.2, max: 3, step: 0.05, default: 1 },
    variety: { type: "number", label: "Variety", min: 0, max: 1, step: 0.05, default: 0.5 },
  },
  looks: [
    { name: "Ocean", params: { cycle: 90 }, colors: ["#00b4d8", "#0057ff", "#00f5d4", "#3a0ca3"] },
    { name: "Ember", params: { cycle: 40, variety: 0.7 }, colors: ["#ff3c00", "#ffae00", "#ff006e", "#ff7b00"] },
    { name: "Forest", params: { scale: 0.6 }, colors: ["#38e54d", "#00a86b", "#c6ff00", "#008f7a"] },
    { name: "Candy", params: { cycle: 30, scale: 1.5, variety: 0.8 }, colors: ["#ff5fa2", "#a26bff", "#5ce1ff", "#ffd166"] },
  ],
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
  const cols = ctx.colors.length ? ctx.colors : [[1, 0.5, 0.37], [1, 0.7, 0.48], [0.42, 0.51, 0.98]];
  const m = cols.length;
  const xs = s.line ? ctx.u : ctx.x;
  const w = TAU * fract(t / params.cycle);
  // Two noise layers each travel around a closed circle in noise space
  // (in different directions), so the clouds morph and the cycle loops.
  const R1 = 1.6, R2 = 1.1;
  const c1x = R1 * Math.cos(w), c1z = R1 * Math.sin(w);
  const c2y = R2 * Math.cos(w * 2), c2z = R2 * Math.sin(w * 2);
  const sc = 1.6 * params.scale;
  const amp = params.variety * 0.9;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax * sc;
    const Y = (y[i] - 0.5) * s.ay * sc;
    const v = noise(X + c1x, Y + 3.7, c1z) + 0.35 * noise(Y * 1.9 + c2y, X * 1.9 - 5.1, 9.3 + c2z);
    const q = v * amp + w / TAU;
    const p = (q - Math.floor(q)) * m;
    const k = Math.floor(p);
    let g = p - k;
    g = g * g * (3 - 2 * g);
    const a = cols[k % m];
    const b = cols[(k + 1) % m];
    const j = i * 3;
    out[j] = a[0] + (b[0] - a[0]) * g;
    out[j + 1] = a[1] + (b[1] - a[1]) * g;
    out[j + 2] = a[2] + (b[2] - a[2]) * g;
  }
}
