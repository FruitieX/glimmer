export const meta = {
  name: "Christmas advent candles",
  description: "Four advent candles on an evergreen wreath; light one more each Sunday. Calm, softly flickering flames.",
  category: "Seasonal",
  colors: [
    { id: "candle", label: "Candles", default: "#c8102a" },
    { id: "flame", label: "Flame", default: "#ffa83a" },
    { id: "wreath", label: "Wreath", default: "#0a6a26" },
    { id: "berries", label: "Berries", default: "#ff2020" },
    { id: "night", label: "Background", default: "#05030c" },
  ],
  params: {
    lit: { type: "number", label: "Candles lit", min: 0, max: 4, step: 1, default: 4 },
    flicker: { type: "number", label: "Flicker", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
  },
  looks: [
    { name: "White candles", params: { flicker: 0.3 }, colors: ["#ffd8a0", "#ffb040", "#0a7a2a", "#ff1818", "#04030a"] },
    { name: "Lilac advent", params: {}, colors: ["#9a30ff", "#ffa040", "#0a6a26", "#ff40a0", "#06030e"] },
    { name: "Gold", params: { flicker: 0.7, speed: 1.3 }, colors: ["#ffc030", "#ffd070", "#0a5a20", "#ff2010", "#05030a"] },
    { name: "Two lit", params: { lit: 2, flicker: 0.4, speed: 0.7 }, colors: ["#e00a20", "#ff9030", "#0a6a26", "#ffd020", "#04020a"] },
  ],
};

const PERIOD = 30;
const CX = [1 / 9, 3 / 9, 6 / 9, 8 / 9];
// The first candle has burnt the longest.
const TOP = [0.42, 0.47, 0.52, 0.56];

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const s = { wide: aspect > 2.5, cand: new Int8Array(n), along: new Float32Array(n), shade: new Float32Array(n), berry: new Uint8Array(n), fl: new Float32Array(4), sway: new Float32Array(4) };
  for (let i = 0; i < n; i++) {
    s.berry[i] = hash(i, 5) < 0.14 ? 1 : 0;
    s.shade[i] = 0.6 + 0.4 * hash(i, 6);
    if (s.wide) {
      // Four candles share the string (repeated on long strings).
      const groups = Math.max(1, Math.round(n / 120));
      const q = fract(u[i] * groups) * 4;
      s.cand[i] = Math.floor(q);
      s.along[i] = q - Math.floor(q) - 0.5; // -0.5..0.5 within its candle's stretch
    } else {
      let best = 0, bd = 9;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(x[i] - CX[c]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      s.cand[i] = best;
      s.along[i] = x[i] - CX[best];
    }
  }
  return s;
}

export function render(ctx, s) {
  const { n, y, out, colors, params, t, aspect, spacing } = ctx;
  const wax = colors[0] || [0.78, 0.06, 0.16];
  const flame = colors[1] || [1, 0.66, 0.23];
  const wreath = colors[2] || [0.04, 0.42, 0.15];
  const berry = colors[3] || [1, 0.12, 0.12];
  const night = colors[4] || [0.02, 0.01, 0.05];
  const p = (t * params.speed) / PERIOD;
  const lit = params.lit;
  const f = params.flicker;
  for (let c = 0; c < 4; c++) {
    // Each flame breathes slowly and wavers quickly, all whole cycles per loop.
    const slow = Math.sin(TAU * (p * (5 + c) + hash(c, 1)));
    const quick = Math.sin(TAU * (p * (47 + 7 * c) + hash(c, 2))) * Math.sin(TAU * (p * (29 + 3 * c) + hash(c, 3)));
    s.fl[c] = c < lit ? 1 - f * (0.12 + 0.1 * slow + 0.12 * quick) : 0;
    s.sway[c] = f * (0.4 * Math.sin(TAU * (p * (11 + c) + hash(c, 4))) + 0.2 * quick);
  }
  if (s.wide) {
    for (let i = 0; i < n; i++) {
      const c = s.cand[i];
      const a = s.along[i];
      const k = s.fl[c];
      // A bright flame in the middle, the candle glowing either side of it,
      // greenery in the gaps.
      const fd = (a - s.sway[c] * 0.04) / 0.07;
      const fk = k * Math.exp(-fd * fd);
      const body = smoothstep(0.3, 0.24, Math.abs(a));
      const bodyK = body * (0.3 + 0.55 * k * Math.exp(-a * a * 12));
      let r = night[0], g = night[1], b = night[2];
      const gk = (1 - body) * s.shade[i] * 0.45;
      if (s.berry[i] && body < 0.5) {
        r = berry[0] * 0.6;
        g = berry[1] * 0.6;
        b = berry[2] * 0.6;
      } else {
        r += wreath[0] * gk;
        g += wreath[1] * gk;
        b += wreath[2] * gk;
      }
      r += (wax[0] * bodyK - r) * body;
      g += (wax[1] * bodyK - g) * body;
      b += (wax[2] * bodyK - b) * body;
      r += (1 - r) * fk * flame[0];
      g += (1 - g) * fk * flame[1] * fk;
      b += (1 - b) * fk * flame[2] * fk * fk;
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  const soft = Math.max(spacing * 0.6, 0.02);
  for (let i = 0; i < n; i++) {
    const c = s.cand[i];
    const a = s.along[i] * aspect;
    const yi = y[i];
    const top = TOP[c];
    const k = s.fl[c];
    let r = night[0], g = night[1], b = night[2];
    // Room glow from all lit flames.
    let glow = 0;
    for (let j = 0; j < 4; j++) {
      if (s.fl[j] <= 0) continue;
      const dx = (CX[j] - (s.along[i] + CX[c])) * aspect, dy = yi - TOP[j] - 0.1;
      glow += s.fl[j] * 0.07 * Math.exp(-(dx * dx + dy * dy) * 14);
    }
    r += flame[0] * glow;
    g += flame[1] * glow * 0.8;
    b += flame[2] * glow * 0.5;
    // The candle, lit from above by its own flame.
    const body = smoothstep(0.075, 0.045, Math.abs(a)) * smoothstep(top + soft, top - soft, yi) * smoothstep(0.06, 0.1, yi);
    if (body > 0) {
      const lightK = 0.35 + 0.65 * k * Math.exp(-(top - yi) * 7);
      r += (wax[0] * lightK - r) * body;
      g += (wax[1] * lightK - g) * body;
      b += (wax[2] * lightK - b) * body;
    }
    // The flame: a teardrop above the wick, swaying a little.
    if (k > 0) {
      const fx = (a - s.sway[c] * 0.03 * clamp((yi - top) / 0.15)) / 0.045;
      const fy = (yi - top - 0.065) / (0.075 * (0.85 + 0.25 * k));
      const d = fx * fx * (fy > 0 ? 1 + fy * 1.5 : 1) + fy * fy;
      const fk = clamp(k * 1.25 * Math.exp(-d * 0.9));
      // Orange edges, a pale yellow heart.
      const hot = fk * fk;
      r += (1 - r) * fk * flame[0];
      g += (1 - g) * fk * (flame[1] + (0.95 - flame[1]) * hot);
      b += (1 - b) * fk * (flame[2] + (0.6 - flame[2]) * hot) * fk;
    }
    // The wreath along the bottom.
    const wr = smoothstep(0.15, 0.08, yi);
    if (wr > 0) {
      if (s.berry[i]) {
        r += (berry[0] * 0.7 - r) * wr;
        g += (berry[1] * 0.7 - g) * wr;
        b += (berry[2] * 0.7 - b) * wr;
      } else {
        const gk = s.shade[i] * 0.55 + glow;
        r += (wreath[0] * gk - r) * wr;
        g += (wreath[1] * gk - g) * wr;
        b += (wreath[2] * gk - b) * wr;
      }
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
