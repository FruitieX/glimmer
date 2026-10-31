export const meta = {
  name: "Halloween jack-o'-lantern",
  description: "The warm, flickering glow of a candle inside a carved pumpkin.",
  category: "Seasonal",
  colors: [
    { id: "flame", label: "Candle", default: "#ffc04a" },
    { id: "glow", label: "Pumpkin", default: "#ff5a00" },
    { id: "shadow", label: "Shadows", default: "#2b0a3d" },
  ],
  params: {
    flicker: { type: "number", label: "Flicker", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Flicker speed", min: 0.2, max: 2, step: 0.01, default: 1 },
    glow: { type: "number", label: "Glow size", min: 0.2, max: 1.5, step: 0.01, default: 0.75 },
    shadows: { type: "number", label: "Shadows", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Grinning", params: { flicker: 0.8, speed: 1.4, glow: 1.2, shadows: 0.2 }, colors: ["#fff080", "#ff8a00", "#300a40"] },
    { name: "Embers", params: { flicker: 0.3, speed: 0.6, glow: 0.5 }, colors: ["#ff9a30", "#d02000", "#200418"] },
    { name: "Ghostfire", params: { glow: 1 }, colors: ["#d0ff70", "#30e020", "#14063a"] },
    { name: "Haunted", params: { flicker: 0.9, glow: 1.1, shadows: 0.6 }, colors: ["#ffc0ff", "#b030ff", "#06021a"] },
  ],
};

const PERIOD = 24;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const flame = colors[0] || [1, 0.75, 0.29];
  const glow = colors[1] || [1, 0.35, 0];
  const shadow = colors[2] || [0.17, 0.04, 0.24];
  const wide = aspect > 2.5;
  // Time runs round a circle in noise space so the flicker loops seamlessly.
  const th = (TAU * t * params.speed) / PERIOD;
  const c = Math.cos(th), s = Math.sin(th);
  const R = 11;
  const slow = noise(c * R * 0.25 + 3.1, s * R * 0.25 + 7.7, 0.5);
  const fast = noise(c * R + 11.3, s * R + 2.9, 4.5);
  const k = clamp(1 - params.flicker * (0.35 - 0.45 * slow - 0.3 * fast), 0.2, 1.2);
  // The flame sways, so the bright spot wanders a little.
  const cx = 0.5 + 0.08 * noise(c * 2 + 5, s * 2 + 1, 9) * params.flicker;
  const cy = 0.22;
  const size = params.glow;
  for (let i = 0; i < n; i++) {
    let d;
    if (wide) d = Math.abs(x[i] - cx) * 1.6;
    else {
      const dx = (x[i] - cx) * 1.2, dy = y[i] - cy;
      d = Math.sqrt(dx * dx + dy * dy);
    }
    // Light falls off from the candle; the shell gets darker away from it.
    const light = clamp((k * size) / (size + d * d * 4.5) - d * 0.15);
    // Slow crawling shadows from the uneven carved shell.
    const sh = noise(x[i] * 3 + c * 1.5, y[i] * 2.5 + s * 1.5, 2) * 0.5 + 0.5;
    const dark = params.shadows * smoothstep(0.35, 0.8, sh);
    const lit = light * (1 - dark * 0.7);
    const heat = clamp(lit * lit * 1.3);
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const warm = glow[ch] + (flame[ch] - glow[ch]) * heat;
      out[o + ch] = warm * lit + shadow[ch] * (1 - lit) * (0.35 + 0.4 * dark);
    }
  }
}
