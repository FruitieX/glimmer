export const meta = {
  name: "Rain",
  description: "Raindrops streaking down and splashing where they land.",
  category: "Nature",
  colors: [
    { id: "rain", label: "Rain", default: "#9ecbff" },
    { id: "splash", label: "Splash", default: "#e6f4ff" },
    { id: "sky", label: "Sky", default: "#0a1426" },
  ],
  params: {
    drops: { type: "number", label: "Drops", min: 2, max: 40, step: 1, default: 14 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 2, step: 0.01, default: 0.7 },
    wind: { type: "number", label: "Wind", min: -1, max: 1, step: 0.01, default: 0.2 },
    splash: { type: "number", label: "Splash size", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
};

// Each drop falls once per 1 / speed seconds and lands somewhere new every
// time; after CYCLES falls the pattern repeats.
const CYCLES = 12;
const FALL = 0.72; // share of a cycle spent falling, the rest splashing

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

// Adds a soft line from (x0, y0) (bright end, × a) to (x1, y1) (fading to × a1),
// radii rx, ry around it.
function streak(ix, out, x0, y0, x1, y1, rx, ry, c, a, a1) {
  const { G, start, items, px, py } = ix;
  const cx0 = Math.max(0, Math.floor((Math.min(x0, x1) - rx) * G)), cx1 = Math.min(G - 1, Math.floor((Math.max(x0, x1) + rx) * G));
  const cy0 = Math.max(0, Math.floor((Math.min(y0, y1) - ry) * G)), cy1 = Math.min(G - 1, Math.floor((Math.max(y0, y1) + ry) * G));
  const irx = 1 / rx, iry = 1 / ry;
  const ex = (x1 - x0) * irx, ey = (y1 - y0) * iry;
  const len2 = ex * ex + ey * ey;
  const inv = len2 > 1e-9 ? 1 / len2 : 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c0 = cy * G + cx;
      for (let k = start[c0]; k < start[c0 + 1]; k++) {
        const i = items[k];
        const qx = (px[i] - x0) * irx, qy = (py[i] - y0) * iry;
        const h = clamp((qx * ex + qy * ey) * inv);
        const dx = qx - ex * h, dy = qy - ey * h;
        const d = dx * dx + dy * dy;
        if (d < 1) {
          const w = (1 - d) * (1 - d) * (a + (a1 - a) * h);
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
  let lo = 1;
  for (let i = 0; i < n; i++) lo = Math.min(lo, y[i]);
  return {
    ix: makeIndex(x, y, n, 12),
    flat: gy === 0,
    ground: gy === 0 ? 0.5 : lo,
    rx: gx === 0 ? 1e3 : Math.max(gx * 0.8, 0.012),
    ry: gy === 0 ? 1e3 : gy * 1.1,
    gx, gy,
  };
}

export function render(ctx, s) {
  const { n, x, y, out, params, colors, t } = ctx;
  const rain = colors[0] || [0.62, 0.8, 1];
  const spl = colors[1] || [0.9, 0.96, 1];
  const sky = colors[2] || [0.04, 0.08, 0.15];
  // Sky texture drifts on a circle through the noise, so it loops too.
  const la = (TAU * t * params.speed) / CYCLES;
  const cz = Math.cos(la) * 0.8, sz = Math.sin(la) * 0.8;
  for (let i = 0; i < n; i++) {
    const k = 0.75 + 0.35 * noise(x[i] * 2 + cz, y[i] * 1.5, sz);
    out[i * 3] = sky[0] * k;
    out[i * 3 + 1] = sky[1] * k;
    out[i * 3 + 2] = sky[2] * k;
  }
  const count = Math.round(params.drops);
  const wind = params.wind * 0.25;
  const len = 0.12 + 0.06 * params.speed;
  const col = [0, 0, 0];
  for (let d = 0; d < count; d++) {
    const q = t * params.speed + hash(d, 1);
    const cyc = ((Math.floor(q) % CYCLES) + CYCLES) % CYCLES;
    const p = fract(q);
    const seed = d * 97 + cyc;
    const lx = 0.04 + 0.92 * hash(seed, 2); // where it lands
    const bright = 0.55 + 0.45 * hash(seed, 3);
    if (!s.flat) {
      // The streak keeps going "into" the ground so its tail slides out of
      // sight instead of vanishing.
      const f = p / FALL;
      const h = s.ground + (1 - f) * (1.1 - s.ground);
      const tail = h + len;
      if (tail > s.ground - s.ry) {
        const hx = lx - wind * (h - s.ground), tx = lx - wind * (tail - s.ground);
        streak(s.ix, out, hx, h, tx, tail, s.rx, s.ry * 1.5, rain, bright, 0.12);
      }
    }
    if (p >= FALL) {
      const f = (p - FALL) / (1 - FALL); // 0..1 through the splash
      const fade = (1 - f) * (1 - f) * bright * smoothstep(0, 0.2, f);
      const size = params.splash;
      if (s.flat) {
        // On a straight string: a flash where the drop hits, then two
        // droplets running out each side.
        splat(s.ix, out, lx, 0.5, Math.max(s.gx * 1.5, 0.02), 1e3, spl, fade);
        const spread = 0.02 + 0.08 * size * ease.out(f);
        splat(s.ix, out, lx - spread, 0.5, Math.max(s.gx * 1.3, 0.015), 1e3, rain, 0.8 * fade);
        splat(s.ix, out, lx + spread, 0.5, Math.max(s.gx * 1.3, 0.015), 1e3, rain, 0.8 * fade);
        continue;
      }
      splat(s.ix, out, lx, s.ground, s.rx * (1.2 + f * 1.5), s.ry * 1.2, spl, 0.7 * fade);
      if (size > 0) {
        // Two droplets bouncing out sideways.
        const sx = (0.06 + 0.12 * size) * f;
        const sy = s.ground + 4 * f * (1 - f) * (0.04 + 0.12 * size);
        col[0] = spl[0] * 0.8;
        col[1] = spl[1] * 0.8;
        col[2] = spl[2] * 0.8;
        splat(s.ix, out, lx - sx, sy, s.rx * 1.2, s.ry * 1.1, col, 0.8 * fade);
        splat(s.ix, out, lx + sx, sy, s.rx * 1.2, s.ry * 1.1, col, 0.8 * fade);
      }
    }
  }
}
