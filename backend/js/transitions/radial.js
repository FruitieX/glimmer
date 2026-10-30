export const meta = {
  name: "Bloom",
  description: "The new look grows outward from a point (or closes in, when reversed).",
  params: {
    cx: { type: "number", label: "Centre (horizontal)", min: 0, max: 1, step: 0.01, default: 0.5 },
    cy: { type: "number", label: "Centre (vertical)", min: 0, max: 1, step: 0.01, default: 0.5 },
    inward: { type: "boolean", label: "Close inwards", default: false },
    softness: { type: "number", label: "Edge softness", min: 0.01, max: 0.5, step: 0.01, default: 0.12 },
  },
};
export function render(ctx) {
  const { n, x, y, a, b, out, progress, params } = ctx;
  const p = ease.inOut(progress);
  const s = params.softness;
  const max = Math.SQRT2 * 0.75;
  for (let i = 0; i < n; i++) {
    let d = Math.hypot(x[i] - params.cx, y[i] - params.cy) / max;
    if (params.inward) d = 1 - d;
    const k = smoothstep(d, d + s, p * (1 + s));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[i * 3 + c] + (b[i * 3 + c] - a[i * 3 + c]) * k;
  }
}
