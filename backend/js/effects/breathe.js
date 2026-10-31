export const meta = {
  name: "Colour cycle",
  description: "The whole string slowly breathes through the chosen colours.",
  category: "Basics",
  colors: [
    { id: "a", label: "First", default: "#ff006e" },
    { id: "b", label: "Second", default: "#8338ec" },
    { id: "c", label: "Third", default: "#3a86ff" },
  ],
  params: {
    period: { type: "number", label: "Seconds per colour", min: 1, max: 60, step: 0.5, default: 8 },
    spread: { type: "number", label: "Spread along string", min: 0, max: 1, step: 0.01, default: 0.15 },
  },
  looks: [
    { name: "Sunset", params: { period: 12 }, colors: ["#ff3000", "#ff8000", "#d0106a"] },
    { name: "Ocean", params: { spread: 0.4 }, colors: ["#0060ff", "#00c8d0", "#20ffa0"] },
    { name: "Forest", params: { period: 15 }, colors: ["#20ff40", "#a0ff00", "#00a060"] },
    { name: "Party", params: { period: 2, spread: 0.6 }, colors: ["#ff0080", "#ffb000", "#8000ff"] },
    { name: "Hearth", params: { period: 20, spread: 0.05 }, colors: ["#ff8a20", "#ffb050", "#ff5010"] },
  ],
};
export function loop(params, colors) {
  return params.period * Math.max(colors.length, 1);
}
export function render(ctx) {
  const { n, u, out, colors, params, t } = ctx;
  const cols = colors.length ? colors : [[1, 0, 0.4]];
  for (let i = 0; i < n; i++) {
    const p = t / (params.period * cols.length) + u[i] * params.spread;
    out.set(palette(cols, p, true), i * 3);
  }
}
