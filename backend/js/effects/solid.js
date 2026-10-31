export const meta = {
  name: "Solid",
  description: "One steady colour, optionally breathing gently.",
  category: "Basics",
  colors: [{ id: "primary", label: "Colour", default: "#ffb46b" }],
  params: {
    breathe: { type: "number", label: "Breathing", min: 0, max: 1, step: 0.01, default: 0 },
    period: { type: "number", label: "Breath length (s)", min: 2, max: 20, step: 0.5, default: 6 },
  },
  looks: [
    { name: "Candle", params: { breathe: 0.3, period: 8 }, colors: ["#ff8a2a"] },
    { name: "Ice", params: {}, colors: ["#a0e0ff"] },
    { name: "Rose", params: { breathe: 0.5, period: 5 }, colors: ["#ff3a7a"] },
    { name: "Lagoon", params: { breathe: 0.6, period: 12 }, colors: ["#00e0c0"] },
  ],
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
