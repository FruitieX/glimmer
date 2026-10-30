export const meta = {
  name: "Summer sunset",
  description: "The sun sinking into a glittering sea under a glowing evening sky.",
  category: "Seasonal",
  colors: [
    { id: "sun", label: "Sun", default: "#ffd27a" },
    { id: "glow", label: "Sunset glow", default: "#ff5a1f" },
    { id: "sky", label: "Evening sky", default: "#3a1c78" },
    { id: "sea", label: "Sea", default: "#0a2c5c" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Sun size", min: 0.05, max: 0.3, step: 0.01, default: 0.14 },
    shimmer: { type: "number", label: "Shimmer", min: 0, max: 1, step: 0.01, default: 0.6 },
    horizon: { type: "number", label: "Horizon", min: 0.15, max: 0.6, step: 0.01, default: 0.35 },
  },
};

const PERIOD = 60;
const CYCLES = 150; // wave glitter cycles per loop

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const sun = colors[0] || [1, 0.82, 0.48];
  const glow = colors[1] || [1, 0.35, 0.12];
  const sky = colors[2] || [0.23, 0.11, 0.47];
  const sea = colors[3] || [0.04, 0.17, 0.36];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const hz = params.horizon;
  const r = params.size;
  // The sun sinks below the horizon and comes back up once per loop.
  const sh = hz + r * 0.2 + (0.62 - hz) * (0.5 + 0.5 * Math.cos(TAU * p)) - r * 1.6 * (0.5 - 0.5 * Math.cos(TAU * p));
  const up = clamp((sh - hz + r * 1.4) / (0.6 - hz + r)); // 0 when set, 1 when high
  const dusk = 1 - up;
  const sx = 0.5;
  const sr = r * (1 + dusk * 0.25); // larger and redder near the horizon
  const soft = Math.max(spacing * 1.2, 0.03);
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    let rr = 0, gg = 0, bb = 0;
    const glit = 0.5 + 0.5 * Math.sin(TAU * (p * Math.floor(CYCLES * (0.6 + 0.4 * hash(i, 2))) + hash(i, 1)));
    if (wide) {
      // A long string is the horizon itself, the sun in the middle.
      const d = Math.abs(xi - sx);
      const halo = Math.exp(-d * 4) * (0.35 + 0.65 * up);
      const disc = smoothstep(r * 0.5 + soft, r * 0.5 - soft, d) * clamp(up * 1.6);
      const sparkle = params.shimmer * Math.pow(glit, 4) * Math.exp(-d * 3) * 0.6 * (0.3 + up);
      for (let ch = 0; ch < 3; ch++) {
        const base = sky[ch] * 0.35 * (0.4 + up * 0.6) + glow[ch] * halo * 0.9;
        const v = base + (sun[ch] - base) * disc + sun[ch] * sparkle;
        if (ch === 0) rr = v; else if (ch === 1) gg = v; else bb = v;
      }
    } else if (yi >= hz) {
      // Sky: warm near the sun and horizon, cooling to violet above.
      const dx = (xi - sx) * 1.1, dy = yi - sh;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const warm = clamp(Math.exp(-(yi - hz) * (3.5 - up)) * (0.35 + 0.65 * up) + Math.exp(-dist * 4) * 0.6);
      const disc = smoothstep(sr + soft, sr - soft, dist);
      const night = 0.25 + 0.75 * clamp(up + 0.3);
      for (let ch = 0; ch < 3; ch++) {
        const base = (sky[ch] + (glow[ch] - sky[ch]) * warm) * night * (0.55 + 0.45 * warm);
        const sc = sun[ch] + (glow[ch] - sun[ch]) * dusk * 0.6;
        const v = base + (sc - base) * disc;
        if (ch === 0) rr = v; else if (ch === 1) gg = v; else bb = v;
      }
    } else {
      // Sea: a glittering path of light under the sun.
      const depth = (hz - yi) / hz;
      const w = 0.08 + depth * 0.18;
      const dx = (xi - sx) / w;
      const path = Math.exp(-dx * dx) * clamp(up * 1.3 + 0.1);
      const ripple = 0.55 + 0.45 * Math.sin(TAU * (yi * 9 + p * 40) + xi * 5);
      const sparkle = path * (0.3 + params.shimmer * (Math.pow(glit, 3) * 0.9 + ripple * 0.3));
      const lit = Math.exp(-depth * 2) * 0.35 * (0.3 + up);
      for (let ch = 0; ch < 3; ch++) {
        const base = sea[ch] * (0.5 + 0.3 * ripple) * (0.4 + 0.6 * up) + glow[ch] * lit;
        const v = base + (sun[ch] * 0.9 - base) * clamp(sparkle);
        if (ch === 0) rr = v; else if (ch === 1) gg = v; else bb = v;
      }
    }
    const o = i * 3;
    out[o] = rr;
    out[o + 1] = gg;
    out[o + 2] = bb;
  }
}
