export const meta = {
  name: "Solid",
  description: "One steady colour, optionally breathing gently.",
  category: "Basics",
  colors: [{ id: "primary", label: "Colour", default: "#ffb46b" }],
  params: {
    breathe: { type: "number", label: "Breathing", min: 0, max: 1, step: 0.01, default: 0 },
    period: { type: "number", label: "Breath length (s)", min: 2, max: 20, step: 0.5, default: 6 },
  },
};
export function loop(params) {
  return params.period;
}
export function render(ctx) {
  const { n, out, colors, params, t } = ctx;
  const c = colors[0] || [1, 0.7, 0.4];
  const k = 1 - params.breathe * (0.5 - 0.5 * Math.cos((TAU * t) / params.period));
  for (let i = 0; i < n; i++) {
    out[i * 3] = c[0] * k;
    out[i * 3 + 1] = c[1] * k;
    out[i * 3 + 2] = c[2] * k;
  }
}
