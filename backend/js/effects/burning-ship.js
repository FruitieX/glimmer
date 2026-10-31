export const meta = {
  name: "Burning Ship",
  description: "Sails into the Burning Ship fractal towards the little ships along its mast, then pulls back out.",
  category: "Fractals",
  colors: [
    { id: "a", label: "Embers", default: "#5a0a1e" },
    { id: "b", label: "Flame", default: "#ff5a1f" },
    { id: "c", label: "Glow", default: "#ffd36b" },
    { id: "inside", label: "Hull", default: "#030104" },
  ],
  params: {
    cycle: { type: "number", label: "Zoom cycle", min: 10, max: 120, step: 1, default: 36, unit: "s" },
    depth: { type: "number", label: "Zoom depth", min: 0.5, max: 2.5, step: 0.1, default: 1.8 },
    detail: { type: "number", label: "Detail", min: 16, max: 64, step: 1, default: 40 },
    bands: { type: "number", label: "Colour bands", min: 0.01, max: 0.2, step: 0.005, default: 0.05 },
  },
  looks: [
    { name: "Ice", params: {}, colors: ["#0a1a5a", "#2080ff", "#c0f0ff", "#010104"] },
    { name: "Toxic", params: {}, colors: ["#0a3a10", "#40ff20", "#e0ff80", "#010301"] },
    { name: "Royal", params: { bands: 0.1 }, colors: ["#3a0a5a", "#c030ff", "#ffc0f0", "#020104"] },
    { name: "Molten", params: { cycle: 60, depth: 2.2 }, colors: ["#a00a00", "#ff8000", "#fff0a0", "#030100"] },
  ],
};

export function loop(params) {
  return params.cycle;
}

// Aspect-correct coordinates with the longer side spanning -0.5..0.5; a
// straight string is a horizontal line through the middle.
export function setup(ctx) {
  const { n, x, y, aspect } = ctx;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const sx = line || aspect >= 1 ? 1 : aspect, sy = line ? 0 : aspect >= 1 ? 1 / aspect : 1;
  const px = new Float32Array(n), py = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = (x[i] - 0.5) * sx; py[i] = (y[i] - 0.5) * sy; }
  return { px, py };
}

// The small ships along the big ship's mast (imaginary axis points down).
const TX = -1.7623, TY = -0.0283;
const SX = -0.6, SY = -0.55, S0 = 3.6;
const LOG2 = Math.log(2);

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const ph = (t % params.cycle) / params.cycle;
  const z = (1 - Math.cos(TAU * ph)) / 2;
  const scale = S0 * Math.pow(10, -z * params.depth);
  const f = scale / S0;
  const ox = TX + (SX - TX) * f, oy = TY + (SY - TY) * f;
  const pal = [colors[0] || [0.35, 0.04, 0.12], colors[1] || [1, 0.35, 0.12], colors[2] || [1, 0.83, 0.42]];
  const inside = colors[3] || [0, 0, 0];
  const maxIt = Math.round(params.detail * (1 + 0.5 * z));
  for (let i = 0; i < n; i++) {
    const cr = ox + s.px[i] * scale;
    const ci = oy - s.py[i] * scale; // flipped so the ship sails upright
    let zr = 0, zi = 0, it = 0, r2 = 0;
    while (it < maxIt) {
      const t2 = zr * zr - zi * zi + cr;
      zi = Math.abs(2 * zr * zi) + ci;
      zr = t2;
      r2 = zr * zr + zi * zi;
      if (r2 > 256) break;
      it++;
    }
    const o = i * 3;
    if (it >= maxIt) { out[o] = inside[0]; out[o + 1] = inside[1]; out[o + 2] = inside[2]; continue; }
    const mu = Math.max(0, it + 1 - Math.log(Math.log(r2) * 0.5 / LOG2) / LOG2);
    const c = palette(pal, fract(mu * params.bands - ph), true);
    const k = clamp((mu - 1) / 6) * 0.72;
    out[o] = inside[0] + (c[0] - inside[0]) * k;
    out[o + 1] = inside[1] + (c[1] - inside[1]) * k;
    out[o + 2] = inside[2] + (c[2] - inside[2]) * k;
  }
}
