export const meta = {
  name: "Diagonal wipe",
  description: "A soft edge with a light sheen sweeps across at an angle.",
  params: {
    angle: { type: "number", label: "Direction", min: 0, max: 345, step: 15, unit: "°", default: 45 },
    sheen: { type: "number", label: "Sheen", min: 0, max: 1, step: 0.01, default: 0.35 },
    softness: { type: "number", label: "Edge softness", min: 0.01, max: 0.5, step: 0.01, default: 0.12 },
  },
};

export function setup(ctx) {
  const { n, x, y, u, aspect, params } = ctx;
  const line = sampler(ctx).line;
  const th = (params.angle * PI) / 180;
  const v = new Float32Array(n);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < n; i++) {
    // 0° sweeps left to right, 90° upwards; on a line it runs along the wire.
    v[i] = line ? (Math.cos(th) >= -1e-6 ? u[i] : 1 - u[i]) : x[i] * aspect * Math.cos(th) + y[i] * Math.sin(th);
    lo = Math.min(lo, v[i]);
    hi = Math.max(hi, v[i]);
  }
  for (let i = 0; i < n; i++) v[i] = hi - lo > 1e-6 ? (v[i] - lo) / (hi - lo) : 0;
  return { v };
}

export function render(ctx, s) {
  const { n, a, b, out, progress, params } = ctx;
  const p = ease.inOut(progress);
  const soft = Math.max(params.softness, ctx.spacing * 1.5);
  const front = p * (1 + soft);
  const env = params.sheen * Math.sin(PI * progress);
  for (let i = 0; i < n; i++) {
    const v = s.v[i];
    const k = smoothstep(v, v + soft, front);
    const sheen = env * Math.exp(-(((front - v - soft * 0.5) / soft) ** 2));
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      const v0 = a[j] + (b[j] - a[j]) * k;
      out[j] = v0 + (1 - v0) * sheen;
    }
  }
}
