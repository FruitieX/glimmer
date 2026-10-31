export const meta = {
  name: "Fireworks",
  description: "Rockets climb and burst into showers of sparks that fall and fade.",
  category: "Particles & physics",
  colors: [
    { id: "a", label: "Colour 1", default: "#ff3b5c" },
    { id: "b", label: "Colour 2", default: "#ffc93c" },
    { id: "c", label: "Colour 3", default: "#3cc8ff" },
  ],
  params: {
    rate: { type: "number", label: "Bursts per second", min: 0.1, max: 2, step: 0.05, default: 0.6 },
    sparks: { type: "number", label: "Sparks per burst", min: 10, max: 60, step: 1, default: 32 },
    gravity: { type: "number", label: "Gravity", min: 0, max: 1, step: 0.01, default: 0.35 },
    fade: { type: "number", label: "Spark life", min: 0.5, max: 4, step: 0.1, unit: "s", default: 1.8 },
  },
  looks: [
    { name: "Gold", params: { sparks: 50 }, colors: ["#ffd040", "#fff0c0", "#ff9a20"] },
    { name: "Tricolour", params: {}, colors: ["#ff2030", "#ffffff", "#2050ff"] },
    { name: "Finale", params: { rate: 1.8, sparks: 40, fade: 1.2 }, colors: ["#ff20a0", "#20ff60", "#ffe020"] },
    { name: "Willow", params: { rate: 0.3, gravity: 0.7, fade: 3.5 }, colors: ["#fff0d0", "#c0e0ff", "#ffd080"] },
  ],
};

const MAX = 240;
const ROCKETS = 6;

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
    rx: gx === 0 ? 1e3 : Math.max(gx * 1.25, 0.018),
    ry: gy === 0 ? 1e3 : gy * 1.25,
    // sparks
    sx: new Float32Array(MAX), sy: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    age: new Float32Array(MAX), life: new Float32Array(MAX).fill(0),
    col: new Uint8Array(MAX), seed: new Uint16Array(MAX),
    // rockets
    rx0: new Float32Array(ROCKETS), ry0: new Float32Array(ROCKETS),
    rvy: new Float32Array(ROCKETS), rtop: new Float32Array(ROCKETS), ron: new Uint8Array(ROCKETS),
    flash: new Float32Array(4), // x, y, strength, colour
    next: 0.2,
    tint: [0, 0, 0],
  };
}

function burst(s, x0, y0, params, ci) {
  const count = Math.round(params.sparks);
  let made = 0;
  const power = 0.5 + Math.random() * 0.25;
  for (let i = 0; i < MAX && made < count; i++) {
    if (s.age[i] < s.life[i]) continue;
    const a = Math.random() * TAU;
    const v = power * (0.75 + 0.25 * Math.random());
    s.sx[i] = x0;
    s.sy[i] = y0;
    s.vx[i] = Math.cos(a) * v * (s.flat ? 1.3 : 0.9);
    s.vy[i] = Math.sin(a) * v;
    s.age[i] = 0;
    s.life[i] = params.fade * (0.7 + 0.5 * Math.random());
    s.col[i] = Math.random() < 0.15 ? (ci + 1) % 3 : ci;
    s.seed[i] = (Math.random() * 65535) | 0;
    made++;
  }
  s.flash[0] = x0;
  s.flash[1] = y0;
  s.flash[2] = 1;
  s.flash[3] = ci;
}

function step(s, dt, params) {
  const g = params.gravity;
  const drag = Math.exp(-1.6 * dt);
  for (let i = 0; i < MAX; i++) {
    if (s.age[i] >= s.life[i]) continue;
    s.age[i] += dt;
    s.vx[i] *= drag;
    s.vy[i] = s.vy[i] * drag - g * 0.5 * dt;
    s.sx[i] += s.vx[i] * dt;
    s.sy[i] += s.vy[i] * dt;
  }
  for (let r = 0; r < ROCKETS; r++) {
    if (!s.ron[r]) continue;
    s.rvy[r] -= 0.25 * dt;
    s.ry0[r] += s.rvy[r] * dt;
    if (s.ry0[r] >= s.rtop[r] || s.rvy[r] < 0.15) {
      s.ron[r] = 0;
      burst(s, s.rx0[r], s.ry0[r], params, (Math.random() * 3) | 0);
    }
  }
  s.flash[2] *= Math.exp(-9 * dt);
  s.next -= dt;
  if (s.next <= 0) {
    s.next = (0.4 + Math.random() * 1.2) / params.rate;
    for (let r = 0; r < ROCKETS; r++) {
      if (s.ron[r]) continue;
      s.ron[r] = 1;
      s.rx0[r] = 0.15 + Math.random() * 0.7;
      s.ry0[r] = -0.05;
      s.rtop[r] = s.flat ? 0 : 0.55 + Math.random() * 0.3;
      s.rvy[r] = s.flat ? 0.2 : 0.75 + Math.random() * 0.2;
      break;
    }
  }
}

export function render(ctx, s) {
  const { n, out, params, colors } = ctx;
  let dt = Math.min(ctx.dt, 0.5);
  while (dt > 0) {
    const h = Math.min(dt, 1 / 30);
    step(s, h, params);
    dt -= h;
  }
  const pal = [colors[0] || [1, 0.23, 0.36], colors[1] || [1, 0.79, 0.24], colors[2] || [0.24, 0.78, 1]];
  const white = [1, 0.95, 0.85];
  const t = ctx.t;
  // Faint glow of the whole sky at a burst.
  if (s.flash[2] > 0.01) {
    const c = pal[s.flash[3]];
    splat(s.ix, out, s.flash[0], s.flash[1], s.flat ? 0.25 : 0.4, s.flat ? 1e3 : 0.4, c, s.flash[2] * 0.35);
  }
  for (let r = 0; r < ROCKETS; r++) {
    if (!s.ron[r] || s.flat) continue;
    splat(s.ix, out, s.rx0[r], s.ry0[r], s.rx, s.ry, [1, 0.6, 0.25], 0.55);
    splat(s.ix, out, s.rx0[r], s.ry0[r] - s.ry * 0.9, s.rx, s.ry, [1, 0.35, 0.1], 0.2);
  }
  const tint = s.tint;
  for (let i = 0; i < MAX; i++) {
    if (s.age[i] >= s.life[i]) continue;
    const p = s.age[i] / s.life[i];
    const c = pal[s.col[i]];
    const hot = smoothstep(0.25, 0, p);
    tint[0] = lerp(c[0], white[0], hot);
    tint[1] = lerp(c[1], white[1], hot);
    tint[2] = lerp(c[2], white[2], hot);
    // Sparks crackle a little as they die out.
    const crackle = p > 0.55 ? 0.55 + 0.45 * Math.sin(t * 23 + s.seed[i]) : 1;
    const k = Math.pow(1 - p, 1.6) * crackle * smoothstep(0, 0.15, s.age[i]);
    splat(s.ix, out, s.sx[i], s.sy[i], s.rx, s.ry, tint, k);
  }
}
