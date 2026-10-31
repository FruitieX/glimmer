export const meta = {
  name: "New Year countdown sparkle",
  description: "Ten golden steps light up one per second with sparkles building, then midnight bursts into colour and drifting glitter.",
  category: "Seasonal",
  colors: [
    { id: "gold", label: "Countdown", default: "#ffc23a" },
    { id: "burst1", label: "Burst", default: "#ff3c8c" },
    { id: "burst2", label: "Burst 2", default: "#3cc8ff" },
    { id: "sparkle", label: "Sparkles", default: "#fff6e0" },
    { id: "sky", label: "Sky", default: "#04041a" },
  ],
  params: {
    tempo: { type: "number", label: "Tempo", min: 0.5, max: 2, step: 0.01, default: 1 },
    sparkle: { type: "number", label: "Sparkles", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  looks: [
    { name: "Silver", params: {}, colors: ["#e0ecff", "#a060ff", "#40e0ff", "#ffffff", "#020414"] },
    { name: "Fiery", params: { tempo: 1.3, sparkle: 0.8 }, colors: ["#ff8a20", "#ff2040", "#ffd000", "#fff0d0", "#0a0204"] },
    { name: "Neon", params: { sparkle: 0.9 }, colors: ["#ff40d0", "#40ff80", "#ffe020", "#ffffff", "#060114"] },
    { name: "Calm", params: { tempo: 0.7, sparkle: 0.3 }, colors: ["#ffd030", "#ffb0c0", "#a0d0ff", "#fff8e8", "#030318"] },
  ],
};

// Ten seconds of countdown, then ten of celebration.
const PERIOD = 20;
const SLOTS = 120;

export function loop(params) {
  return PERIOD / params.tempo;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { seg: new Float32Array(n), dist: new Float32Array(n), ang: new Float32Array(n), off: new Float32Array(n), hue: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    // Ten steps: columns on a curtain, stretches along a string.
    s.seg[i] = wide ? u[i] * 10 : x[i] * 9.999;
    if (wide) {
      s.dist[i] = Math.abs(u[i] - 0.5) * 2;
      s.ang[i] = u[i] < 0.5 ? 0 : 0.5;
    } else {
      const dx = (x[i] - 0.5) * aspect, dy = y[i] - 0.5;
      s.dist[i] = Math.sqrt(dx * dx + dy * dy) * 1.8;
      s.ang[i] = Math.atan2(dy, dx) / TAU + 0.5;
    }
    s.off[i] = hash(i, 1) * SLOTS;
    s.hue[i] = hash(i, 2);
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const gold = colors[0] || [1, 0.76, 0.23];
  const b1 = colors[1] || [1, 0.24, 0.55];
  const b2 = colors[2] || [0.24, 0.78, 1];
  const sp = colors[3] || [1, 0.96, 0.88];
  const sky = colors[4] || [0.02, 0.02, 0.1];
  const sec = (t * params.tempo) % PERIOD; // "seconds" into the cycle
  const p = sec / PERIOD;
  const counting = sec < 10;
  // Sparkles build up during the countdown, then a gentle glitter after.
  const dens = params.sparkle * (counting ? 0.02 + 0.12 * (sec / 10) : 0.2 * Math.exp(-(sec - 10) * 0.15));
  const beat = counting ? Math.exp(-(sec - Math.floor(sec)) * 4) : 0;
  const ts = sec - 10;
  const ringR = ts * 0.4;
  const fadeOut = counting ? 0 : Math.exp(-ts * 0.45);
  for (let i = 0; i < n; i++) {
    let r = sky[0], g = sky[1], b = sky[2];
    const seg = s.seg[i];
    const si = Math.floor(seg);
    if (counting) {
      // Each step lights on its second; the newest one glows brightest.
      const on = clamp((sec - si) * 5);
      if (on > 0) {
        const fresh = si === Math.floor(sec) ? 0.5 * beat : 0;
        const edge = smoothstep(0, 0.12, seg - si) * smoothstep(1, 0.88, seg - si);
        const k = on * (0.45 + 0.15 * edge + fresh);
        r += (gold[0] - r) * k;
        g += (gold[1] - g) * k;
        b += (gold[2] - b) * k;
      }
    } else {
      // Midnight: the gold flashes out into an expanding ring of colour.
      const d = s.dist[i];
      // Two rings, the second a moment behind the first, and an afterglow.
      const ring1 = Math.exp(-Math.pow((d - ringR) / 0.2, 2)) * Math.exp(-ts * 0.3);
      const d2 = d - (ts - 1.2) * 0.4;
      const ring2 = ts > 1.2 ? Math.exp(-d2 * d2 / 0.03) * Math.exp(-(ts - 1.2) * 0.35) * 0.7 : 0;
      const ring = ring1 + ring2;
      const flash = Math.exp(-ts * 3) * 0.35 + Math.exp(-ts * 0.4) * 0.12;
      const c = 0.5 + 0.5 * Math.sin(TAU * (s.ang[i] * 3 + ts * 0.2));
      const glow = clamp(ring + flash);
      r += (b1[0] + (b2[0] - b1[0]) * c - r) * glow;
      g += (b1[1] + (b2[1] - b1[1]) * c - g) * glow;
      b += (b1[2] + (b2[2] - b1[2]) * c - b) * glow;
      // Gold steps fading away.
      const gk = 0.45 * Math.exp(-ts * 2.5);
      r += gold[0] * gk;
      g += gold[1] * gk;
      b += gold[2] * gk;
    }
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    if (hash(i * 61 + (slot % SLOTS), 3) < dens) {
      const f = q - slot;
      const k = f < 0.15 ? f / 0.15 : Math.exp(-(f - 0.15) * 5);
      // After midnight the glitter takes the burst colours.
      const h = s.hue[i];
      const cr = counting ? sp : h < 0.33 ? b1 : h < 0.66 ? b2 : gold;
      const kk = k * (counting ? 1 : 0.6 + 0.4 * fadeOut);
      r += (cr[0] - r) * kk;
      g += (cr[1] - g) * kk;
      b += (cr[2] - b) * kk;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
