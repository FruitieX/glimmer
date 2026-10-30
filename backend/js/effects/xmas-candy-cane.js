export const meta = {
  name: "Christmas candy cane",
  description: "Red and white candy-cane stripes spiralling round and round.",
  category: "Seasonal",
  colors: [
    { id: "red", label: "Stripe", default: "#ff0a1e" },
    { id: "white", label: "Cane", default: "#fff0e6" },
    { id: "accent", label: "Pinstripe", default: "#18b048" },
  ],
  params: {
    stripes: { type: "number", label: "Stripes", min: 1, max: 8, step: 1, default: 3 },
    speed: { type: "number", label: "Speed", min: 0, max: 2, step: 0.01, default: 0.4 },
    tilt: { type: "number", label: "Tilt", min: -1.5, max: 1.5, step: 0.05, default: 0.5 },
    pinstripe: { type: "boolean", label: "Pinstripes", default: false },
  },
};

export function loop(params) {
  return params.speed > 0 ? 1 / params.speed : 1;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, spacing, aspect } = ctx;
  const red = colors[0] || [1, 0.04, 0.12];
  const white = colors[1] || [1, 0.94, 0.9];
  const accent = colors[2] || [0.1, 0.7, 0.3];
  // Stripes stack up the height; along a long string they repeat every
  // handful of LEDs instead.
  const wide = aspect > 2.5;
  const sn = wide ? params.stripes * Math.max(1, Math.round(aspect / 3)) : params.stripes;
  const ph = t * params.speed;
  const soft = Math.max(spacing * sn * 0.6, 0.03);
  const pin = params.pinstripe;
  for (let i = 0; i < n; i++) {
    // Diagonal coordinate; whole stripes per unit, so it wraps cleanly.
    const s = fract((wide ? x[i] : y[i] + x[i] * params.tilt) * sn - ph);
    // Red covers the first half, the cane colour the second, with soft borders.
    const k = clamp(smoothstep(-soft, soft, s) - smoothstep(0.5 - soft, 0.5 + soft, s) + smoothstep(1 - soft, 1 + soft, s));
    let g = 0;
    if (pin) {
      // A thin green line in the middle of each white band.
      const d = (s - 0.75) / (soft * 0.8 + 0.02);
      g = Math.exp(-d * d) * 0.75;
    }
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const c = white[ch] * 0.8 + (red[ch] - white[ch] * 0.8) * k;
      out[o + ch] = c + (accent[ch] - c) * g;
    }
  }
}
