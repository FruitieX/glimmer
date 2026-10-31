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
  looks: [
    { name: "Sunset", params: { axis: "y", speed: 0.03 }, colors: ["#ff2a6a", "#ff8a1a", "#7a2aff"] },
    { name: "Ocean", params: { speed: 0.08, scale: 1.5 }, colors: ["#00e0d0", "#1a6aff", "#3a20c0"] },
    { name: "Forest", params: { axis: "y", speed: 0.02 }, colors: ["#30ff60", "#c0ff30", "#10a080"] },
    { name: "Neon", params: { axis: "u", speed: 0.2, scale: 3 }, colors: ["#ff00c8", "#00ffe0", "#a0ff00"] },
    { name: "Pastel", params: { speed: 0.02, scale: 0.5 }, colors: ["#ffa8d8", "#a8e0ff", "#d8b8ff"] },
  ],
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
