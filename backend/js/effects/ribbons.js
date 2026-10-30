export const meta = {
  name: "Ribbons",
  description: "Glowing ribbons of light weave and flow past each other, blending where they cross.",
  category: "Plasma & flow",
  colors: [
    { id: "a", label: "First", default: "#00f5d4" },
    { id: "b", label: "Second", default: "#9b5de5" },
    { id: "c", label: "Third", default: "#f15bb5" },
    { id: "bg", label: "Background", default: "#050418" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.01, max: 0.5, step: 0.01, default: 0.08 },
    width: { type: "number", label: "Ribbon width", min: 0.03, max: 0.3, step: 0.01, default: 0.09 },
    waviness: { type: "number", label: "Waviness", min: 0, max: 1, step: 0.05, default: 0.6 },
    direction: {
      type: "select",
      label: "Flow",
      options: ["horizontal", "vertical"],
      labels: ["Horizontal", "Vertical"],
      default: "horizontal",
    },
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
  const { n, x, y, u, out, params, t } = ctx;
  const nc = Math.min(3, Math.max(1, ctx.colors.length - 1));
  const cols = ctx.colors.length >= 2 ? ctx.colors : [[0, 0.96, 0.83], [0.6, 0.36, 0.9], [0.95, 0.36, 0.71], [0.02, 0.02, 0.1]];
  const bg = cols.length > nc ? cols[nc] : [0, 0, 0];
  const w = TAU * fract(t * params.speed);
  const wid = Math.max(params.width, ctx.spacing * 1.2);
  const inv = 1 / (wid * wid);
  const wav = params.waviness;
  const vert = params.direction === "vertical";
  for (let i = 0; i < n; i++) {
    // a: along the flow, b: across it.
    let a, b;
    if (s.line) {
      a = u[i] - 0.5;
      b = 0;
    } else if (vert) {
      a = (y[i] - 0.5) * s.ay;
      b = (x[i] - 0.5) * s.ax;
    } else {
      a = (x[i] - 0.5) * s.ax;
      b = (y[i] - 0.5) * s.ay;
    }
    let r = bg[0], g = bg[1], bl = bg[2];
    for (let k = 0; k < 3; k++) {
      const c = cols[k % nc];
      // Each ribbon is a travelling wave with its own whole-number speeds.
      const off = (k - 1) * 0.28;
      const centre =
        off * (1 - 0.4 * wav) +
        wav * (0.2 * Math.sin(TAU * a * (0.55 + 0.2 * k) - (k + 1) * w + k * 2.1) +
          0.08 * Math.sin(TAU * a * (1.2 - 0.2 * k) + (2 - k) * w + k));
      // Breathing width so crossings swell and thin.
      const ww = 1 + 0.35 * Math.sin(TAU * a * 0.8 + (k % 2 ? w : -w) + k * 1.7);
      const d = b - centre;
      const e = Math.exp(-(d * d * inv) / (ww * ww));
      r += c[0] * e;
      g += c[1] * e;
      bl += c[2] * e;
    }
    const j = i * 3;
    out[j] = Math.min(1, r);
    out[j + 1] = Math.min(1, g);
    out[j + 2] = Math.min(1, bl);
  }
}
