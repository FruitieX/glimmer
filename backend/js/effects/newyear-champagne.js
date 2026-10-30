export const meta = {
  name: "New Year champagne",
  description: "Golden champagne with streams of rising bubbles and midnight sparkles.",
  category: "Seasonal",
  colors: [
    { id: "wine", label: "Champagne", default: "#c98a1e" },
    { id: "bubble", label: "Bubbles", default: "#fff2c4" },
    { id: "sparkle", label: "Sparkles", default: "#fff8e8" },
  ],
  params: {
    bubbles: { type: "number", label: "Bubbles", min: 2, max: 40, step: 1, default: 14 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    sparkle: { type: "number", label: "Sparkle", min: 0, max: 1, step: 0.01, default: 0.4 },
    glow: { type: "number", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.55 },
  },
};

const PERIOD = 30;
const SLOTS = 45;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const wine = colors[0] || [0.79, 0.54, 0.12];
  const bubble = colors[1] || [1, 0.95, 0.77];
  const sparkle = colors[2] || [1, 1, 1];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const gl = params.glow;
  for (let i = 0; i < n; i++) {
    // Deeper gold at the bottom of the glass, paler near the surface.
    const h = wide ? 0.5 : y[i];
    const swirl = 0.8 + 0.2 * Math.sin(TAU * (p * 3 + x[i] * 1.5 - h));
    const k = gl * (0.5 + 0.5 * h) * swirl;
    // Sparkles: brief twinkles here and there.
    const ph = p * SLOTS + hash(i, 4);
    const sl = Math.floor(ph) % SLOTS;
    const f = ph - Math.floor(ph);
    let s = 0;
    if (hash(i * 53 + sl, 8) < params.sparkle * 0.08) s = Math.pow(Math.sin(f * PI), 6);
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const base = wine[ch] * k * (0.7 + 0.3 * h);
      out[o + ch] = base + (sparkle[ch] * 0.9 - base) * s;
    }
  }
  const r = wide ? Math.max(spacing * 1.6, 0.008) : Math.max(spacing * 0.8, 0.035);
  for (let b = 0; b < params.bubbles; b++) {
    // Bubbles rise in a few streams, wobbling as they go.
    const stream = Math.floor(hash(b, 1) * 6);
    const laps = 5 + Math.floor(hash(b, 2) * 5);
    const life = fract(p * laps + hash(b, 3));
    const wob = Math.sin(TAU * (p * laps * 4 + hash(b, 5)));
    let bx, by, fade;
    if (wide) {
      bx = fract(hash(stream, 6) + life * 0.12) + wob * 0.004;
      by = 0.5;
      fade = Math.sin(PI * life);
    } else {
      bx = 0.08 + 0.84 * hash(stream, 6) + wob * 0.03;
      by = -0.05 + life * 1.15;
      fade = smoothstep(1.1, 0.9, by) * smoothstep(0, 0.08, life);
    }
    // Bubbles grow a little as they rise.
    const rr = r * (0.8 + 0.4 * life);
    const rxx = wide ? rr : rr * 1.8;
    for (let i = 0; i < n; i++) {
      const ex = (x[i] - bx) / rxx;
      if (ex > 3 || ex < -3) continue;
      const ey = wide ? 0 : (y[i] - by) / rr;
      const d2 = ex * ex + ey * ey;
      if (d2 > 9) continue;
      const a = Math.exp(-d2 * 1.4) * fade * 0.9;
      const o = i * 3;
      out[o] += (bubble[0] - out[o]) * a;
      out[o + 1] += (bubble[1] - out[o + 1]) * a;
      out[o + 2] += (bubble[2] - out[o + 2]) * a;
    }
  }
}
