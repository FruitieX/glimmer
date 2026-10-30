export const meta = {
  name: "Christmas classic lights",
  description: "Old-fashioned multicolour Christmas bulbs that glow, fade and twinkle.",
  category: "Seasonal",
  colors: [
    { id: "red", label: "Red", default: "#ff2a0a" },
    { id: "green", label: "Green", default: "#14d23c" },
    { id: "blue", label: "Blue", default: "#2350ff" },
    { id: "amber", label: "Amber", default: "#ffa514" },
  ],
  params: {
    mode: {
      type: "select",
      label: "Pattern",
      options: ["twinkle", "glow", "chase", "steady"],
      labels: ["Twinkle", "Slow glow", "Chase", "Steady"],
      default: "twinkle",
    },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 0.6 },
    depth: { type: "number", label: "Dimming", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
};

const PERIOD = 24;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, u, out, colors, params, t } = ctx;
  const p = (t * params.speed) / PERIOD;
  const depth = params.depth;
  const mode = params.mode;
  const nc = colors.length || 1;
  for (let i = 0; i < n; i++) {
    // Each LED is one bulb; the colours repeat along the wire.
    const bulb = Math.round(u[i] * (n - 1));
    const c = colors[bulb % nc] || [1, 0.6, 0.1];
    let k = 1;
    if (mode === "twinkle") {
      // Every bulb breathes on its own; a few dip right down now and then.
      const cyc = 2 + Math.floor(hash(bulb, 1) * 4);
      const w = 0.5 + 0.5 * Math.cos(TAU * (p * cyc + hash(bulb, 2)));
      const deep = hash(bulb, 3) < 0.3 ? 1 : 0.55;
      k = 1 - depth * deep * Math.pow(w, 3);
    } else if (mode === "glow") {
      // Colour groups take turns fading, like an old eight-function controller.
      const w = 0.5 + 0.5 * Math.cos(TAU * (p * 6 - (bulb % nc) / nc));
      k = 1 - depth * w * w;
    } else if (mode === "chase") {
      const w = 0.5 + 0.5 * Math.cos(TAU * (u[i] * 4 - p * 12));
      k = 1 - depth * w * w;
    }
    // Dimming incandescent bulbs turn warmer.
    const o = i * 3;
    out[o] = c[0] * k;
    out[o + 1] = c[1] * Math.pow(k, 1.3);
    out[o + 2] = c[2] * Math.pow(k, 1.6);
  }
}
