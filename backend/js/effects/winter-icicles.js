export const meta = {
  name: "Winter icicles",
  description: "Shimmering icicles hanging from the top, slowly dripping meltwater.",
  category: "Seasonal",
  colors: [
    { id: "ice", label: "Ice", default: "#6cc4ff" },
    { id: "drop", label: "Drops", default: "#e6f7ff" },
    { id: "sky", label: "Sky", default: "#06183a" },
  ],
  params: {
    count: { type: "number", label: "Icicles", min: 3, max: 30, step: 1, default: 10 },
    length: { type: "number", label: "Length", min: 0.2, max: 1, step: 0.01, default: 0.6 },
    speed: { type: "number", label: "Drip speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    sky: { type: "number", label: "Sky brightness", min: 0, max: 1, step: 0.01, default: 0.4 },
  },
};

const PERIOD = 30;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const ice = colors[0] || [0.42, 0.77, 1];
  const drop = colors[1] || [0.9, 0.97, 1];
  const sky = colors[2] || [0.02, 0.09, 0.23];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const N = wide ? Math.max(2, Math.round((params.count * aspect) / 12)) : params.count;
  const sb = params.sky;
  for (let i = 0; i < n; i++) {
    let c, a, side, room;
    if (wide) {
      // Along a line, each icicle fills a short stretch: root first, tip last.
      const cell = x[i] * N;
      c = Math.floor(Math.min(cell, N - 0.001));
      a = cell - c;
      side = 1;
      room = 1;
    } else {
      // On a grid, one icicle per column, hanging from the top.
      const cf = x[i] * (N - 1);
      c = Math.round(cf);
      const dx = cf - c;
      side = Math.exp(-dx * dx * 10);
      a = 1 - y[i];
      room = 1.05;
    }
    const L = params.length * (0.35 + 0.65 * hash(c, 1));
    const soft = Math.max(spacing * (wide ? N : 1.5), 0.03);
    // Body: brightest and thickest at the root, thinning to the tip.
    const body = smoothstep(L + soft, L - soft, a) * (0.3 + 0.7 * Math.pow(clamp(1 - a / (L + 0.001)), 0.7));
    // Light running down the ice.
    const shimmer = 0.75 + 0.25 * Math.sin(TAU * (a * 2.5 - p * (6 + (c % 3)) + hash(c, 2)));
    // Drips: a bead swells at the tip, then falls.
    const q = fract(p * (3 + Math.floor(hash(c, 3) * 4)) + hash(c, 4));
    let d = 0;
    if (q < 0.7) {
      const bead = q / 0.7;
      const e = (a - L) / (soft * 1.2);
      d = bead * bead * Math.exp(-e * e) * 0.8;
    } else {
      const f = (q - 0.7) / 0.3;
      const pos = L + f * f * (room - L + 0.2);
      const e = (a - pos) / (soft * 0.85);
      d = Math.exp(-e * e) * (1 - f * 0.4);
    }
    const k = clamp(body * shimmer * side);
    const dk = clamp(d * side);
    const glow = sb * (0.4 + 0.6 * y[i]);
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      out[o + ch] = clamp(sky[ch] * glow + ice[ch] * k + drop[ch] * dk);
    }
  }
}
