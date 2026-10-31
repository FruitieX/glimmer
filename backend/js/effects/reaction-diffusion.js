export const meta = {
  name: "Reaction Diffusion",
  description: "A Gray-Scott chemical reaction that grows dividing spots, worms and corals.",
  category: "Simulations & games",
  colors: [
    { id: "low", label: "Edge", default: "#1b4dff" },
    { id: "high", label: "Core", default: "#5dffd1" },
    { id: "background", label: "Background", default: "#02030a" },
  ],
  params: {
    pattern: {
      type: "select",
      label: "Pattern",
      options: ["mitosis", "spots", "worms", "coral"],
      labels: ["Dividing cells", "Spots", "Worms", "Coral"],
      default: "mitosis",
    },
    speed: { type: "number", label: "Reaction speed", min: 20, max: 300, step: 10, default: 80 },
    seeds: { type: "number", label: "New seeds", min: 0, max: 1, step: 0.01, default: 0.4 },
    contrast: { type: "number", label: "Contrast", min: 1, max: 6, step: 0.1, default: 2.5 },
  },
};

// Diffusion scaled down from the classic setup so the patterns fit a few LEDs.
const DU = 0.4;

const PRESETS = {
  mitosis: [0.0367, 0.0649],
  spots: [0.035, 0.065],
  worms: [0.029, 0.057],
  coral: [0.0545, 0.062],
};

// The reaction runs on a grid twice as fine as the LEDs (a curtain's columns
// and rows, or one row on a straight string), averaged down for display.
function makeGrid(ctx, defW, defH, lineCells) {
  // Small effect sizes put LEDs outside 0..1: repeat the grid there.
  const { n } = ctx;
  const x = ctx.x.map(tile), y = ctx.y.map(tile);
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = defW, H = defH;
  if (line) { W = lineCells; H = 1; }
  else {
    const cx = count(x), cy = count(y);
    if (cx >= 4 && cx <= 32) W = cx;
    if (cy >= 4 && cy <= 48) H = cy;
  }
  const idx = new Int32Array(n * 4), wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const px = x[i] * (W - 1), py = line ? 0 : y[i] * (H - 1);
    const x0 = Math.min(Math.floor(px), Math.max(W - 2, 0)), y0 = Math.min(Math.floor(py), Math.max(H - 2, 0));
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const fx = clamp(px - x0), fy = clamp(py - y0);
    const o = i * 4;
    idx[o] = y0 * W + x0; idx[o + 1] = y0 * W + x1; idx[o + 2] = y1 * W + x0; idx[o + 3] = y1 * W + x1;
    wt[o] = (1 - fx) * (1 - fy); wt[o + 1] = fx * (1 - fy); wt[o + 2] = (1 - fx) * fy; wt[o + 3] = fx * fy;
  }
  return { W, H, line, idx, wt };
}

export function setup(ctx) {
  const g = makeGrid(ctx, 10, 20, Math.max(16, Math.min(60, Math.round(ctx.n / 3))));
  const SW = g.W * 2, SH = g.line ? 1 : g.H * 2;
  const size = SW * SH;
  // Neighbour indices, wrapping around the edges (left/right twice on a string).
  const nl = new Int32Array(size), nr = new Int32Array(size), nu = new Int32Array(size), nd = new Int32Array(size);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = y * SW + x;
      nl[i] = y * SW + ((x - 1 + SW) % SW);
      nr[i] = y * SW + ((x + 1) % SW);
      nu[i] = SH === 1 ? nl[i] : ((y + 1) % SH) * SW + x;
      nd[i] = SH === 1 ? nr[i] : ((y - 1 + SH) % SH) * SW + x;
    }
  }
  const s = {
    g, SW, SH, nl, nr, nu, nd,
    u: new Float32Array(size).fill(1), v: new Float32Array(size),
    u2: new Float32Array(size), v2: new Float32Array(size),
    disp: new Float32Array(g.W * g.H),
    cells: new Float32Array(g.W * g.H * 3),
    acc: 0, timer: 0, alt: 0,
  };
  for (let k = 0; k < (g.line ? 4 : 6); k++) blob(s, 1);
  return s;
}

