export const meta = {
  name: "Fractal Clouds",
  description: "Billowing clouds made of layered fractal noise, lit from one side, drifting over a sky.",
  category: "Fractals",
  colors: [
    { id: "sky", label: "Sky", default: "#0a2a6b" },
    { id: "cloud", label: "Cloud", default: "#9aa7c7" },
    { id: "light", label: "Sunlit edge", default: "#ffd9b0" },
  ],
  params: {
    speed: { type: "number", label: "Wind", min: 0.02, max: 1, step: 0.01, default: 0.15 },
    cover: { type: "number", label: "Cloud cover", min: 0, max: 1, step: 0.01, default: 0.5 },
    scale: { type: "number", label: "Cloud size", min: 0.3, max: 3, step: 0.05, default: 1 },
    octaves: { type: "number", label: "Detail", min: 1, max: 5, step: 1, default: 4 },
  },
  looks: [
    { name: "Sunset", params: {}, colors: ["#2a0a40", "#c04070", "#ffb040"] },
    { name: "Storm", params: { speed: 0.4, cover: 0.8 }, colors: ["#020614", "#3050c0", "#e0e8ff"] },
    { name: "Dawn", params: { cover: 0.35 }, colors: ["#1a1050", "#e080a0", "#ffe0a0"] },
    { name: "Daytime", params: { scale: 1.6, octaves: 3 }, colors: ["#0a50d0", "#e0f0ff", "#ffffff"] },
    { name: "Alien", params: {}, colors: ["#04001a", "#20c0a0", "#d0ff60"] },
  ],
};

// The noise tiles every P units, and the sky drifts exactly P units per loop.
const P = 32;

export function loop(params) {
  return P / 2.2 / params.speed;
}

// Aspect-correct coordinates with the longer side spanning 0..1.
export function setup(ctx) {
  const { n, x, y, aspect } = ctx;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const sx = line || aspect >= 1 ? 1 : aspect, sy = line ? 0 : aspect >= 1 ? 1 / aspect : 1;
  const px = new Float32Array(n), py = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = x[i] * sx; py[i] = y[i] * sy; }
  const table = new Float32Array(P * P);
  for (let i = 0; i < table.length; i++) table[i] = hash(i, 41) * 2 - 1;
  return { px, py, table, ox: new Float32Array(6), oy: new Float32Array(6) };
}

// Smooth value noise that repeats every P units (cheaper than noise()).
function vnoise(tb, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & (P - 1), y0 = (yi & (P - 1)) * P, x1 = (xi + 1) & (P - 1), y1 = ((yi + 1) & (P - 1)) * P;
  const a = tb[y0 + x0], b = tb[y0 + x1], c = tb[y1 + x0], d = tb[y1 + x1];
  return a + (b - a) * fx + (c - a + (d - c - b + a) * fx) * fy;
}

// Fractal Brownian motion: octaves at doubling frequencies, each shifted by
// its own offset.
function fbm(s, x, y, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(s.table, x * f + s.ox[o], y * f + s.oy[o]);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const T = loop(params);
  const ph = (t % T) / T;
  const oct = params.octaves | 0;
  for (let o = 0, f = 1; o < oct; o++, f *= 2) {
    // Every octave drifts the same distance on screen (a whole number of
    // tiles in its own scale), plus a little swirl so the shapes evolve.
    const r = 0.6 * f;
    s.ox[o] = -P * f * ph + r * Math.cos(TAU * ph * (o + 1) + o * 1.7) + o * 11.1;
    s.oy[o] = r * Math.sin(TAU * ph * (o + 1) + o * 1.7) + o * 5.3;
  }
  const sky = colors[0] || [0.05, 0.15, 0.4];
  const cloud = colors[1] || [0.6, 0.65, 0.8];
  const light = colors[2] || [1, 0.85, 0.7];
  const sc = 2.2 / params.scale;
  const lo = 0.2 - params.cover * 0.6;
  for (let i = 0; i < n; i++) {
    const X = s.px[i] * sc, Y = s.py[i] * sc;
    const v = fbm(s, X, Y, oct);
    const d = smoothstep(lo, lo + 0.45, v);
    // Light from the upper left: thinner cloud towards the light means a lit edge.
    const v2 = fbm(s, X - 0.12, Y + 0.18, Math.min(oct, 2));
    const lit = clamp((v - v2) * 4 + 0.25) * d * (1 - d * 0.5);
    const skyK = 0.55 + 0.45 * (1 - s.py[i]);
    const o = i * 3;
    for (let c = 0; c < 3; c++) {
      const base = sky[c] * skyK;
      out[o + c] = (base + (cloud[c] * (0.55 + 0.25 * d) - base) * d + light[c] * lit * 0.8) * 0.85;
    }
  }
}
