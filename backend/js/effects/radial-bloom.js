export const meta = {
  name: "Radial bloom",
  description: "Each colour in turn blooms out from the centre with a glowing rim until it fills everything.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#ff4d6d" },
    { id: "b", label: "Second", default: "#7b2cbf" },
    { id: "c", label: "Third", default: "#00bbf9" },
  ],
  params: {
    pulse: { type: "number", label: "Seconds per bloom", min: 1, max: 20, step: 0.5, default: 4 },
    rim: { type: "number", label: "Rim glow", min: 0, max: 1, step: 0.05, default: 0.6 },
    softness: { type: "number", label: "Edge softness", min: 0.02, max: 0.5, step: 0.01, default: 0.12 },
    depth: { type: "number", label: "Centre shading", min: 0, max: 1, step: 0.05, default: 0.4 },
  },
  looks: [
    { name: "Ocean", params: { pulse: 7 }, colors: ["#00e5ff", "#0050ff", "#00ffb0"] },
    { name: "Ember", params: { pulse: 3, rim: 0.8 }, colors: ["#ffb000", "#ff3c00", "#c0003a"] },
    { name: "Pastel", params: { pulse: 8, softness: 0.3, depth: 0.2 }, colors: ["#ffb3d9", "#b8a6ff", "#9fefff"] },
    { name: "Neon", params: { pulse: 2, softness: 0.06, rim: 0.9 }, colors: ["#ff00c8", "#00ff6a", "#ffee00"] },
  ],
};

export function loop(params, colors) {
  return params.pulse * Math.max(1, colors.length || 3);
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
  const cols = ctx.colors.length ? ctx.colors : [[1, 0.3, 0.43], [0.48, 0.17, 0.75], [0, 0.73, 0.98]];
  const m = cols.length;
  const xs = s.line ? ctx.u : ctx.x;
  const ph = t / params.pulse;
  const k = Math.floor(ph);
  const f = ph - k;
  const prev = cols[(((k % m) + m) % m)];
  const next = cols[(k + 1) % m];
  const soft = Math.max(params.softness, ctx.spacing * 1.5);
  const rmax = 0.5 * Math.hypot(s.ax, s.ay);
  // The front starts hidden inside the centre and ends past the far corners.
  const front = -soft + (0.4 * f + 0.6 * ease.inOut(f)) * (rmax + 2 * soft);
  const rim = params.rim;
  const depth = params.depth;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax;
    const Y = (y[i] - 0.5) * s.ay;
    const d = Math.sqrt(X * X + Y * Y);
    const w = 1 - smoothstep(front - soft, front + soft, d);
    // Inside the bloom, the colour deepens toward its leading edge and
    // relaxes as the bloom settles, so each colour reads as a gradient.
    const z = (front - d) / (rmax + soft);
    const shade = 1 - depth * 0.5 * clamp(1 - z * 2) * (1 - f);
    const q = (d - front) / soft;
    const glow = rim * Math.exp(-q * q) * Math.sin(PI * f);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const base = prev[c] + (next[c] * shade - prev[c]) * w;
      out[j + c] = Math.min(1, base + (next[c] * 0.6 + 0.4) * glow * 0.7);
    }
  }
}
