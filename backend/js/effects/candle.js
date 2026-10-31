export const meta = {
  name: "Candlelight",
  description: "Warm, gently flickering light, each LED on its own flame.",
  category: "Basics",
  colors: [{ id: "flame", label: "Flame", default: "#ff9329" }],
  params: {
    flicker: { type: "number", label: "Flicker", min: 0, max: 1, step: 0.01, default: 0.35 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
  },
  looks: [
    { name: "Warm white", params: { flicker: 0.15 }, colors: ["#ffb060"] },
    { name: "Firelight", params: { flicker: 0.6, speed: 1.5 }, colors: ["#ff6a10"] },
    { name: "Gaslight", params: { flicker: 0.08, speed: 0.5 }, colors: ["#ffd080"] },
    { name: "Draughty", params: { flicker: 0.9, speed: 2.2 }, colors: ["#ff8a20"] },
  ],
};
export function render(ctx) {
  const { n, out, colors, params, t } = ctx;
  const c = colors[0] || [1, 0.58, 0.16];
  for (let i = 0; i < n; i++) {
    const f = noise(i * 0.37, t * 2.2 * params.speed) * 0.5 + noise(i * 1.7, t * 7 * params.speed) * 0.25;
    const k = clamp(1 - params.flicker * (0.5 - f));
    out[i * 3] = c[0] * k;
    out[i * 3 + 1] = c[1] * k * k;
    out[i * 3 + 2] = c[2] * k * k * k;
  }
}
