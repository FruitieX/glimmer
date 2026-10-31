export const meta = {
  name: "Scanner",
  description: "A glowing bar glides back and forth, leaving a smoothly fading afterglow.",
  category: "Gradients & patterns",
  colors: [
    { id: "bar", label: "Bar", default: "#ff2a1a" },
    { id: "trail", label: "Afterglow", default: "#8a0a3a" },
  ],
  params: {
    period: { type: "number", label: "Seconds per sweep", min: 0.5, max: 10, step: 0.1, default: 2.4, unit: "s" },
    width: { type: "number", label: "Bar width", min: 0.02, max: 0.5, step: 0.01, default: 0.12 },
    trail: { type: "number", label: "Afterglow", min: 0, max: 3, step: 0.05, default: 0.6, unit: "s" },
    axis: {
      type: "select",
      label: "Direction",
      options: ["x", "y"],
      labels: ["Side to side", "Up and down"],
      default: "x",
    },
  },
  looks: [
    { name: "Cyber", params: {}, colors: ["#00e5ff", "#0030a0"] },
    { name: "Radar", params: { period: 4, trail: 1.5 }, colors: ["#40ff60", "#004a20"] },
    { name: "Rising", params: { axis: "y", period: 3 }, colors: ["#ffd040", "#ff3000"] },
    { name: "Strobe", params: { period: 0.8, width: 0.06, trail: 0.2 }, colors: ["#ffffff", "#5a20ff"] },
  ],
};

export function loop(params) {
  return params.period * 2;
}

// Works out the LED pitch along each axis (rows and columns on grids), and
// whether the fixture is a plain string, in which case it scans along it.
export function setup(ctx) {
  const { n, x, y, u } = ctx;
  function pitch(a) {
    let lo = Infinity, hi = -Infinity;
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      if (a[i] < lo) lo = a[i];
      if (a[i] > hi) hi = a[i];
      if (seen.size <= 64) seen.add(Math.round(a[i] * 1000));
    }
    if (hi - lo < 1e-3) return 0;
    return seen.size <= 64 ? (hi - lo) / (seen.size - 1) : ctx.spacing;
  }
  const px = pitch(x), py = pitch(y);
  const line = px === 0 || py === 0;
  return { line, px: line ? 1 / Math.max(1, n - 1) : px, py: line ? 1 / Math.max(1, n - 1) : py };
}

export function render(ctx, s) {
  const { n, out, params, t } = ctx;
  const bar = ctx.colors[0] || [1, 0.16, 0.1];
  const tc = ctx.colors[1] || [0.54, 0.04, 0.23];
  const vert = params.axis === "y" && !s.line;
  const pos = s.line ? ctx.u : vert ? ctx.y : ctx.x;
  const pitch = vert ? s.py : s.px;
  // Wide enough to cover at least a couple of LEDs, so it glides between them.
  const w = Math.max(params.width, pitch * 2.2);
  const A = 0.5;
  const P = params.period * 2;
  const phi = TAU * fract(t / P);
  const pc = -A * Math.cos(phi);
  const tau = Math.max(0.001, params.trail);
  for (let i = 0; i < n; i++) {
    const sv = pos[i] - 0.5;
    const d = (sv - pc) / w;
    let bump = 1 - d * d;
    bump = bump > 0 ? bump * bump : 0;
    // Phase at which the bar passes this point going each way; the afterglow
    // decays with the time since the latest pass.
    const ps = Math.acos(clamp(-sv / A, -1, 1));
    let d1 = phi - ps;
    if (d1 < 0) d1 += TAU;
    let d2 = phi - (TAU - ps);
    if (d2 < 0) d2 += TAU;
    const since = ((d1 < d2 ? d1 : d2) / TAU) * P;
    const tr = params.trail > 0 ? 0.75 * Math.exp(-since / tau) * (1 - bump) : 0;
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const trailCol = tc[c] + (bar[c] - tc[c]) * tr;
      out[j + c] = Math.min(1, bar[c] * bump + trailCol * tr);
    }
  }
}
