export const meta = {
  name: "Game of Life",
  description: "Conway's cellular automaton with cells that fade in and out and change colour as they age.",
  category: "Simulations & games",
  colors: [
    { id: "young", label: "Newborn", default: "#7dffb0" },
    { id: "old", label: "Old", default: "#2f5dff" },
    { id: "background", label: "Background", default: "#03040a" },
  ],
  params: {
    speed: { type: "number", label: "Generations per second", min: 0.5, max: 10, step: 0.1, default: 3 },
    density: { type: "number", label: "Starting density", min: 0.1, max: 0.6, step: 0.01, default: 0.33 },
    fade: { type: "number", label: "Fade", min: 0, max: 1, step: 0.01, default: 0.6 },
    brightness: { type: "number", label: "Brightness", min: 0.2, max: 1, step: 0.01, default: 0.8 },
  },
  looks: [
    { name: "Fire", params: {}, colors: ["#ffe060", "#ff2000", "#050100"] },
    { name: "Ocean", params: {}, colors: ["#80fff0", "#0040ff", "#000410"] },
    { name: "Neon", params: { speed: 6, fade: 0.3 }, colors: ["#ff40ff", "#4000ff", "#03000a"] },
    { name: "Blossom", params: { speed: 1, density: 0.45, fade: 0.9 }, colors: ["#ff80d0", "#ff2060", "#050104"] },
  ],
};

// Logical grid mapped onto the LEDs by position. On a curtain the grid
// matches the LED columns and rows; on a straight string it is one row.
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

function blit(g, cells, out, n) {
  const { idx, wt } = g;
  for (let i = 0; i < n; i++) {
    let r = 0, gg = 0, b = 0;
    for (let k = 0; k < 4; k++) {
      const c = idx[i * 4 + k] * 3, w = wt[i * 4 + k];
      r += cells[c] * w; gg += cells[c + 1] * w; b += cells[c + 2] * w;
    }
    out[i * 3] = r; out[i * 3 + 1] = gg; out[i * 3 + 2] = b;
  }
}

function seed(s, density) {
  for (let i = 0; i < s.cur.length; i++) {
    s.cur[i] = Math.random() < density ? 1 : 0;
    s.age[i] = 0;
  }
  s.history.fill(-1);
  s.still = 0;
}

export function setup(ctx) {
  const g = makeGrid(ctx, 10, 20, Math.max(16, Math.min(60, Math.round(ctx.n / 3))));
  const size = g.W * g.H;
  const s = {
    g,
    cur: new Uint8Array(size),
    next: new Uint8Array(size),
    age: new Float32Array(size), // generations alive (kept while fading out)
    level: new Float32Array(size), // displayed brightness 0..1
    cells: new Float32Array(size * 3),
    history: new Float64Array(24),
    hpos: 0,
    acc: 0,
    still: 0,
    dying: 0,
  };
  seed(s, ctx.params.density);
  return s;
}

function step(s) {
  const { W, H, line } = s.g;
  const { cur, next } = s;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      let nb = 0;
      if (line) {
        // One-dimensional Life (radius 2): survive on 2 or 4, born on 2 or 3.
        for (let d = -2; d <= 2; d++) if (d) nb += cur[(c + d + W) % W];
        next[i] = cur[i] ? (nb === 2 || nb === 4 ? 1 : 0) : (nb === 2 || nb === 3 ? 1 : 0);
      } else {
        for (let dy = -1; dy <= 1; dy++) {
          const rr = ((r + dy + H) % H) * W;
          for (let dx = -1; dx <= 1; dx++) if (dx || dy) nb += cur[rr + ((c + dx + W) % W)];
        }
        next[i] = nb === 3 || (cur[i] && nb === 2) ? 1 : 0;
      }
    }
  }
  let alive = 0, h = 7;
  for (let i = 0; i < cur.length; i++) {
    if (next[i]) { s.age[i] = cur[i] ? s.age[i] + 1 : 0; alive++; h = (h * 31 + i + 1) % 2147483647; }
    cur[i] = next[i];
  }
  // Stagnation: few cells, or a state seen in the recent past (still life or oscillator).
  let seen = false;
  for (let k = 0; k < s.history.length; k++) if (s.history[k] === h) seen = true;
  s.history[s.hpos] = h;
  s.hpos = (s.hpos + 1) % s.history.length;
  if (seen || alive < 3) s.still++;
  else s.still = 0;
  return s.still > 6;
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  const dt = Math.min(ctx.dt, 0.25);
  const tick = 1 / params.speed;
  s.acc += dt;
  while (s.acc >= tick) {
    s.acc -= tick;
    if (s.dying > 0) continue;
    if (step(s)) s.dying = 1.2;
  }
  if (s.dying > 0) {
    s.dying -= dt;
    s.cur.fill(0);
    if (s.dying <= 0) { seed(s, params.density); s.acc = 0; }
  }
  const young = colors[0] || [0.5, 1, 0.7];
  const old = colors[1] || [0.2, 0.4, 1];
  const bg = colors[2] || [0, 0, 0];
  // Fade time follows the tick length so slow and fast games both look smooth.
  const rate = 1 / Math.max(0.03, tick * (0.15 + params.fade * 1.2));
  const kUp = 1 - Math.exp(-dt * rate * 1.5), kDown = 1 - Math.exp(-dt * rate);
  const { cells, level, age, cur } = s;
  const br = params.brightness;
  for (let i = 0; i < cur.length; i++) {
    const target = cur[i];
    level[i] += (target - level[i]) * (target > level[i] ? kUp : kDown);
    const a = clamp(age[i] / 8);
    const l = level[i] * br;
    const o = i * 3;
    cells[o] = bg[0] + (young[0] + (old[0] - young[0]) * a - bg[0]) * l;
    cells[o + 1] = bg[1] + (young[1] + (old[1] - young[1]) * a - bg[1]) * l;
    cells[o + 2] = bg[2] + (young[2] + (old[2] - young[2]) * a - bg[2]) * l;
  }
  blit(s.g, cells, out, n);
}
