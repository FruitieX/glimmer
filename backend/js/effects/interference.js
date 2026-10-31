export const meta = {
  name: "Interference",
  description: "Ripples from two wandering sources overlap into shifting moiré fringes.",
  category: "Plasma & flow",
  colors: [
    { id: "a", label: "First source", default: "#ff5d8f" },
    { id: "b", label: "Second source", default: "#3ddbd9" },
    { id: "bg", label: "Background", default: "#0a0620" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.05, max: 2, step: 0.05, default: 0.4 },
    waves: { type: "number", label: "Wavelength", min: 0.3, max: 1.2, step: 0.01, default: 0.55 },
    distance: { type: "number", label: "Source distance", min: 0, max: 1, step: 0.05, default: 0.8 },
  },
  looks: [
    { name: "Ocean", params: { speed: 0.25, waves: 0.8 }, colors: ["#00a0ff", "#30ffd0", "#010818"] },
    { name: "Ember", params: { speed: 0.6, distance: 0.5 }, colors: ["#ff4010", "#ffc030", "#140400"] },
    { name: "Neon", params: { speed: 1, waves: 0.35 }, colors: ["#ff00e0", "#a0ff00", "#06020c"] },
    { name: "Aurora", params: { speed: 0.2, waves: 1, distance: 1 }, colors: ["#30ff80", "#8040ff", "#020a14"] },
  ],
};

// Ripples repeat after 1 / speed; the sources circle once in 8 ripple periods.
export function loop(params) {
  return 8 / params.speed;
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
  const A = ctx.colors[0] || [1, 0.36, 0.56];
  const B = ctx.colors[1] || [0.24, 0.86, 0.85];
  const G = ctx.colors[2] || [0.04, 0.02, 0.13];
  const xs = s.line ? ctx.u : ctx.x;
  const w = TAU * fract(t * params.speed);
  const orbit = TAU * fract((t * params.speed) / 8);
  // The two sources sit opposite each other and slowly circle the centre,
  // with their spacing breathing in and out.
  const R = 0.5 * params.distance * Math.hypot(s.ax, s.ay) * 0.6 * (1 + 0.25 * Math.sin(orbit * 2));
  const sx = R * Math.cos(orbit), sy = R * Math.sin(orbit) * (s.line ? 0 : 1);
  const kw = TAU / params.waves;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax;
    const Y = (y[i] - 0.5) * s.ay;
    const d1 = Math.hypot(X - sx, Y - sy);
    const d2 = Math.hypot(X + sx, Y + sy);
    const w1 = Math.cos(kw * d1 - w);
    const w2 = Math.cos(kw * d2 - w);
    // Constructive interference is bright; each source tints its own side.
    const sum = 0.25 * (w1 + w2) + 0.5;
    const I = sum * sum;
    const q = smoothstep(-0.35, 0.35, d2 - d1);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const col = B[c] + (A[c] - B[c]) * q;
      out[j + c] = G[c] + (col - G[c]) * I;
    }
  }
}
