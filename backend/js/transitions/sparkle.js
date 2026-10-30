export const meta = {
  name: "Sparkle",
  description: "Each LED flashes as it switches over, like a shower of sparks.",
  colors: [],
  params: {
    flash: { type: "number", label: "Flash strength", min: 0, max: 1, step: 0.01, default: 0.8 },
    width: { type: "number", label: "Flash length", min: 0.02, max: 0.4, step: 0.01, default: 0.1 },
  },
};
export function render(ctx) {
  const { n, a, b, out, progress, params } = ctx;
  const w = params.width;
  for (let i = 0; i < n; i++) {
    const at = hash(i, 5) * (1 - w);
    const local = (progress - at) / w;
    const k = clamp(local);
    const spark = local > 0 && local < 1 ? Math.sin(local * PI) * params.flash : 0;
    for (let c = 0; c < 3; c++) {
      const v = a[i * 3 + c] + (b[i * 3 + c] - a[i * 3 + c]) * k;
      out[i * 3 + c] = v + (1 - v) * spark;
    }
  }
}
