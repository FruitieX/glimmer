export const meta = {
  name: "Campfire Embers",
  description: "A bed of glowing coals with embers floating up, flickering and cooling.",
  category: "Nature",
  colors: [
    { id: "hot", label: "Hot", default: "#ffd27a" },
    { id: "glow", label: "Glow", default: "#ff5a0a" },
    { id: "coal", label: "Coals", default: "#7a0c02" },
  ],
  params: {
    embers: { type: "number", label: "Embers", min: 2, max: 40, step: 1, default: 16 },
    speed: { type: "number", label: "Rise speed", min: 0.05, max: 0.6, step: 0.01, default: 0.2 },
    glow: { type: "number", label: "Coal glow", min: 0, max: 1.5, step: 0.01, default: 0.9 },
    height: { type: "number", label: "Rise height", min: 0.2, max: 1, step: 0.01, default: 0.75 },
  },
  looks: [
    { name: "Bonfire", params: { embers: 32, speed: 0.35, height: 0.95 }, colors: ["#fff0a0", "#ff7000", "#b01800"] },
    { name: "Dying", params: { embers: 6, speed: 0.1, glow: 0.7, height: 0.4 }, colors: ["#ffa040", "#ff3800", "#701000"] },
    { name: "Witchfire", params: {}, colors: ["#d0ff80", "#30e040", "#0a5020"] },
    { name: "Copper", params: { embers: 22 }, colors: ["#c0f0ff", "#20a0ff", "#2010a0"] },
  ],
};

// Every ember rises a whole number of times per loop.
const CYCLES = 6;

export function loop(params) {
  return CYCLES / params.speed;
}

// Typical gap between distinct coordinate values (0 when all LEDs share it).
function gapOf(a, n, spacing) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.round(a[i] * 500);
  v.sort();
  let d = 0;
  for (let i = 1; i < n; i++) if (v[i] !== v[i - 1]) d++;
  return d === 0 ? 0 : Math.max(spacing, 1 / d);
}
// LEDs bucketed into a G × G grid, so a splat only visits nearby LEDs.
function makeIndex(px, py, n, G) {
  const cell = new Int32Array(n), start = new Int32Array(G * G + 1), items = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(G - 1, Math.max(0, Math.floor(px[i] * G)));
    const cy = Math.min(G - 1, Math.max(0, Math.floor(py[i] * G)));
    cell[i] = cy * G + cx;
    start[cell[i] + 1]++;
  }
  for (let c = 0; c < G * G; c++) start[c + 1] += start[c];
  const fill = start.slice();
  for (let i = 0; i < n; i++) items[fill[cell[i]]++] = i;
  return { G, start, items, px, py };
}
// Adds a soft round blob of colour c × a centred at (x0, y0) with radii rx, ry.
function splat(ix, out, x0, y0, rx, ry, c, a) {
  const { G, start, items, px, py } = ix;
  const cx0 = Math.max(0, Math.floor((x0 - rx) * G)), cx1 = Math.min(G - 1, Math.floor((x0 + rx) * G));
  const cy0 = Math.max(0, Math.floor((y0 - ry) * G)), cy1 = Math.min(G - 1, Math.floor((y0 + ry) * G));
  const irx = 1 / rx, iry = 1 / ry;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c0 = cy * G + cx;
      for (let k = start[c0]; k < start[c0 + 1]; k++) {
        const i = items[k];
        const dx = (px[i] - x0) * irx, dy = (py[i] - y0) * iry;
        const d = dx * dx + dy * dy;
        if (d < 1) {
          const w = (1 - d) * (1 - d) * a;
          out[i * 3] += c[0] * w;
          out[i * 3 + 1] += c[1] * w;
          out[i * 3 + 2] += c[2] * w;
        }
      }
    }
  }
}

export function setup(ctx) {
  const { n, x, y, spacing } = ctx;
  const gx = gapOf(x, n, spacing), gy = gapOf(y, n, spacing);
  return {
    ix: makeIndex(x, y, n, 12),
    flat: gy === 0,
    rx: gx === 0 ? 1e3 : Math.max(gx * 1.1, 0.02),
    ry: gy === 0 ? 1e3 : gy * 1.1,
    col: [0, 0, 0],
  };
}

export function render(ctx, s) {
  const { n, x, y, out, params, colors, t } = ctx;
  const hot = colors[0] || [1, 0.82, 0.48];
  const glow = colors[1] || [1, 0.35, 0.04];
  const coal = colors[2] || [0.48, 0.05, 0.01];
  const L = CYCLES / params.speed;
  const a = (TAU * t) / L;
  // Noise sampled on a circle, so the coals' flicker loops too.
  const cz = Math.cos(a) * 3, sz = Math.sin(a) * 3;
  for (let i = 0; i < n; i++) {
    const bed = s.flat ? 1 : smoothstep(0.32, 0, y[i]);
    if (bed <= 0) continue;
    const f = noise(x[i] * 6 + cz, (s.flat ? 0 : y[i] * 4) + sz) * 0.5 + 0.5;
    const heat = clamp(bed * params.glow * (0.15 + 1.4 * f * f));
    const c = heat < 0.5 ? mix([0, 0, 0], coal, heat * 2) : mix(coal, glow, (heat - 0.5) * 2);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
  const count = Math.round(params.embers);
  const col = s.col;
  for (let e = 0; e < count; e++) {
    const turns = CYCLES + (e % 3) - 1;
    const q = (t * params.speed * turns) / CYCLES + hash(e, 1);
    const cyc = Math.floor(q) % turns;
    const p = fract(q);
    const seed = e * 53 + cyc;
    const x0 = 0.1 + 0.8 * hash(seed, 2);
    const life = 0.5 + 0.5 * hash(seed, 3); // some burn out early
    if (p > life) continue;
    const pl = p / life;
    const ex = x0 + 0.07 * Math.sin(TAU * (p * 2 + hash(seed, 4))) + 0.05 * (hash(seed, 5) - 0.5) * p * 4;
    const ey = 0.05 + p * params.height;
    // Flicker as they tumble, cooling from bright yellow to deep red.
    const flick = 0.65 + 0.35 * Math.sin(TAU * (p * (5 + 4 * hash(seed, 6)) + hash(seed, 7)));
    const k = smoothstep(0, 0.08, pl) * 1.5 * Math.pow(1 - pl, 0.6) * flick;
    const c = pl < 0.3 ? mix(hot, glow, pl / 0.3) : mix(glow, coal, (pl - 0.3) * 0.7);
    col[0] = c[0];
    col[1] = c[1];
    col[2] = c[2];
    if (s.flat) {
      // A straight string can't show height: embers flare up and die in place.
      splat(s.ix, out, ex, 0.5, s.rx * 1.6, s.ry, col, k);
    } else {
      splat(s.ix, out, ex, ey, s.rx, s.ry, col, k);
    }
  }
}
