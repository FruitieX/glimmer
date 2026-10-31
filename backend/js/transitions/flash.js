export const meta = {
  name: "Flash",
  description: "The old look brightens into a soft flash of colour, which clears to show the new one.",
  params: {
    hue: { type: "number", label: "Colour", min: 0, max: 1, step: 0.01, default: 0.1 },
    saturation: { type: "number", label: "Saturation (0: white)", min: 0, max: 1, step: 0.01, default: 0 },
    strength: { type: "number", label: "Strength", min: 0, max: 1, step: 0.01, default: 0.85 },
    spread: { type: "number", label: "Spreads from the middle", min: 0, max: 0.8, step: 0.01, default: 0.3 },
  },
};

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const line = sampler(ctx).line;
  const d = new Float32Array(n);
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    d[i] = line ? Math.abs(u[i] - 0.5) : Math.hypot((x[i] - 0.5) * aspect, y[i] - 0.5);
    max = Math.max(max, d[i]);
  }
  for (let i = 0; i < n; i++) d[i] /= max;
  return { d };
}

export function render(ctx, s) {
  const { n, a, b, out, progress, params } = ctx;
  const col = hsv(params.hue, params.saturation, 1);
  const spread = params.spread;
  for (let i = 0; i < n; i++) {
    // Each LED runs the whole flash, the middle ones first.
    const q = clamp((progress - s.d[i] * spread) / (1 - spread));
    const m = smoothstep(0.4, 0.6, q);
    // Rises gently, peaks half way, and clears a little faster.
    const w = params.strength * Math.pow(Math.sin(PI * Math.pow(q, 0.8)), 1.5);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const v = a[j + c] + (b[j + c] - a[j + c]) * m;
      out[j + c] = v + (col[c] - v) * w;
    }
  }
}
