export const meta = {
  name: "Silk",
  description: "Soft folds of shot silk shimmering as light slides across them.",
  category: "Plasma & flow",
  colors: [
    { id: "base", label: "Silk", default: "#5a189a" },
    { id: "shot", label: "Shot colour", default: "#c9184a" },
    { id: "sheen", label: "Sheen", default: "#ffd6e8" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.01, max: 0.4, step: 0.01, default: 0.06 },
    folds: { type: "number", label: "Folds", min: 0.5, max: 4, step: 0.1, default: 1.6 },
    sheen: { type: "number", label: "Sheen", min: 0, max: 1, step: 0.05, default: 0.7 },
  },
};

export function loop(params) {
  return 1 / params.speed;
}

// Keeps 2D fixtures in proportion; strings and other 1D layouts use u.
export function setup(ctx) {
  const { n, x, y, aspect } = ctx;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < x0) x0 = x[i];
    if (x[i] > x1) x1 = x[i];
    if (y[i] < y0) y0 = y[i];
    if (y[i] > y1) y1 = y[i];
  }
  const line = !(x1 - x0 > 1e-3 && y1 - y0 > 1e-3);
  return { line, ax: line ? 1 : Math.min(1, aspect), ay: line ? 0 : Math.min(1, 1 / aspect) };
}

// Fold directions (unit-ish vectors), relative frequencies, amplitudes and
// whole-number time multipliers, so the folds loop.
const KX = [0.95, -0.45, 0.3];
const KY = [0.3, 0.9, -0.95];
const KF = [1, 1.45, 2.2];
const KA = [1, 0.6, 0.3];
const KW = [1, -2, 3];
const KP = [0, 1.7, 4.2];

export function render(ctx, s) {
  const { n, y, out, params, t } = ctx;
  const Bc = ctx.colors[0] || [0.35, 0.09, 0.6];
  const Sc = ctx.colors[1] || [0.79, 0.09, 0.29];
  const Hc = ctx.colors[2] || [1, 0.84, 0.91];
  const xs = s.line ? ctx.u : ctx.x;
  const w = TAU * fract(t * params.speed);
  const f = TAU * params.folds * 0.5;
  // The light slowly circles once per loop.
  const lx = Math.cos(w), ly = Math.sin(w);
  const sh = params.sheen;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax;
    const Y = (y[i] - 0.5) * s.ay + (s.line ? 0.2 : 0);
    // Slope of the cloth's height field (sum of gentle folds).
    let gx = 0, gy = 0;
    for (let k = 0; k < 3; k++) {
      const a = f * KF[k] * (KX[k] * X + KY[k] * Y) + KW[k] * w + KP[k];
      const c = KA[k] * Math.cos(a);
      gx += c * KX[k];
      gy += c * KY[k];
    }
    // Normalise roughly to -1..1.
    gx *= 0.75;
    gy *= 0.75;
    const facing = gx * lx + gy * ly;
    const side = gy * lx - gx * ly;
    // Shot silk changes hue with the angle of the weave to the light.
    const m = clamp(0.5 + 0.6 * side);
    const shade = 0.3 + 0.7 * clamp(0.5 + 0.6 * facing);
    let hl = clamp(0.5 + 0.6 * facing);
    hl = hl * hl;
    hl = hl * hl * sh;
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const cloth = (Bc[c] + (Sc[c] - Bc[c]) * m) * shade;
      out[j + c] = Math.min(1, cloth + (Hc[c] - cloth) * hl);
    }
  }
}
