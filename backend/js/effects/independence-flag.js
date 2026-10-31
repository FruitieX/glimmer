export const meta = {
  name: "Independence Day flag",
  description: "The blue-cross flag of Finland rippling gently in the wind.",
  category: "Seasonal",
  colors: [
    { id: "blue", label: "Cross", default: "#0a3c9c" },
    { id: "white", label: "Field", default: "#f2f6ff" },
  ],
  params: {
    speed: { type: "number", label: "Wind speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    wave: { type: "number", label: "Waving", min: 0, max: 1, step: 0.01, default: 0.6 },
    brightness: { type: "number", label: "White brightness", min: 0.2, max: 1, step: 0.01, default: 0.75 },
  },
  looks: [
    { name: "Bright", params: { brightness: 0.95 }, colors: ["#1050e0", "#ffffff"] },
    { name: "Moonlit", params: { speed: 0.5, wave: 0.4, brightness: 0.65 }, colors: ["#0a30c0", "#b8d0ff"] },
    { name: "Candlelit", params: { speed: 0.6, brightness: 0.9 }, colors: ["#0a38b0", "#ffe8b8"] },
    { name: "Windy", params: { speed: 2.2, wave: 1 }, colors: ["#0a3cb4", "#f0f4ff"] },
  ],
};

const PERIOD = 12;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const blue = colors[0] || [0, 0.21, 0.5];
  const white = colors[1] || [1, 1, 1];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const wv = params.wave;
  const wb = params.brightness;
  // Flags repeat along a long string; a grid shows one.
  const reps = wide ? Math.max(1, Math.round(aspect / 8)) : 1;
  const soft = Math.max(spacing * reps * 1.2, 0.025);
  for (let i = 0; i < n; i++) {
    const fx = wide ? fract(x[i] * reps) : x[i];
    // Waves travel away from the pole, growing towards the free end.
    const ph = TAU * (fx * 1.3 - p * 4);
    const amp = wv * (0.2 + 0.8 * fx);
    const fy = wide ? 0.85 : y[i] + 0.05 * amp * Math.sin(ph);
    const gx = fx + 0.02 * amp * Math.cos(ph);
    // Nordic cross: 5-3-10 across, 4-3-4 up (18 × 11).
    const vb = smoothstep(5 / 18 - soft, 5 / 18 + soft, gx) * smoothstep(8 / 18 + soft, 8 / 18 - soft, gx);
    const hb = smoothstep(4 / 11 - soft, 4 / 11 + soft, fy) * smoothstep(7 / 11 + soft, 7 / 11 - soft, fy);
    const cross = Math.max(vb, hb);
    // Folds catch the light and fall into shadow.
    const shade = 1 - wv * 0.35 * (0.5 - 0.5 * Math.cos(ph - 0.6));
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const w = white[ch] * wb;
      out[o + ch] = (w + (blue[ch] - w) * cross) * shade;
    }
  }
}
