export const meta = {
  name: "Mandelbrot Zoom",
  description: "Dives into a spiral in the Mandelbrot set's seahorse valley and back out again, with colours flowing through the bands.",
  category: "Fractals",
  colors: [
    { id: "a", label: "Colour one", default: "#1f3cff" },
    { id: "b", label: "Colour two", default: "#ff3d8b" },
    { id: "c", label: "Colour three", default: "#ffd166" },
    { id: "inside", label: "Inside", default: "#020108" },
  ],
  params: {
    cycle: { type: "number", label: "Zoom cycle", min: 10, max: 120, step: 1, default: 40, unit: "s" },
    depth: { type: "number", label: "Zoom depth", min: 0.5, max: 3.5, step: 0.1, default: 2.2 },
    detail: { type: "number", label: "Detail", min: 16, max: 64, step: 1, default: 48 },
    bands: { type: "number", label: "Colour bands", min: 0.01, max: 0.2, step: 0.005, default: 0.06 },
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
  return { px, py };
}

// A Misiurewicz point in the seahorse valley: spirals all the way down.
const TX = -0.77568377, TY = 0.13646737;
const LOG2 = Math.log(2);

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const T = params.cycle;
  const ph = (t % T) / T;
  const z = (1 - Math.cos(TAU * ph)) / 2;
  const scale = 3 * Math.pow(10, -z * params.depth);
  // Start framed on the whole set; the target stays put on screen as we zoom.
  const ox = TX + (-0.6 - TX) * (scale / 3), oy = TY + (0 - TY) * (scale / 3);
  const ang = TAU * ph;
  const ca = Math.cos(ang) * scale, sa = Math.sin(ang) * scale;
  const pal = [colors[0] || [0.1, 0.25, 1], colors[1] || [1, 0.25, 0.55], colors[2] || [1, 0.8, 0.4]];
  const inside = colors[3] || [0, 0, 0];
  // Deeper views need more iterations to resolve the edge of the set.
  const maxIt = Math.round(params.detail * (1 + 0.6 * z));
  const shift = ph * 2; // colour cycles twice per loop
  for (let i = 0; i < n; i++) {
    const cr = ox + s.px[i] * ca - s.py[i] * sa;
    const ci = oy + s.px[i] * sa + s.py[i] * ca;
    let zr = 0, zi = 0, it = 0, r2 = 0;
    // Skip the main cardioid and period-2 bulb, which never escape.
    const q = (cr - 0.25) * (cr - 0.25) + ci * ci;
    if (q * (q + cr - 0.25) < 0.25 * ci * ci || (cr + 1) * (cr + 1) + ci * ci < 0.0625) it = maxIt;
    while (it < maxIt) {
      const t2 = zr * zr - zi * zi + cr;
      zi = 2 * zr * zi + ci;
      zr = t2;
      r2 = zr * zr + zi * zi;
      if (r2 > 256) break;
      it++;
    }
    const o = i * 3;
    if (it >= maxIt) { out[o] = inside[0]; out[o + 1] = inside[1]; out[o + 2] = inside[2]; continue; }
    // Smooth iteration count, so bands blend instead of stepping.
    const mu = it + 1 - Math.log(Math.log(r2) * 0.5 / LOG2) / LOG2;
    const c = palette(pal, mu * params.bands - shift, true);
    const k = clamp(mu / 6) * 0.85; // fade the outermost bands into darkness
    out[o] = inside[0] + (c[0] - inside[0]) * k;
    out[o + 1] = inside[1] + (c[1] - inside[1]) * k;
    out[o + 2] = inside[2] + (c[2] - inside[2]) * k;
  }
}
