export const meta = {
  name: "Kaleidoscope",
  description: "Mirrored wedges of shifting colour turning slowly around the centre.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#f72585" },
    { id: "b", label: "Second", default: "#7209b7" },
    { id: "c", label: "Third", default: "#4361ee" },
    { id: "d", label: "Fourth", default: "#4cc9f0" },
  ],
  params: {
    segments: { type: "number", label: "Mirrors", min: 2, max: 12, step: 1, default: 6 },
    speed: { type: "number", label: "Speed", min: 0.01, max: 0.5, step: 0.01, default: 0.06 },
    zoom: { type: "number", label: "Detail", min: 0.5, max: 6, step: 0.25, default: 2.5 },
    spin: { type: "boolean", label: "Rotate", default: true },
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
  const cols = ctx.colors.length ? ctx.colors : [[0.97, 0.15, 0.52], [0.45, 0.04, 0.72], [0.3, 0.79, 0.94]];
  const m = cols.length;
  const xs = s.line ? ctx.u : ctx.x;
  const seg = Math.max(2, Math.round(params.segments));
  const wedge = TAU / seg;
  const w = TAU * fract(t * params.speed);
  // One full turn of the mirror wedge per loop when rotating.
  const turn = params.spin ? w / seg : 0;
  const z = params.zoom;
  for (let i = 0; i < n; i++) {
    const X = (xs[i] - 0.5) * s.ax;
    const Y = (y[i] - 0.5) * s.ay;
    const r = Math.sqrt(X * X + Y * Y);
    let a = Math.atan2(Y, X) + turn;
    // Fold the angle into one mirrored wedge.
    a = a - wedge * Math.floor(a / wedge);
    if (a > wedge / 2) a = wedge - a;
    const px = r * Math.cos(a) * z;
    const py = r * Math.sin(a) * z;
    // A small flowing pattern inside the wedge; all phases are whole cycles.
    const v =
      Math.sin(px * 2.1 + w) +
      Math.sin(py * 3.3 - w * 2 + px) +
      Math.sin((px + py) * 1.7 + Math.sin(py * 2 + w) * 1.5 - w);
    const q = v / 8 + 0.5 + r * 0.6 + (0.3 * a) / wedge - w / TAU;
    const p = (q - Math.floor(q)) * m;
    const k = Math.floor(p);
    const g = p - k;
    const c0 = cols[k % m];
    const c1 = cols[(k + 1) % m];
    // Soft rings of light pulse outward through the facets.
    const ring = 0.5 + 0.5 * Math.cos(TAU * r * 2.2 - 2 * w + v * 0.8);
    const b = 0.45 + 0.55 * ring * ring;
    const j = i * 3;
    out[j] = (c0[0] + (c1[0] - c0[0]) * g) * b;
    out[j + 1] = (c0[1] + (c1[1] - c0[1]) * g) * b;
    out[j + 2] = (c0[2] + (c1[2] - c0[2]) * g) * b;
  }
}
