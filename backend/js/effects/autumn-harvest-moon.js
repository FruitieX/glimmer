export const meta = {
  name: "Autumn harvest moon",
  description: "A big amber harvest moon over a dark spruce treeline, thin clouds drifting across it on a still autumn night.",
  category: "Seasonal",
  colors: [
    { id: "moon", label: "Moon", default: "#ffa040" },
    { id: "sky", label: "Sky", default: "#0a0a28" },
    { id: "clouds", label: "Clouds", default: "#5a4a6a" },
    { id: "trees", label: "Treeline", default: "#020403" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 0.6 },
    clouds: { type: "number", label: "Clouds", min: 0, max: 1, step: 0.01, default: 0.5 },
    size: { type: "number", label: "Moon size", min: 0.15, max: 0.4, step: 0.01, default: 0.26 },
  },
  looks: [
    { name: "Blood moon", params: { size: 0.32 }, colors: ["#ff4a20", "#12040e", "#6a2a3a", "#030102"] },
    { name: "Silver moon", params: { clouds: 0.3 }, colors: ["#fff0d0", "#040a24", "#4a5a7a", "#010203"] },
    { name: "Misty", params: { speed: 0.4, clouds: 0.85 }, colors: ["#ffc060", "#0c0a20", "#6a5a80", "#020403"] },
    { name: "Golden", params: { clouds: 0.2, size: 0.36 }, colors: ["#ffc020", "#100a20", "#5a4060", "#020302"] },
  ],
};

const PERIOD = 60;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { wide, tree: new Float32Array(n), star: new Float32Array(n), ph: new Float32Array(n), c: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    s.ph[i] = hash(i, 2);
    s.star[i] = hash(i, 1) < 0.1 ? 0.25 + 0.4 * hash(i, 3) : 0;
    s.c[i] = wide ? (u[i] * (n - 1)) / 30 : x[i] * aspect * 2;
    if (wide) continue;
    // Spruce tops: a jagged edge, each spire its own height.
    const height = 0.07 + 0.2 * hash(Math.round(x[i] * 40), 4);
    s.tree[i] = smoothstep(height + 0.03, height - 0.02, y[i]);
  }
  return s;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect, spacing } = ctx;
  const moon = colors[0] || [1, 0.63, 0.25];
  const sky = colors[1] || [0.04, 0.04, 0.16];
  const cloud = colors[2] || [0.35, 0.29, 0.42];
  const trees = colors[3] || [0.01, 0.02, 0.01];
  const p = (t * params.speed) / PERIOD;
  const R = params.size;
  const ck = params.clouds;
  const soft = Math.max(spacing, 0.03);
  const drift = p * 3;
  for (let i = 0; i < n; i++) {
    let dm;
    if (s.wide) dm = Math.abs(u[i] - 0.5) * ((n - 1) / 40);
    else {
      const dx = (x[i] - 0.55) * aspect, dy = y[i] - 0.6;
      dm = Math.sqrt(dx * dx + dy * dy);
    }
    let r = sky[0], g = sky[1], b = sky[2];
    // Stars, hidden near the bright moon.
    const st = s.star[i] * smoothstep(R * 1.3, R * 2.2, dm);
    if (st > 0) {
      const tw = st * (0.7 + 0.3 * Math.sin(TAU * (p * (8 + Math.floor(s.ph[i] * 10)) + s.ph[i])));
      r += (0.9 - r) * tw;
      g += (0.9 - g) * tw;
      b += (1 - b) * tw;
    }
    // The moon, with a warm halo and soft mottling.
    const disc = smoothstep(R + soft, R - soft, dm);
    const mott = 0.88 + 0.12 * Math.sin(dm * 40 + (s.wide ? 0 : x[i] * 23));
    const halo = Math.exp(-Math.max(0, dm - R) * 11) * 0.3;
    const mk = disc * mott + (1 - disc) * halo;
    r += (moon[0] - r) * mk;
    g += (moon[1] - g) * mk;
    b += (moon[2] - b) * mk;
    // Thin clouds drifting across, lit from behind near the moon.
    const cx = s.c[i];
    const cy = s.wide ? 0 : y[i] * 3;
    const band = Math.sin(TAU * (cx * 0.5 - drift) + 1.5 * Math.sin(TAU * (cx * 0.23 + cy * 0.3 + p * 2))) * 0.5 + 0.5;
    const cl = ck * smoothstep(0.55, 0.9, band) * (s.wide ? 1 : smoothstep(0.3, 0.5, y[i]));
    if (cl > 0) {
      const lit = 0.4 + 0.8 * Math.exp(-Math.max(0, dm - R) * 4);
      const cr = cloud[0] * lit + moon[0] * 0.15 * lit, cg = cloud[1] * lit + moon[1] * 0.1 * lit, cb = cloud[2] * lit;
      r += (cr - r) * cl * 0.85;
      g += (cg - g) * cl * 0.85;
      b += (cb - b) * cl * 0.85;
    }
    const tk = s.tree[i];
    if (tk > 0) {
      r += (trees[0] - r) * tk;
      g += (trees[1] - g) * tk;
      b += (trees[2] - b) * tk;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
