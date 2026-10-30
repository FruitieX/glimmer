export const meta = {
  name: "Ocean",
  description: "Rolling swells of deep and shallow water with foam riding the crests.",
  category: "Plasma & flow",
  colors: [
    { id: "deep", label: "Deep water", default: "#03256c" },
    { id: "shallow", label: "Shallow water", default: "#06bee1" },
    { id: "foam", label: "Foam", default: "#e8fbff" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.02, max: 0.5, step: 0.01, default: 0.1 },
    size: { type: "number", label: "Wave size", min: 0.3, max: 3, step: 0.05, default: 0.8 },
    foam: { type: "number", label: "Foam", min: 0, max: 1, step: 0.05, default: 0.8 },
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

export function render(ctx, s) {
  const { n, y, out, params, t } = ctx;
  const D = ctx.colors[0] || [0.01, 0.15, 0.42];
  const Sh = ctx.colors[1] || [0.02, 0.75, 0.88];
  const F = ctx.colors[2] || [0.9, 0.98, 1];
  const xs = s.line ? ctx.u : ctx.x;
  const w = TAU * fract(t * params.speed);
  const k = TAU / params.size;
  const fo = params.foam;
  for (let i = 0; i < n; i++) {
    let X = (xs[i] - 0.5) * s.ax;
    let Y = (y[i] - 0.5) * s.ay;
    if (s.line) {
      // On a string the swells roll along it.
      Y = -X;
      X *= 0.3;
    }
    // Swells roll downward (toward the "shore"), at slight angles to each
    // other; their speeds are whole multiples of the loop rate.
    const p1 = k * (Y * 1.0 + X * 0.25) + 2 * w;
    const p2 = k * (Y * 0.8 - X * 0.6) * 1.3 + 3 * w + 1.3;
    const p3 = k * (Y * 0.5 + X * 0.9) * 2.1 + 5 * w + 4.1;
    // Trochoid-like shape: sharp crests, broad troughs.
    const s1 = Math.sin(p1 + 0.45 * Math.sin(p1));
    const h = 0.7 * s1 + 0.2 * Math.sin(p2 + 0.4 * Math.sin(p2)) + 0.1 * Math.sin(p3);
    const e = clamp(0.5 + 0.5 * h);
    // Foam where the swells pile up, broken up by the smaller waves.
    const crest = clamp((h - 0.3) / 0.5);
    const foam = fo * crest * crest * (0.7 + 0.3 * Math.sin(k * (Y * 0.3 - X * 0.7) * 3.1 + 4 * w));
    const sh = e * e * (3 - 2 * e);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const water = (D[c] + (Sh[c] - D[c]) * sh) * (0.55 + 0.45 * e);
      out[j + c] = water + (F[c] - water) * clamp(foam);
    }
  }
}
