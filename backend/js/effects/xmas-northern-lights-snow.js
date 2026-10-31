export const meta = {
  name: "Christmas northern lights",
  description: "Quiet northern lights rippling over a snowy Christmas night while big flakes drift down.",
  category: "Seasonal",
  colors: [
    { id: "aurora", label: "Aurora", default: "#1cff80" },
    { id: "upper", label: "Upper glow", default: "#8a3cff" },
    { id: "snow", label: "Snow", default: "#e8f2ff" },
    { id: "sky", label: "Sky", default: "#020a1e" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 0.7 },
    aurora: { type: "number", label: "Aurora", min: 0, max: 1, step: 0.01, default: 0.7 },
    snow: { type: "number", label: "Snowfall", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Arctic", params: { aurora: 0.9, snow: 0.3 }, colors: ["#00ffb0", "#2060ff", "#e8f8ff", "#010614"] },
    { name: "Crimson aurora", params: { speed: 0.5 }, colors: ["#ff2050", "#a020ff", "#fff0f4", "#0a0214"] },
    { name: "Snowstorm", params: { aurora: 0.6, snow: 0.9, speed: 1.2 }, colors: ["#40ff80", "#40a0ff", "#ffffff", "#020814"] },
    { name: "Emerald", params: { speed: 0.4, aurora: 0.85 }, colors: ["#20ff40", "#00ffd0", "#e0fff0", "#010a0a"] },
  ],
};

const PERIOD = 48;
const FLAKES = 16;
const SLOTS = 24;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const s = { off: new Float32Array(n), fx: new Float32Array(FLAKES), fy: new Float32Array(FLAKES), fs: new Float32Array(FLAKES) };
  for (let i = 0; i < n; i++) s.off[i] = hash(i, 4) * SLOTS;
  return s;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect } = ctx;
  const aur = colors[0] || [0.1, 1, 0.5];
  const up = colors[1] || [0.54, 0.24, 1];
  const snow = colors[2] || [0.9, 0.95, 1];
  const sky = colors[3] || [0.01, 0.04, 0.12];
  const p = (t * params.speed) / PERIOD;
  const amt = params.aurora;
  const wide = aspect > 2.5;

  if (wide) {
    // Along a string: folds of aurora drifting, and flakes glinting as they pass.
    const reps = Math.max(1, n / 120);
    const thr = params.snow * 0.1;
    for (let i = 0; i < n; i++) {
      const xi = u[i] * reps;
      const fold = Math.sin(TAU * (xi * 1.3 + p * 3) + 1.8 * Math.sin(TAU * (xi * 0.6 - p * 2)));
      const ray = 0.5 + 0.5 * Math.sin(TAU * (xi * 7 - p * 9) + 2 * fold);
      const k = amt * (0.25 + 0.6 * (0.5 + 0.5 * fold)) * (0.6 + 0.4 * ray);
      const hue = 0.5 + 0.5 * Math.sin(TAU * (xi * 0.8 + p * 2));
      const m = hue * hue * 0.7;
      let r = sky[0] + (aur[0] + (up[0] - aur[0]) * m) * k;
      let g = sky[1] + (aur[1] + (up[1] - aur[1]) * m) * k;
      let b = sky[2] + (aur[2] + (up[2] - aur[2]) * m) * k;
      const q = p * SLOTS * 4 + s.off[i];
      const slot = Math.floor(q);
      if (hash(i * 71 + (slot % (SLOTS * 4)), 6) < thr) {
        const f = Math.sin(PI * (q - slot));
        const sk = f * f * 0.85;
        r += (snow[0] - r) * sk;
        g += (snow[1] - g) * sk;
        b += (snow[2] - b) * sk;
      }
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }

  const flakes = Math.round(FLAKES * params.snow);
  for (let f = 0; f < flakes; f++) {
    const laps = 2 + (f % 3);
    s.fy[f] = 1.1 - fract(p * laps + hash(f, 1)) * 1.25;
    s.fx[f] = hash(f, 2) + 0.06 * Math.sin(TAU * (p * (4 + f) + hash(f, 3)));
    s.fs[f] = 0.5 + 0.5 * hash(f, 5);
  }
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    // The aurora's bright lower edge waves; above it the light fades upwards.
    const edge = 0.5 + 0.12 * Math.sin(TAU * (xi * 0.9 + p * 2)) + 0.06 * Math.sin(TAU * (xi * 2.3 - p * 3));
    const rel = yi - edge;
    const band = rel < 0 ? Math.exp(-rel * rel * 500) : Math.exp(-rel * 2.6);
    const ray = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(TAU * (xi * 2.6 + p * 5) + 2 * Math.sin(TAU * (xi * 1.1 - p * 3))));
    const k = amt * band * ray;
    const m = clamp(rel * 2.2);
    let r = sky[0] + (aur[0] + (up[0] - aur[0]) * m) * k;
    let g = sky[1] + (aur[1] + (up[1] - aur[1]) * m) * k;
    let b = sky[2] + (aur[2] + (up[2] - aur[2]) * m) * k;
    // Snow-covered ground with the aurora's reflection.
    const ground = smoothstep(0.13, 0.04, yi);
    if (ground > 0) {
      const gr = 0.4 + 0.1 * Math.sin(xi * 13);
      r += (snow[0] * gr + aur[0] * amt * 0.12 - r) * ground;
      g += (snow[1] * gr + aur[1] * amt * 0.12 - g) * ground;
      b += (snow[2] * gr + aur[2] * amt * 0.12 - b) * ground;
    }
    for (let f = 0; f < flakes; f++) {
      const ey = yi - s.fy[f];
      if (ey > 0.08 || ey < -0.08) continue;
      const ex = (xi - s.fx[f]) * aspect;
      const d = (ex * ex + ey * ey) * 800;
      if (d < 4) {
        const sk = Math.exp(-d) * 0.8 * s.fs[f];
        r += (snow[0] - r) * sk;
        g += (snow[1] - g) * sk;
        b += (snow[2] - b) * sk;
      }
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
