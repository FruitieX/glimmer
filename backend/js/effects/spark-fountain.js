export const meta = {
  name: "Spark Fountain",
  description: "A fountain of hot sparks shooting up, arcing over and cooling as they fall.",
  category: "Particles & physics",
  colors: [
    { id: "hot", label: "Hot", default: "#fff3c4" },
    { id: "warm", label: "Warm", default: "#ffa62b" },
    { id: "cool", label: "Cooling", default: "#c1121f" },
  ],
  params: {
    rate: { type: "number", label: "Sparks per second", min: 5, max: 120, step: 1, default: 35 },
    height: { type: "number", label: "Height", min: 0.3, max: 1.2, step: 0.01, default: 0.8 },
    spread: { type: "number", label: "Spread", min: 0, max: 1, step: 0.01, default: 0.5 },
    sway: { type: "number", label: "Sway", min: 0, max: 1, step: 0.01, default: 0.3 },
  },
};

const MAX = 260;
const G = 1.4;

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
    rx: gx === 0 ? 1e3 : Math.max(gx * 1.2, 0.025),
    ry: gy === 0 ? 1e3 : gy * 1.2,
    sx: new Float32Array(MAX), sy: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    age: new Float32Array(MAX), life: new Float32Array(MAX),
    acc: 0, t: 0, cursor: 0,
    tint: [0, 0, 0],
  };
}

function step(s, dt, p) {
  s.t += dt;
  const drag = Math.exp(-0.6 * dt);
  for (let i = 0; i < MAX; i++) {
    if (s.age[i] >= s.life[i]) continue;
    s.age[i] += dt;
    s.vx[i] *= drag;
    s.vy[i] = s.vy[i] * drag - G * dt;
    s.sx[i] += s.vx[i] * dt;
    s.sy[i] += s.vy[i] * dt;
    // A small hop off the floor, losing most of the energy.
    if (s.sy[i] < 0 && s.vy[i] < 0) {
      s.sy[i] = 0;
      s.vy[i] *= -0.3;
      s.vx[i] *= 0.6;
    }
  }
  s.acc += dt * p.rate;
  const nozzle = 0.5 + p.sway * 0.3 * Math.sin(s.t * 0.7) * Math.cos(s.t * 0.23);
  const v0 = Math.sqrt(2 * G * p.height);
  while (s.acc >= 1) {
    s.acc -= 1;
    const i = s.cursor;
    s.cursor = (s.cursor + 1) % MAX;
    const a = (Math.random() - 0.5) * p.spread * 1.6;
    const v = v0 * (0.8 + 0.25 * Math.random());
    s.sx[i] = nozzle;
    s.sy[i] = 0;
    s.vx[i] = Math.sin(a) * v * (s.flat ? 0.45 : 0.7);
    s.vy[i] = Math.cos(a) * v;
    s.age[i] = 0;
    s.life[i] = 1.4 + Math.random() * 1.4;
  }
}

export function render(ctx, s) {
  const { out, params, colors, t } = ctx;
  let dt = Math.min(ctx.dt, 0.5);
  while (dt > 0) {
    const h = Math.min(dt, 1 / 30);
    step(s, h, params);
    dt -= h;
  }
  const pal = [[0, 0, 0], colors[2] || [0.76, 0.07, 0.12], colors[1] || [1, 0.65, 0.17], colors[0] || [1, 0.95, 0.77]];
  const tint = s.tint;
  for (let i = 0; i < MAX; i++) {
    if (s.age[i] >= s.life[i]) continue;
    const heat = 1 - s.age[i] / s.life[i];
    const p = heat * heat * (3 - 2 * heat);
    const f = clamp(p * 1.05) * 3;
    const k = Math.min(2, Math.floor(f));
    const a = pal[k], b = pal[k + 1], m = f - k;
    tint[0] = a[0] + (b[0] - a[0]) * m;
    tint[1] = a[1] + (b[1] - a[1]) * m;
    tint[2] = a[2] + (b[2] - a[2]) * m;
    const flick = 0.75 + 0.25 * Math.sin(t * 31 + i * 7.3);
    splat(s.ix, out, s.sx[i], s.sy[i], s.rx, s.ry, tint, (0.25 + 0.3 * heat) * flick);
  }
  // Glowing nozzle at the base.
  if (!s.flat) {
    const nozzle = 0.5 + params.sway * 0.3 * Math.sin(s.t * 0.7) * Math.cos(s.t * 0.23);
    splat(s.ix, out, nozzle, 0, s.rx * 1.3, s.ry * 1.5, pal[2], 0.6);
  }
}
