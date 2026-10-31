export const meta = {
  name: "New Year glitter",
  description: "Gold and silver glitter twinkling over a midnight-blue sheen that slowly sweeps across. Elegant and calm.",
  category: "Seasonal",
  colors: [
    { id: "gold", label: "Gold", default: "#ffc850" },
    { id: "silver", label: "Silver", default: "#e4ecff" },
    { id: "sheen", label: "Sheen", default: "#3a2a8a" },
    { id: "sky", label: "Background", default: "#05041a" },
  ],
  params: {
    density: { type: "number", label: "Glitter", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    sheen: { type: "number", label: "Sheen", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  looks: [
    { name: "All gold", params: { density: 0.7 }, colors: ["#ffc040", "#fff0b0", "#a03000", "#0a0300"] },
    { name: "Silver frost", params: { speed: 0.6 }, colors: ["#d0e0ff", "#ffffff", "#1a3a8a", "#020818"] },
    { name: "Rose gold", params: { sheen: 0.8 }, colors: ["#ffb080", "#ffd8e8", "#7a2050", "#0c0210"] },
    { name: "Party", params: { density: 0.9, speed: 1.8 }, colors: ["#ffd040", "#e8f0ff", "#8020a0", "#060216"] },
  ],
};

const PERIOD = 30;
const SLOTS = 90;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { d: new Float32Array(n), off: new Float32Array(n), kind: new Float32Array(n), size: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    // Position along the sheen's diagonal sweep.
    s.d[i] = wide ? u[i] * Math.max(1, n / 100) : x[i] * 0.6 + y[i];
    s.off[i] = hash(i, 1) * SLOTS;
    s.kind[i] = hash(i, 2);
    s.size[i] = 0.5 + 0.5 * hash(i, 3);
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const gold = colors[0] || [1, 0.78, 0.31];
  const silver = colors[1] || [0.9, 0.93, 1];
  const sheen = colors[2] || [0.23, 0.16, 0.54];
  const sky = colors[3] || [0.02, 0.02, 0.1];
  const p = (t * params.speed) / PERIOD;
  const thr = params.density * 0.3;
  const sh = params.sheen;
  for (let i = 0; i < n; i++) {
    const d = s.d[i];
    // Two broad bands of sheen sliding by; the glitter is brighter inside them.
    const w1 = 0.5 + 0.5 * Math.cos(TAU * (d * 0.8 - p * 3));
    const w2 = 0.5 + 0.5 * Math.cos(TAU * (d * 1.7 + p * 2));
    const band = w1 * w1 * 0.7 + w2 * w2 * 0.3;
    const bk = sh * (0.25 + 0.75 * band);
    let r = sky[0] + sheen[0] * bk, g = sky[1] + sheen[1] * bk, b = sky[2] + sheen[2] * bk;
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    if (hash(i * 67 + (slot % SLOTS), 5) < thr * (0.5 + band)) {
      const f = q - slot;
      const k = (f < 0.12 ? f / 0.12 : Math.exp(-(f - 0.12) * 4)) * s.size[i];
      const c = s.kind[i] < 0.55 ? gold : silver;
      r += (c[0] - r) * k;
      g += (c[1] - g) * k;
      b += (c[2] - b) * k;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
