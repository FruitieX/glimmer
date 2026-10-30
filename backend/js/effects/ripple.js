export const meta = {
  name: "Ripple",
  description: "Rings of colour spreading out from the centre.",
  colors: [
    { id: "wave", label: "Wave", default: "#00f5d4" },
    { id: "between", label: "Between", default: "#120136" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.05, max: 2, step: 0.01, default: 0.4 },
    rings: { type: "number", label: "Rings", min: 1, max: 8, step: 0.5, default: 3 },
    cx: { type: "number", label: "Centre (horizontal)", min: 0, max: 1, step: 0.01, default: 0.5 },
    cy: { type: "number", label: "Centre (vertical)", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
};
export function loop(params) {
  return 1 / params.speed;
}
export function render(ctx) {
  const { n, x, y, out, colors, params, t } = ctx;
  const a = colors[0] || [0, 1, 0.8];
  const b = colors[1] || [0.05, 0, 0.2];
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(x[i] - params.cx, y[i] - params.cy);
    const k = Math.pow(0.5 + 0.5 * Math.sin(TAU * (d * params.rings - t * params.speed)), 2);
    out.set(mix(b, a, k), i * 3);
  }
}
