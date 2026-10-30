export const meta = {
  name: "Vortex",
  description: "Spiral arms of colour swirl and drain into a glowing centre.",
  category: "Plasma & flow",
  colors: [
    { id: "a", label: "Outer", default: "#7209b7" },
    { id: "b", label: "Middle", default: "#4cc9f0" },
    { id: "c", label: "Inner", default: "#b5fffc" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.02, max: 1, step: 0.01, default: 0.15 },
    arms: { type: "number", label: "Arms", min: 1, max: 6, step: 1, default: 3 },
    twist: { type: "number", label: "Twist", min: 0, max: 8, step: 0.25, default: 2 },
    reverse: { type: "boolean", label: "Reverse", default: false },
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
  const A = ctx.colors[0] || [0.23, 0.05, 0.64];
  const B = ctx.colors[1] || [0.28, 0.58, 0.94];
  const C = ctx.colors[2] || [0.71, 1, 0.99];
  const xs = s.line ? ctx.u : ctx.x;
  const ph = fract(t * params.speed) * (params.reverse ? -1 : 1);
  const arms = Math.round(params.arms);
  const rmax = 0.5 * Math.hypot(s.ax, s.ay);
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax;
    const Y = (y[i] - 0.5) * s.ay;
    const r = Math.sqrt(X * X + Y * Y) / rmax;
    const a = Math.atan2(Y, X) / TAU;
    // Arms wind more tightly toward the centre and rotate once per loop;
    // a second, slower set of rings drains inward.
    const sp = arms * a + params.twist * Math.sqrt(r) - arms * ph;
    const arm = 0.5 + 0.5 * Math.cos(TAU * sp);
    const drain = 0.5 + 0.5 * Math.cos(TAU * (r * 3 + ph * 2));
    const depth = clamp(r);
    // Colour: inner near the core, middle further out, outer at the rim.
    let c0, c1, h;
    if (depth < 0.45) {
      c0 = C;
      c1 = B;
      h = depth / 0.45;
    } else {
      c0 = B;
      c1 = A;
      h = (depth - 0.45) / 0.55;
    }
    h = h * h * (3 - 2 * h);
    const glow = Math.exp(-r * r * 18) * 0.6;
    const bright = (0.12 + 0.88 * arm * arm * (0.7 + 0.3 * drain)) * (1 - 0.3 * depth) + glow;
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      out[j + c] = Math.min(1, (c0[c] + (c1[c] - c0[c]) * h) * bright);
    }
  }
}
