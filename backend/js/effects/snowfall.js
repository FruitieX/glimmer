export const meta = {
  name: "Snowfall",
  description: "Flakes drifting down over a cold sky.",
  colors: [
    { id: "sky", label: "Sky", default: "#0b1d51" },
    { id: "snow", label: "Snow", default: "#ffffff" },
  ],
  params: {
    flakes: { type: "number", label: "Flakes", min: 1, max: 40, step: 1, default: 14 },
    speed: { type: "number", label: "Fall speed", min: 0.05, max: 1, step: 0.01, default: 0.2 },
    size: { type: "number", label: "Flake size", min: 0.02, max: 0.3, step: 0.01, default: 0.09 },
    sky: { type: "number", label: "Sky brightness", min: 0, max: 1, step: 0.01, default: 0.3 },
  },
};
export function loop(params) {
  return 1 / params.speed;
}
export function render(ctx) {
  const { n, x, y, out, colors, params, t } = ctx;
  const sky = scale(colors[0] || [0.05, 0.1, 0.3], params.sky);
  const snow = colors[1] || [1, 1, 1];
  const r2 = params.size * params.size;
  for (let i = 0; i < n; i++) out.set(sky, i * 3);
  for (let f = 0; f < params.flakes; f++) {
    const fy = 1.1 - fract(t * params.speed + hash(f, 1)) * 1.2;
    const fx = hash(f, 2) + Math.sin(TAU * (t * params.speed + hash(f, 4))) * 0.04;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - fx, dy = y[i] - fy;
      const d = (dx * dx + dy * dy) / r2;
      if (d < 1) {
        const k = (1 - d) * (1 - d);
        const o = i * 3;
        out[o] = Math.max(out[o], lerp(sky[0], snow[0], k));
        out[o + 1] = Math.max(out[o + 1], lerp(sky[1], snow[1], k));
        out[o + 2] = Math.max(out[o + 2], lerp(sky[2], snow[2], k));
      }
    }
  }
}
