export const meta = {
  name: "Iris",
  description: "A circle opens from a point with a glowing rim, revealing the new look (or closes in from the edges).",
  params: {
    close: { type: "boolean", label: "Close in from the edges", default: false },
    cx: { type: "number", label: "Centre (horizontal)", min: 0, max: 1, step: 0.01, default: 0.5 },
    cy: { type: "number", label: "Centre (vertical)", min: 0, max: 1, step: 0.01, default: 0.5 },
    rim: { type: "number", label: "Rim glow", min: 0, max: 1, step: 0.01, default: 0.6 },
    softness: { type: "number", label: "Edge softness", min: 0.01, max: 0.4, step: 0.01, default: 0.05 },
  },
};

export function setup(ctx) {
  return { line: sampler(ctx).line, d: new Float32Array(ctx.n) };
}

export function render(ctx, s) {
  const { n, x, y, u, a, b, out, progress, params, aspect } = ctx;
  const p = ease.inOut(progress);
  // Distance from the centre in real proportions, scaled so the farthest LED is 1.
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    const d = s.line ? Math.abs(u[i] - params.cx) : Math.hypot((x[i] - params.cx) * aspect, y[i] - params.cy);
    s.d[i] = d;
    if (d > max) max = d;
  }
  const soft = Math.max(params.softness, (ctx.spacing / max) * 1.5);
  const front = p * (1 + soft);
  const glow = params.rim * Math.sqrt(Math.sin(PI * progress));
  for (let i = 0; i < n; i++) {
    let v = s.d[i] / max;
    if (params.close) v = 1 - v;
    const k = smoothstep(v, v + soft, front);
    const ring = glow * Math.exp(-(((front - v - soft * 0.5) / (soft * 1.2)) ** 2));
    const j = i * 3;
    // The rim takes the new look's colour, lightened towards white.
    const peak = Math.max(b[j], b[j + 1], b[j + 2], 0.2);
    for (let c = 0; c < 3; c++) {
      const v0 = a[j + c] + (b[j + c] - a[j + c]) * k;
      const tint = 0.5 + 0.5 * (b[j + c] / peak);
      out[j + c] = v0 + (tint - v0) * ring;
    }
  }
}
