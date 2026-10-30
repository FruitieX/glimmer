export const meta = {
  name: "Dissolve",
  description: "LEDs switch over one by one in random order.",
  params: {
    softness: { type: "number", label: "Per-LED fade", min: 0.01, max: 0.5, step: 0.01, default: 0.15 },
  },
};
export function render(ctx) {
  const { n, a, b, out, progress, params } = ctx;
  const s = params.softness;
  for (let i = 0; i < n; i++) {
    const start = hash(i, 11) * (1 - s);
    const k = clamp((progress - start) / s);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[i * 3 + c] + (b[i * 3 + c] - a[i * 3 + c]) * k;
  }
}
