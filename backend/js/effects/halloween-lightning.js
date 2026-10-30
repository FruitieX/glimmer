export const meta = {
  name: "Halloween lightning storm",
  description: "Rolling purple storm clouds lit by flickering forks of lightning.",
  category: "Seasonal",
  colors: [
    { id: "bolt", label: "Lightning", default: "#e4dcff" },
    { id: "flash", label: "Cloud flash", default: "#8a5cff" },
    { id: "clouds", label: "Clouds", default: "#4a2575" },
  ],
  params: {
    strikes: { type: "number", label: "Strikes per minute", min: 2, max: 30, step: 1, default: 9 },
    flash: { type: "number", label: "Flash brightness", min: 0.2, max: 1, step: 0.01, default: 0.75 },
    clouds: { type: "number", label: "Cloud brightness", min: 0, max: 1, step: 0.01, default: 0.45 },
    drift: { type: "number", label: "Cloud speed", min: 0, max: 3, step: 1, default: 1 },
  },
};

const PERIOD = 40;

export function loop() {
  return PERIOD;
}

// Brightness of a strike `a` seconds after it starts: a few quick flickers.
function envelope(a) {
  if (a < 0 || a > 1.2) return 0;
  let e = Math.exp(-a / 0.09);
  if (a > 0.16) e = Math.max(e, 0.55 * Math.exp(-(a - 0.16) / 0.07));
  if (a > 0.34) e = Math.max(e, 0.85 * Math.exp(-(a - 0.34) / 0.16));
  return e;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const bolt = colors[0] || [0.9, 0.86, 1];
  const flashC = colors[1] || [0.54, 0.36, 1];
  const cloud = colors[2] || [0.23, 0.11, 0.37];
  const wide = aspect > 2.5;
  const tt = fract(t / PERIOD) * PERIOD;
  const slots = Math.max(1, Math.round((PERIOD * params.strikes) / 60));
  const slotLen = PERIOD / slots;
  // The current strike, and the previous one in case it is still fading.
  const s = Math.floor(tt / slotLen);
  let env = 0, bx = 0.5, seed = 0, reach = 0;
  for (let k = s - 1; k <= s; k++) {
    const kk = (k + slots) % slots;
    const start = (k + 0.1 + 0.6 * hash(kk, 1)) * slotLen;
    const e = envelope(tt - start);
    if (e > env) {
      env = e;
      bx = 0.1 + 0.8 * hash(kk, 2);
      seed = kk;
      reach = 0.6 * hash(kk, 3);
    }
  }
  env *= params.flash;
  const th = (TAU * tt * params.drift) / PERIOD;
  const cx = Math.cos(th) * 0.9, cy = Math.sin(th) * 0.9;
  const w = Math.max(spacing * 1.2, 0.035);
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    // Billowing clouds, thicker towards the top.
    const c1 = noise(xi * 3.1 + cx, yi * 2.4 + cy, 1.7) * 0.5 + 0.5;
    const dens = clamp((c1 * 1.5 - 0.35) * (wide ? 1 : 0.5 + 0.7 * yi));
    const base = params.clouds * (0.2 + 1.8 * dens * dens);
    // The flash lights the clouds near the strike.
    const near = Math.exp(-Math.abs(xi - bx) * (wide ? 3 : 2.2));
    const lit = env * (near * (0.3 + dens * 0.9) + 0.12 * dens);
    // The bolt itself: a jagged line from the clouds downward.
    let b = 0;
    if (env > 0.01) {
      if (wide) {
        const jag = 0.02 * noise(xi * 40 + 0.5, seed * 3.7 + 0.5);
        b = Math.exp(-Math.pow((xi - bx - jag) / (w * 2.5), 2));
      } else if (yi > reach) {
        const path = bx + 0.5 * noise(yi * 3.1 + 0.5, seed * 7.31 + 0.5) + 0.15 * noise(yi * 9.7 + 0.5, seed * 3.1 + 0.5);
        const d = (xi - path) / (w * 2.2);
        b = Math.exp(-d * d) * smoothstep(reach, reach + 0.15, yi);
      }
      b *= env;
    }
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      out[o + ch] = clamp(cloud[ch] * base + flashC[ch] * lit + bolt[ch] * b);
    }
  }
}
