export const meta = {
  name: "Winter frost",
  description: "Icy frost patterns with crystals catching the light and glinting.",
  category: "Seasonal",
  colors: [
    { id: "deep", label: "Ice", default: "#0a2f66" },
    { id: "frost", label: "Frost", default: "#9fdcff" },
    { id: "glint", label: "Glints", default: "#f4fbff" },
  ],
  params: {
    glints: { type: "number", label: "Glints", min: 0, max: 1, step: 0.01, default: 0.35 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    frost: { type: "number", label: "Frost", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  looks: [
    { name: "Glacier", params: { glints: 0.2, speed: 0.6, frost: 0.8 }, colors: ["#002a50", "#40e0ff", "#e0ffff"] },
    { name: "Diamond dust", params: { glints: 0.8, speed: 1.5 }, colors: ["#081040", "#5a9aff", "#ffffff"] },
    { name: "Violet frost", params: { frost: 0.5 }, colors: ["#1a0a50", "#a060ff", "#f8f0ff"] },
    { name: "Sunrise frost", params: { glints: 0.5, speed: 0.8 }, colors: ["#2a0a40", "#ff80b0", "#fff4e0"] },
  ],
};

const PERIOD = 32;
const SLOTS = 40;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const deep = colors[0] || [0.04, 0.18, 0.4];
  const frost = colors[1] || [0.62, 0.86, 1];
  const glint = colors[2] || [0.96, 0.98, 1];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const th = TAU * p;
  const cx = Math.cos(th) * 0.6, cy = Math.sin(th) * 0.6;
  const fx = wide ? Math.min(aspect, 12) * 0.5 : 2.4;
  for (let i = 0; i < n; i++) {
    const xi = x[i] * fx, yi = y[i] * 2.4;
    // Ridged noise makes branching, crystalline veins.
    const v = 1 - Math.abs(noise(xi + cx, yi + cy, 0.3));
    const v2 = v * v;
    const fk = clamp(v2 * v2 * v2 * params.frost * 1.3);
    // Glints: each LED catches the light now and then, quickly and briefly.
    const slot = fract(p * SLOTS + hash(i, 5));
    const s = Math.floor(p * SLOTS + hash(i, 5));
    let g = 0;
    if (hash(i * 131 + (s % SLOTS), 9) < params.glints * (0.3 + fk)) {
      g = slot < 0.08 ? slot / 0.08 : Math.exp(-(slot - 0.08) * 9);
      g *= g;
    }
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const base = deep[ch] * 0.5 + (frost[ch] - deep[ch] * 0.5) * fk;
      out[o + ch] = base + (glint[ch] - base) * g;
    }
  }
}
