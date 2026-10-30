export const meta = {
  name: "Gradient",
  description: "A slowly drifting gradient through the chosen colours.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#ff4d6d" },
    { id: "b", label: "Second", default: "#ffb703" },
    { id: "c", label: "Third", default: "#3a86ff" },
  ],
  params: {
    axis: { type: "select", label: "Direction", options: ["x", "y", "u"], labels: ["Horizontal", "Vertical", "Along the string"], default: "x" },
    speed: { type: "number", label: "Drift speed", min: 0, max: 1, step: 0.01, default: 0.05 },
    scale: { type: "number", label: "Repeats", min: 0.25, max: 4, step: 0.05, default: 1 },
  },
};
export function loop(params) {
  return params.speed > 0 ? 1 / params.speed : 10;
}
export function render(ctx) {
  const { n, out, colors, params, t } = ctx;
  const axis = ctx[params.axis] || ctx.x;
  for (let i = 0; i < n; i++) {
    const c = palette(colors, axis[i] * params.scale - t * params.speed, true);
    out.set(c, i * 3);
  }
}
