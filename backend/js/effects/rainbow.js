export const meta = {
  name: "Rainbow",
  description: "Classic scrolling rainbow.",
  category: "Basics",
  params: {
    axis: { type: "select", label: "Direction", options: ["x", "y", "u"], labels: ["Horizontal", "Vertical", "Along the string"], default: "u" },
    speed: { type: "number", label: "Speed", min: 0, max: 2, step: 0.01, default: 0.2 },
    scale: { type: "number", label: "Repeats", min: 0.25, max: 6, step: 0.05, default: 1 },
    saturation: { type: "number", label: "Saturation", min: 0, max: 1, step: 0.01, default: 1 },
  },
  looks: [
    { name: "Pastel", params: { saturation: 0.5, speed: 0.1 }, colors: [] },
    { name: "Disco", params: { speed: 1.2, scale: 3 }, colors: [] },
    { name: "Rising", params: { axis: "y", scale: 0.5, speed: 0.1 }, colors: [] },
    { name: "Wide sweep", params: { axis: "x", speed: 0.3, scale: 0.5 }, colors: [] },
  ],
};
export function loop(params) {
  return params.speed > 0 ? 1 / params.speed : 10;
}
export function render(ctx) {
  const { n, out, params, t } = ctx;
  const axis = ctx[params.axis] || ctx.u;
  for (let i = 0; i < n; i++) out.set(hsv(axis[i] * params.scale - t * params.speed, params.saturation, 1), i * 3);
}
