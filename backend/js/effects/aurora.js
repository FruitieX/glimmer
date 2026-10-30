export const meta = {
  name: "Aurora",
  description: "Slow northern-lights curtains drifting sideways.",
  category: "Nature",
  colors: [
    { id: "a", label: "Glow", default: "#2bff88" },
    { id: "b", label: "Edge", default: "#7b2ff7" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0, max: 2, step: 0.01, default: 0.25 },
    intensity: { type: "number", label: "Intensity", min: 0.2, max: 1.5, step: 0.01, default: 1 },
    background: { type: "number", label: "Night sky", min: 0, max: 0.3, step: 0.01, default: 0.04 },
  },
};
export function render(ctx) {
  const { n, x, y, out, colors, params, t } = ctx;
  const s = t * params.speed;
  const a = colors[0] || [0.2, 1, 0.5];
  const b = colors[1] || [0.5, 0.2, 1];
  for (let i = 0; i < n; i++) {
    const band = noise(x[i] * 2.2 + s * 0.4, s * 0.2) * 0.5 + 0.5;
    const ripple = noise(x[i] * 6 - s, y[i] * 2, s * 0.5) * 0.5 + 0.5;
    const height = smoothstep(band - 0.45, band + 0.15, y[i]) * (1 - smoothstep(band + 0.15, band + 0.6, y[i]));
    const k = clamp(height * (0.4 + ripple) * params.intensity);
    const c = mix(a, b, clamp((y[i] - band) * 2 + 0.3));
    out[i * 3] = c[0] * k + params.background * 0.1;
    out[i * 3 + 1] = c[1] * k + params.background * 0.15;
    out[i * 3 + 2] = c[2] * k + params.background * 0.5;
  }
}
