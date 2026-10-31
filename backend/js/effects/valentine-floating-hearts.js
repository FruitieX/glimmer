export const meta = {
  name: "Valentine floating hearts",
  description: "Pink and red hearts gently beating as they float upwards (or drift along a string) through a warm rosy glow.",
  category: "Seasonal",
  colors: [
    { id: "heart", label: "Hearts", default: "#ff1e50" },
    { id: "heart2", label: "Hearts 2", default: "#ff78b4" },
    { id: "glow", label: "Background", default: "#2a0414" },
  ],
  params: {
    count: { type: "number", label: "Hearts", min: 1, max: 6, step: 1, default: 3 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Size", min: 0.1, max: 0.35, step: 0.01, default: 0.2 },
  },
  looks: [
    { name: "Rose garden", params: { count: 5, speed: 0.6 }, colors: ["#ff0a3c", "#ff4f8a", "#1e0210"] },
    { name: "Candy hearts", params: { speed: 1.4, size: 0.15 }, colors: ["#ff40b0", "#ffa0e0", "#24041c"] },
    { name: "Crimson", params: { count: 2, size: 0.3 }, colors: ["#ff0000", "#ff3a1e", "#200204"] },
    { name: "Lilac love", params: { count: 4, speed: 0.7 }, colors: ["#d040ff", "#ff60c0", "#14041e"] },
  ],
};

const PERIOD = 24;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, u, out, colors, params, t, aspect, spacing } = ctx;
  const h1 = colors[0] || [1, 0.12, 0.31];
  const h2 = colors[1] || [1, 0.47, 0.7];
  const bg = colors[2] || [0.16, 0.02, 0.08];
  const p = (t * params.speed) / PERIOD;
  const wide = aspect > 2.5;
  const count = params.count;
  const R = params.size;
  for (let i = 0; i < n; i++) {
    const glow = 0.7 + 0.3 * Math.sin(TAU * (p * 2 + (wide ? u[i] : y[i]) * 0.8));
    out[i * 3] = bg[0] * glow;
    out[i * 3 + 1] = bg[1] * glow;
    out[i * 3 + 2] = bg[2] * glow;
  }
  if (wide) {
    // Along a string: hearts drift along, each a pair of lobes meeting in a
    // point, beating lub-dub.
    const span = Math.max(1, n - 1);
    const reps = Math.max(1, Math.round(n / 60));
    const total = count * reps;
    for (let h = 0; h < total; h++) {
      const laps = 1 + (h % 2);
      const pos = fract(p * laps * (h % 3 === 2 ? -1 : 1) + h / total) * span;
      const beatPh = fract(p * 18 + hash(h, 2));
      const beat = 1 + 0.15 * (Math.exp(-Math.pow((beatPh - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((beatPh - 0.3) / 0.05, 2)));
      const half = 3.2 * beat; // LEDs
      const c = h % 2 ? h2 : h1;
      const lo = Math.floor(pos - half - 2), hi = Math.ceil(pos + half + 2);
      for (let j = lo; j <= hi; j++) {
        const i = ((j % n) + n) % n;
        const d = Math.abs(j - pos) / half;
        // Two lobes: bright either side of a soft dip in the middle.
        const k = smoothstep(1.1, 0.8, d) * (0.75 + 0.25 * smoothstep(0, 0.5, d));
        if (k <= 0) continue;
        const o = i * 3;
        out[o] += (c[0] - out[o]) * k;
        out[o + 1] += (c[1] - out[o + 1]) * k;
        out[o + 2] += (c[2] - out[o + 2]) * k;
      }
    }
    return;
  }
  const soft = Math.max(spacing * 1.2, 0.04) / R;
  for (let h = 0; h < count; h++) {
    const laps = 2 + (h % 2);
    const ph = fract(p * laps + h / count);
    const hy = -R * 1.5 + ph * (1 + R * 3);
    const hx = 0.5 + (hash(h, 1) - 0.5) * 0.5 + 0.08 * Math.sin(TAU * (p * (5 + h) + hash(h, 3)));
    const beatPh = fract(p * 18 + hash(h, 2));
    const beat = 1 + 0.12 * (Math.exp(-Math.pow((beatPh - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((beatPh - 0.3) / 0.05, 2)));
    const sz = R * (0.8 + 0.4 * hash(h, 4)) * beat;
    const c = h % 2 ? h2 : h1;
    for (let i = 0; i < n; i++) {
      const X = ((x[i] - hx) * aspect) / sz, Y = (y[i] - hy) / sz;
      if (X < -1.6 || X > 1.6 || Y < -1.6 || Y > 1.6) continue;
      // The classic heart curve, (x² + y² − 1)³ − x²y³ ≤ 0, nudged up a touch.
      const yy = Y * 1.1 + 0.15;
      const q = X * X + yy * yy - 1;
      const f = q * q * q - X * X * yy * yy * yy;
      // Deepen the dip between the lobes so it shows on a coarse grid.
      const dip = Math.exp(-(X * X) / 0.07) * smoothstep(0.45, 1.05, yy);
      const k = smoothstep(soft * 2, -soft * 2, f) * (0.8 + 0.2 * clamp(1 - X * X - (yy - 0.3) * (yy - 0.3))) * (1 - dip);
      if (k <= 0) continue;
      const o = i * 3;
      out[o] += (c[0] - out[o]) * k;
      out[o + 1] += (c[1] - out[o + 1]) * k;
      out[o + 2] += (c[2] - out[o + 2]) * k;
    }
  }
}
