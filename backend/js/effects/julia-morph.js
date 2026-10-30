export const meta = {
  name: "Julia Morph",
  description: "A Julia set whose constant circles the edge of the Mandelbrot set, so its shape keeps curling and unfurling.",
  category: "Fractals",
  colors: [
    { id: "a", label: "Outer", default: "#3a1cff" },
    { id: "b", label: "Middle", default: "#00d0c0" },
    { id: "c", label: "Edge", default: "#fff0a8" },
    { id: "inside", label: "Inside", default: "#05020c" },
  ],
  params: {
    cycle: { type: "number", label: "Morph cycle", min: 10, max: 120, step: 1, default: 30, unit: "s" },
    zoom: { type: "number", label: "Zoom", min: 0.5, max: 3, step: 0.05, default: 1.3 },
    radius: { type: "number", label: "Shape", min: 0.6, max: 0.85, step: 0.005, default: 0.7885 },
    detail: { type: "number", label: "Detail", min: 16, max: 64, step: 1, default: 40 },
  },
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
  return { px, py, line };
}

const LOG2 = Math.log(2);

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const ph = (t % params.cycle) / params.cycle;
  const th = TAU * ph;
  const cr = params.radius * Math.cos(th), ci = params.radius * Math.sin(th);
  const span = 3.2 / params.zoom;
  // Turn the picture slowly (half a turn per cycle keeps it seamless, since
  // the set is symmetric through the origin).
  const ang = PI * ph + PI / 2 * (s.line ? 0 : 1);
  const ca = Math.cos(ang) * span, sa = Math.sin(ang) * span;
  const pal = [colors[0] || [0.25, 0.1, 1], colors[1] || [0, 0.8, 0.75], colors[2] || [1, 0.95, 0.65]];
  const inside = colors[3] || [0, 0, 0];
  const maxIt = params.detail | 0;
  for (let i = 0; i < n; i++) {
    let zr = s.px[i] * ca - s.py[i] * sa;
    let zi = s.px[i] * sa + s.py[i] * ca;
    let it = 0, r2 = zr * zr + zi * zi;
    while (it < maxIt && r2 <= 256) {
      const t2 = zr * zr - zi * zi + cr;
      zi = 2 * zr * zi + ci;
      zr = t2;
      r2 = zr * zr + zi * zi;
      it++;
    }
    const o = i * 3;
    if (it >= maxIt) { out[o] = inside[0]; out[o + 1] = inside[1]; out[o + 2] = inside[2]; continue; }
    const mu = Math.max(0, it + 1 - Math.log(Math.log(r2) * 0.5 / LOG2) / LOG2);
    // Colour by how long a point resists escaping: edge colour near the set.
    const v = clamp((mu - 1.5) / (maxIt * 0.4));
    const c = palette(pal, Math.sqrt(v));
    const k = 0.85 * Math.pow(v, 0.6);
    out[o] = inside[0] + (c[0] - inside[0]) * k;
    out[o + 1] = inside[1] + (c[1] - inside[1]) * k;
    out[o + 2] = inside[2] + (c[2] - inside[2]) * k;
  }
}
