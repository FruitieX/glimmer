export const meta = {
  name: "Summer sparkling lake",
  description: "Clear lake water rippling in the summer sun: soft caustic light and glittering sun glints. Calm.",
  category: "Seasonal",
  colors: [
    { id: "deep", label: "Deep water", default: "#04406a" },
    { id: "shallow", label: "Shallows", default: "#18b4b0" },
    { id: "glint", label: "Sun glints", default: "#fff6d0" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 0.7 },
    glints: { type: "number", label: "Glints", min: 0, max: 1, step: 0.01, default: 0.5 },
    ripples: { type: "number", label: "Ripple size", min: 0.3, max: 3, step: 0.01, default: 1 },
  },
  looks: [
    { name: "Lagoon", params: { glints: 0.7 }, colors: ["#006a8a", "#00e0c0", "#ffffff"] },
    { name: "Sunset", params: { speed: 0.5 }, colors: ["#3a0a6a", "#ff5a3a", "#ffd080"] },
    { name: "Moonlit", params: { speed: 0.4, glints: 0.3 }, colors: ["#020a3a", "#1a40a0", "#e0eaff"] },
    { name: "Alpine", params: { speed: 1.2, ripples: 1.8 }, colors: ["#003a8a", "#2a8aff", "#ffffff"] },
  ],
};

const PERIOD = 40;
const SLOTS = 80;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { a: new Float32Array(n), b: new Float32Array(n), off: new Float32Array(n), depth: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    s.a[i] = wide ? (u[i] * (n - 1)) / 12 : x[i] * aspect * 1.3;
    s.b[i] = wide ? 0.37 * Math.sin(u[i] * 7) : y[i] * 1.3;
    s.depth[i] = wide ? 0.5 : 1 - y[i];
    s.off[i] = hash(i, 1) * SLOTS;
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const deep = colors[0] || [0.02, 0.25, 0.42];
  const shallow = colors[1] || [0.09, 0.71, 0.69];
  const glint = colors[2] || [1, 0.96, 0.82];
  const p = (t * params.speed) / PERIOD;
  const sc = 1 / params.ripples;
  const thr = params.glints * 0.22;
  const th1 = TAU * p * 5, th2 = TAU * p * 4, th3 = TAU * p * 3;
  for (let i = 0; i < n; i++) {
    const a = s.a[i] * sc, b = s.b[i] * sc;
    // Three wave trains crossing; where they line up, light gathers.
    const w = Math.sin(a * 3.1 + b * 1.3 - th1) + Math.sin(-a * 1.7 + b * 2.9 - th2) + Math.sin(a * 2.3 - b * 2.1 + th3);
    const c = 1 - Math.abs(w) / 3;
    const c2 = c * c;
    const caus = c2 * c2;
    const dk = 0.15 + 0.3 * s.depth[i] + 0.55 * caus;
    let r = deep[0] + (shallow[0] - deep[0]) * dk;
    let g = deep[1] + (shallow[1] - deep[1]) * dk;
    let bl = deep[2] + (shallow[2] - deep[2]) * dk;
    const hl = caus * caus * 0.5;
    r += (glint[0] - r) * hl;
    g += (glint[1] - g) * hl;
    bl += (glint[2] - bl) * hl;
    // Sun glints flash where the light gathers.
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    if (hash(i * 47 + (slot % SLOTS), 2) < thr * (0.3 + caus)) {
      const f = q - slot;
      const k = (f < 0.15 ? f / 0.15 : Math.exp(-(f - 0.15) * 6)) * 0.9;
      r += (glint[0] - r) * k;
      g += (glint[1] - g) * k;
      bl += (glint[2] - bl) * k;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = bl;
  }
}
