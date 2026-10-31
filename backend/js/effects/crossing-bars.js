export const meta = {
  name: "Crossing bars",
  description: "Two glowing bars sweep across from opposite edges, trailing long fading light that mixes where they cross.",
  category: "Gradients & patterns",
  colors: [
    { id: "rising", label: "Rising bar", default: "#ff7a1a" },
    { id: "falling", label: "Falling bar", default: "#1ad8ff" },
  ],
  params: {
    cycle: { type: "number", label: "Cycle length", min: 3, max: 40, step: 0.5, default: 9, unit: "s" },
    width: { type: "number", label: "Bar width", min: 0.03, max: 0.4, step: 0.01, default: 0.1 },
    trail: { type: "number", label: "Trail length", min: 0, max: 1.5, step: 0.05, default: 0.7 },
    angle: { type: "number", label: "Angle", min: -90, max: 90, step: 1, default: 0, unit: "°" },
  },
  looks: [
    { name: "Sunset", params: { cycle: 14 }, colors: ["#ff2050", "#ffb000"] },
    { name: "Neon", params: { cycle: 5, width: 0.06 }, colors: ["#ff00d0", "#00ff80"] },
    { name: "Ocean", params: { cycle: 18, trail: 1.2 }, colors: ["#0050ff", "#00ffd0"] },
    { name: "Diagonal", params: { width: 0.15, angle: 45 }, colors: ["#ffd000", "#a020ff"] },
  ],
};

export function loop(params) {
  return params.cycle;
}

// Works out how positions map to physical space: 2D fixtures keep their
// proportions; strings and other 1D layouts run along the wire.
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

// Brightness of one bar and its trail at signed distance d ahead of the bar.
function bar(d, half, soft, len) {
  const a = Math.abs(d);
  let core = 0;
  if (a < half + soft) {
    const e = clamp((a - half + soft) / (2 * soft));
    core = 1 - e * e * (3 - 2 * e);
  }
  let tr = 0;
  if (len > 0 && d < 0) {
    // Rises smoothly from the bar's centre to its back edge, then eases out
    // to exactly zero over the trail length.
    const behind = -d - half;
    const f = behind <= 0 ? 1 : clamp(1 - behind / len);
    const r = clamp(-d / (half + soft));
    tr = 0.6 * f * f * (0.4 + 0.6 * f) * r * r * (3 - 2 * r);
  }
  return core > tr ? core : tr;
}

export function render(ctx, s) {
  const { n, y, out, params, t } = ctx;
  const xs = s.line ? ctx.u : ctx.x;
  const cA = ctx.colors[0] || [1, 0.48, 0.1];
  const cB = ctx.colors[1] || [0.1, 0.85, 1];
  const th = (params.angle * PI) / 180;
  // Bars move along the normal of their direction (angle 0: horizontal bars moving vertically).
  let nx = -Math.sin(th);
  let ny = Math.cos(th);
  if (s.line) {
    nx = 1;
    ny = 0;
  }
  const ext = 0.5 * (Math.abs(nx) * s.ax + Math.abs(ny) * s.ay);
  const span = 2 * ext;
  const half = (0.5 * params.width * span);
  const soft = Math.max(ctx.spacing * 1.3, half * 0.5);
  const len = params.trail * span;
  // One cycle: the bar enters from beyond one edge and leaves the far edge
  // together with its whole trail, then a short dark pause.
  const travel = span + 2 * (half + soft) + len;
  const phase = fract(t / params.cycle);
  const p = -ext - half - soft + phase * travel * 1.04;
  for (let i = 0; i < n; i++) {
    const sv = (xs[i] - 0.5) * s.ax * nx + (y[i] - 0.5) * s.ay * ny;
    const a = bar(sv - p, half, soft, len);
    const b = bar(-sv - p, half, soft, len);
    // Bar cores are a touch whiter so the heads read as bright.
    const wa = a > 0.6 ? (a - 0.6) * 0.35 : 0;
    const wb = b > 0.6 ? (b - 0.6) * 0.35 : 0;
    const w = wa + wb;
    const j = i * 3;
    out[j] = Math.min(1, cA[0] * a + cB[0] * b + w);
    out[j + 1] = Math.min(1, cA[1] * a + cB[1] * b + w);
    out[j + 2] = Math.min(1, cA[2] * a + cB[2] * b + w);
  }
}
