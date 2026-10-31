export const meta = {
  name: "Starburst",
  description: "Rays of sparks shoot out from a point and the new look fills in behind them, star-shaped.",
  params: {
    cx: { type: "number", label: "Centre (horizontal)", min: 0, max: 1, step: 0.01, default: 0.5 },
    cy: { type: "number", label: "Centre (vertical)", min: 0, max: 1, step: 0.01, default: 0.5 },
    rays: { type: "number", label: "Rays", min: 3, max: 16, step: 1, default: 5 },
    hue: { type: "number", label: "Spark colour", min: 0, max: 1, step: 0.01, default: 0.12 },
    sparks: { type: "number", label: "Sparkle", min: 0, max: 1, step: 0.01, default: 0.7 },
  },
};

export function setup(ctx) {
  const { n, x, y, u, aspect, params } = ctx;
  const line = sampler(ctx).line;
  const d = new Float32Array(n),
    ang = new Float32Array(n);
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    const dx = line ? u[i] - params.cx : (x[i] - params.cx) * aspect;
    const dy = line ? 0 : y[i] - params.cy;
    d[i] = Math.hypot(dx, dy);
    ang[i] = Math.atan2(dy, dx);
    max = Math.max(max, d[i]);
  }
  for (let i = 0; i < n; i++) d[i] /= max;
  return { line, d, ang };
}

export function render(ctx, s) {
  const { n, a, b, out, progress, params, t } = ctx;
  const p = ease.inOut(progress);
  const soft = Math.max(0.06, ctx.spacing * 1.5);
  const rays = Math.round(params.rays);
  // The valleys between the rays reach the far edge last.
  const reach = (p * (1 + soft)) / 0.35;
  const env = Math.sin(PI * progress);
  const spark = hsv(params.hue, 0.6, 1);
  for (let i = 0; i < n; i++) {
    // A line has two rays, one each way.
    const ray = s.line ? 1 : Math.pow(0.5 + 0.5 * Math.cos(rays * s.ang[i] + PI / 2), 3);
    const r = reach * (0.35 + 0.65 * ray);
    const v = s.d[i];
    const k = smoothstep(v, v + soft, r);
    // Sparks ride the tips of the rays and twinkle behind them.
    const tip = Math.exp(-(((r - v - soft * 0.5) / (soft * 1.3)) ** 2)) * (0.35 + 0.65 * ray);
    const twinkle = k * (1 - k * 0.6) * Math.max(0, hash(i, Math.floor(t * 10)) - 0.85) * 6;
    const glow = env * clamp(tip + twinkle * params.sparks);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const v0 = a[j + c] + (b[j + c] - a[j + c]) * k;
      out[j + c] = v0 + (spark[c] - v0) * glow;
    }
  }
}
