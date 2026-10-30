export const meta = {
  name: "Plasma",
  description: "Flowing interference patterns blended through a palette.",
  category: "Plasma & flow",
  colors: [
    { id: "a", label: "First", default: "#7400b8" },
    { id: "b", label: "Second", default: "#48bfe3" },
    { id: "c", label: "Third", default: "#ff006e" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0, max: 2, step: 0.01, default: 0.3 },
    scale: { type: "number", label: "Scale", min: 0.5, max: 8, step: 0.1, default: 3 },
  },
};
export function loop(params) {
  return params.speed > 0 ? 20 / params.speed : 20;
}
export function render(ctx) {
  const { n, x, y, out, colors, params, t } = ctx;
  // Every term repeats after 20 / speed seconds, so the effect loops seamlessly.
  const w = (TAU * t * params.speed) / 20;
  const s = params.scale;
  for (let i = 0; i < n; i++) {
    const v =
      Math.sin(x[i] * s + w * 2) +
      Math.sin(y[i] * s * 0.8 - w * 3) +
      Math.sin((x[i] + y[i]) * s * 0.6 + w) +
      Math.sin(Math.hypot(x[i] - 0.5, y[i] - 0.5) * s * 2 - w * 4);
    out.set(palette(colors, v / 8 + 0.5, true), i * 3);
  }
}
