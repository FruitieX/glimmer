export const meta = {
  name: "Warp Speed",
  description: "Stars streaming out from the centre as if flying through space.",
  category: "Particles & physics",
  colors: [
    { id: "star", label: "Stars", default: "#ffffff" },
    { id: "streak", label: "Streaks", default: "#6fa8ff" },
    { id: "space", label: "Space", default: "#02030a" },
  ],
  params: {
    stars: { type: "number", label: "Stars", min: 5, max: 80, step: 1, default: 24 },
    speed: { type: "number", label: "Speed", min: 0.05, max: 1, step: 0.01, default: 0.3 },
    streaks: { type: "number", label: "Streak length", min: 0, max: 0.3, step: 0.01, default: 0.12 },
  },
  looks: [
    { name: "Hyperspace", params: { stars: 60, speed: 0.8, streaks: 0.25 }, colors: ["#ffffff", "#4060ff", "#010210"] },
    { name: "Cruise", params: { stars: 20, speed: 0.12, streaks: 0.04 }, colors: ["#fff0d0", "#ffb060", "#030208"] },
    { name: "Nebula", params: { stars: 36 }, colors: ["#ffe0ff", "#d030ff", "#0a0218"] },
    { name: "Emerald", params: { speed: 0.5, streaks: 0.18 }, colors: ["#e0fff0", "#20ff80", "#010a06"] },
  ],
};

// Each star takes 1 / speed seconds to fly past; after CYCLES of those every
// star is back where it started.
const CYCLES = 8;

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
  const { n, x, y, spacing, aspect } = ctx;
  const gx = gapOf(x, n, spacing), gy = gapOf(y, n, spacing);
  const flat = gy === 0;
  return {
    ix: makeIndex(x, y, n, 12),
    flat,
    asp: flat ? 1 : clamp(aspect || 1, 0.3, 3),
    rx: gx === 0 ? 1e3 : Math.max(gx * 1.1, 0.015),
    ry: gy === 0 ? 1e3 : gy * 1.1,
  };
}

function radius(r0, p) {
  return r0 / (1 - 0.97 * p);
}

export function render(ctx, s) {
  const { n, out, params, colors, t } = ctx;
  const star = colors[0] || [1, 1, 1];
  const tint = colors[1] || [0.44, 0.66, 1];
  const bg = colors[2] || [0.01, 0.01, 0.04];
  for (let i = 0; i < n; i++) out.set(bg, i * 3);
  const count = Math.round(params.stars);
  const col = [0, 0, 0];
  for (let k = 0; k < count; k++) {
    const q = t * params.speed + hash(k, 1);
    const p = fract(q);
    const cyc = ((Math.floor(q) % CYCLES) + CYCLES) % CYCLES;
    const ang = hash(k * 17 + cyc, 2) * TAU;
    const r0 = 0.02 + 0.03 * hash(k * 17 + cyc, 3);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const r = radius(r0, p);
    if (r > 1.2) continue;
    const rt = radius(r0, Math.max(0, p - params.streaks * p));
    const fadeIn = 0.08 + 0.92 * p * p;
    // Close stars are whiter, far ones take the streak colour.
    const m = smoothstep(0.3, 0.9, p);
    col[0] = lerp(tint[0], star[0], m) * fadeIn;
    col[1] = lerp(tint[1], star[1], m) * fadeIn;
    col[2] = lerp(tint[2], star[2], m) * fadeIn;
    const sx = s.flat ? 1.0 : 1 / s.asp;
    streak(s.ix, out, 0.5 + ca * r * sx, 0.5 + sa * r, 0.5 + ca * rt * sx, 0.5 + sa * rt, s.rx, s.ry, col, 0.9, 0.1);
  }
}