// Drops reagent V into a small disc (or clears one when `add` is 0).
function blob(s, add) {
  const { SW, SH } = s;
  const cx = Math.random() * SW, cy = Math.random() * SH, r = 3.5;
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      let dx = Math.abs(x - cx), dy = Math.abs(y - cy);
      dx = Math.min(dx, SW - dx); dy = Math.min(dy, SH - dy);
      if (SH === 1) dy = 0;
      if (dx * dx + dy * dy <= r * r * (add ? 1 : 2)) {
        const i = y * SW + x;
        if (add) { s.u[i] = 0.5; s.v[i] = 0.25 + Math.random() * 0.05; }
        else { s.u[i] = 1; s.v[i] = 0; }
      }
    }
  }
}

function iterate(s, F, k) {
  const { u, v, u2, v2, nl, nr, nu, nd } = s;
  const fk = F + k, du = DU * 0.25, dv = DU * 0.125;
  for (let i = 0; i < u.length; i++) {
    const U = u[i], V = v[i];
    const a = nl[i], b = nr[i], c = nu[i], d = nd[i];
    const uvv = U * V * V;
    u2[i] = U + du * (u[a] + u[b] + u[c] + u[d] - 4 * U) - uvv + F * (1 - U);
    v2[i] = V + dv * (v[a] + v[b] + v[c] + v[d] - 4 * V) + uvv - fk * V;
  }
  s.u = u2; s.u2 = u; s.v = v2; s.v2 = v;
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  const dt = Math.min(ctx.dt, 0.1);
  let [F, k] = PRESETS[params.pattern] || PRESETS.mitosis;
  // Spots don't survive in one dimension; strings grow coral-like pulses instead.
  if (s.SH === 1 && F < 0.04) [F, k] = PRESETS.coral;
  s.acc += dt * params.speed;
  let iters = 0;
  while (s.acc >= 1 && iters < 24) { s.acc -= 1; iterate(s, F, k); iters++; }
  if (s.acc > 1) s.acc = 0;
  // Keep it alive: drop fresh seeds, and wipe a patch now and then so the
  // pattern keeps regrowing instead of freezing.
  s.timer += dt;
  const every = lerp(30, 2, params.seeds);
  if (params.seeds > 0 && s.timer > every) {
    s.timer = 0;
    let total = 0;
    for (let i = 0; i < s.v.length; i++) total += s.v[i];
    const mean = total / s.v.length;
    if (mean < 0.01) { blob(s, 1); blob(s, 1); }
    else blob(s, (s.alt++ & 1) || mean < 0.08 ? 1 : 0);
  }
  const { W, H } = s.g;
  const { SW, SH, disp, cells } = s;
  const lo = colors[0] || [0.1, 0.3, 1];
  const hi = colors[1] || [0.35, 1, 0.8];
  const bg = colors[2] || [0, 0, 0];
  const fy = SH === 1 ? 1 : 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = 0; dy < fy; dy++) for (let dx = 0; dx < 2; dx++) sum += s.v[(y * fy + dy) * SW + x * 2 + dx];
      const val = clamp((sum / (2 * fy)) * params.contrast);
      const i = y * W + x;
      disp[i] += (val - disp[i]) * Math.min(1, dt * 8);
      const t = disp[i];
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        const a = t < 0.5 ? bg[c] + (lo[c] - bg[c]) * t * 2 : lo[c] + (hi[c] - lo[c]) * (t - 0.5) * 2;
        cells[o + c] = a * 0.85;
      }
    }
  }
  const { idx, wt } = s.g;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    for (let q = 0; q < 4; q++) {
      const c = idx[i * 4 + q] * 3, w = wt[i * 4 + q];
      r += cells[c] * w; g += cells[c + 1] * w; b += cells[c + 2] * w;
    }
    out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
  }
}
