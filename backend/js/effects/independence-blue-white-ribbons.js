export const meta = {
  name: "Independence Day ribbons",
  description: "Soft ribbons of Finnish blue and snowy white flowing slowly past each other, like a silk banner in candlelight.",
  category: "Seasonal",
  colors: [
    { id: "blue", label: "Blue", default: "#0a3cb4" },
    { id: "white", label: "White", default: "#f0f4ff" },
    { id: "deep", label: "Background", default: "#020a2a" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 2, step: 0.01, default: 0.5 },
    width: { type: "number", label: "Ribbon width", min: 0.3, max: 3, step: 0.01, default: 1 },
    glints: { type: "number", label: "Glints", min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  looks: [
    { name: "Snowy", params: { speed: 0.3, width: 1.6, glints: 0.6 }, colors: ["#2050e0", "#ffffff", "#010618"] },
    { name: "Midnight", params: { speed: 0.25, glints: 0.1 }, colors: ["#0828a0", "#a8c0ff", "#010312"] },
    { name: "Frosty", params: { width: 1.4, glints: 0.5 }, colors: ["#1878ff", "#e0f4ff", "#010a20"] },
    { name: "Lively", params: { speed: 1.2, width: 0.6, glints: 0.5 }, colors: ["#1060ff", "#e8f0ff", "#020a2a"] },
  ],
};

const PERIOD = 40;
const SLOTS = 40;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { a: new Float32Array(n), b: new Float32Array(n), off: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    // Two coordinates: along the ribbons and across them.
    if (wide) {
      s.a[i] = (u[i] * (n - 1)) / 40;
      s.b[i] = 0;
    } else {
      s.a[i] = x[i] * 0.9 + y[i] * 0.4;
      s.b[i] = y[i] * 1.6 - x[i] * 0.5;
    }
    s.off[i] = hash(i, 1) * SLOTS;
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const blue = colors[0] || [0.04, 0.24, 0.7];
  const white = colors[1] || [0.94, 0.96, 1];
  const deep = colors[2] || [0.01, 0.04, 0.16];
  const p = (t * params.speed) / PERIOD;
  const w = 1 / params.width;
  const thr = params.glints * 0.12;
  const flat = s.b[0] === 0 && s.b[n - 1] === 0;
  const bend = 1.4 * Math.sin(TAU * p * 2);
  for (let i = 0; i < n; i++) {
    const a = s.a[i] * w, b = s.b[i] * w;
    // A white ribbon and a blue one, each folding gently as it flows.
    const fold1 = Math.sin(TAU * (a * 0.8 - p * 3) + (flat ? bend : 1.4 * Math.sin(TAU * (b * 0.5 + p * 2))));
    const fold2 = Math.sin(TAU * (a * 0.6 + b * 0.7 + p * 2) + 1.2 * Math.sin(TAU * (a * 0.4 - p * 1)));
    const wk = smoothstep(0.5, 0.95, fold1);
    const bk = smoothstep(-0.6, 0.4, fold2);
    // Folds catch the light: a silky highlight near each crest.
    const shine = 0.75 + 0.25 * Math.cos(TAU * (a * 2.2 - p * 6) + fold2);
    let r = deep[0] + (blue[0] * shine - deep[0]) * bk;
    let g = deep[1] + (blue[1] * shine - deep[1]) * bk;
    let bl = deep[2] + (blue[2] * shine - deep[2]) * bk;
    const wl = wk * (0.55 + 0.25 * shine);
    r += (white[0] * 0.85 - r) * wl;
    g += (white[1] * 0.85 - g) * wl;
    bl += (white[2] * 0.85 - bl) * wl;
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    if (hash(i * 41 + (slot % SLOTS), 6) < thr) {
      const f = Math.sin(PI * (q - slot));
      const k = f * f * f * 0.7;
      r += (white[0] - r) * k;
      g += (white[1] - g) * k;
      bl += (white[2] - bl) * k;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = bl;
  }
}
