export const meta = {
  name: "Fire",
  description: "Flames licking upwards, hottest at the bottom.",
  colors: [
    { id: "hot", label: "Core", default: "#ffd166" },
    { id: "warm", label: "Flame", default: "#ff5400" },
    { id: "ember", label: "Embers", default: "#6a040f" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    height: { type: "number", label: "Flame height", min: 0.2, max: 1.5, step: 0.01, default: 0.8 },
  },
};
export function render(ctx) {
  const { n, x, y, out, colors, params, t } = ctx;
  const s = t * params.speed;
  const pal = [[0, 0, 0], colors[2] || [0.4, 0, 0.05], colors[1] || [1, 0.3, 0], colors[0] || [1, 0.8, 0.4]];
  for (let i = 0; i < n; i++) {
    const turbulence = noise(x[i] * 5, y[i] * 3 - s * 2.5, s * 0.6) * 0.5 + 0.5;
    const heat = clamp((1 - y[i] / params.height) * 1.3 - turbulence * 0.6 + 0.15);
    out.set(palette(pal, heat), i * 3);
  }
}
