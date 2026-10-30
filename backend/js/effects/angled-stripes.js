export const meta = {
  name: "Angled stripes",
  description: "Soft-edged diagonal stripes in alternating colours gliding across.",
  category: "Gradients & patterns",
  colors: [
    { id: "a", label: "First", default: "#ff477e" },
    { id: "b", label: "Second", default: "#ffb347" },
    { id: "c", label: "Third", default: "#4cc9f0" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.05, max: 3, step: 0.05, default: 0.5 },
    count: { type: "number", label: "Stripes", min: 1, max: 10, step: 0.5, default: 3 },
    gap: { type: "number", label: "Dark gap", min: 0, max: 0.8, step: 0.05, default: 0.3 },
    angle: { type: "number", label: "Angle", min: -90, max: 90, step: 1, default: 30, unit: "°" },
  },
};

export function loop(params, colors) {
  // The colour sequence repeats after one stripe per colour has passed.
  return Math.max(1, colors.length || 3) / params.speed;
}

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
  const cols = ctx.colors.length ? ctx.colors : [[1, 0.3, 0.5], [1, 0.7, 0.3], [0.3, 0.8, 0.95]];
  const m = cols.length;
  const xs = s.line ? ctx.u : ctx.x;
  const th = (params.angle * PI) / 180;
  let nx = Math.cos(th), ny = Math.sin(th);
  if (s.line) {
    nx = 1;
    ny = 0;
  }
  const span = Math.abs(nx) * s.ax + Math.abs(ny) * s.ay;
  const k = params.count / span;
  // Edge softness in stripe units: at least about one and a half LEDs.
  const e = Math.min(0.45, Math.max(ctx.spacing * k * 1.5, 0.15));
  const lit = 1 - params.gap;
  const shift = t * params.speed;
  for (let i = 0; i < n; i++) {
    const sv = (xs[i] - 0.5) * s.ax * nx + (y[i] - 0.5) * s.ay * ny;
    const v = sv * k - shift;
    const fl = Math.floor(v);
    const f = v - fl;
    const idx = ((fl % m) + m) % m;
    let c0 = cols[idx];
    let b;
    if (lit >= 1) {
      // No gap: blend softly into the next stripe instead of fading to black.
      b = 1;
      const w = smoothstep(1 - e, 1, f);
      const c1 = cols[(idx + 1) % m];
      const j = i * 3;
      out[j] = c0[0] + (c1[0] - c0[0]) * w;
      out[j + 1] = c0[1] + (c1[1] - c0[1]) * w;
      out[j + 2] = c0[2] + (c1[2] - c0[2]) * w;
      continue;
    }
    // Stripe occupies [0, lit) of each unit with soft ramps at both ends.
    const h = e * 0.5;
    b = smoothstep(-h, h, f) * (1 - smoothstep(lit - h, lit + h, f));
    // Ramp in from the previous unit's tail wraps around f = 1.
    if (f > 1 - h) {
      const bn = smoothstep(-h, h, f - 1);
      if (bn > b) {
        b = bn;
        c0 = cols[(idx + 1) % m];
      }
    }
    const j = i * 3;
    out[j] = c0[0] * b;
    out[j + 1] = c0[1] * b;
    out[j + 2] = c0[2] * b;
  }
}
