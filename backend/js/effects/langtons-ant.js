export const meta = {
  name: "Langton's Ant",
  description: "Ants turn left or right depending on the colour beneath them and repaint the grid as they go.",
  category: "Simulations & games",
  colors: [
    { id: "fresh", label: "Fresh paint", default: "#ff8a3d" },
    { id: "trail", label: "Old paint", default: "#7a3cff" },
    { id: "ant", label: "Ant", default: "#fff4d6" },
    { id: "background", label: "Background", default: "#030208" },
  ],
  params: {
    speed: { type: "number", label: "Steps per second", min: 1, max: 40, step: 1, default: 10 },
    ants: { type: "number", label: "Ants", min: 1, max: 4, step: 1, default: 2 },
    rule: {
      type: "select",
      label: "Rule",
      options: ["RL", "RLR", "LLRR", "LRRRRRLLR"],
      labels: ["Classic", "Chaotic", "Symmetric", "Square builder"],
      default: "RL",
    },
    steps: { type: "number", label: "Steps before restarting", min: 100, max: 3000, step: 50, default: 800 },
  },
  looks: [
    { name: "Highway", params: { speed: 30, ants: 1, steps: 2500 }, colors: ["#30ff80", "#1050c0", "#ffffff", "#010604"] },
    { name: "Chaos", params: { rule: "RLR", ants: 3 }, colors: ["#ff3060", "#ffa000", "#e0f0ff", "#060104"] },
    { name: "Symmetric", params: { rule: "LLRR", speed: 20 }, colors: ["#00e0ff", "#c040ff", "#fff0a0", "#02030a"] },
    { name: "Builder", params: { rule: "LRRRRRLLR", speed: 25, ants: 4, steps: 1500 }, colors: ["#ffd000", "#ff3000", "#ffffff", "#060200"] },
  ],
};

// Logical grid mapped onto the LEDs by position. On a curtain the grid
// matches the LED columns and rows; on a straight string it is one row, where
// "turn right" keeps going and "turn left" turns around.
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
  const gx = new Float32Array(n), gy = new Float32Array(n);
  const idx = new Int32Array(n * 4), wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const px = x[i] * (W - 1), py = line ? 0 : y[i] * (H - 1);
    gx[i] = px; gy[i] = py;
    const x0 = Math.min(Math.floor(px), Math.max(W - 2, 0)), y0 = Math.min(Math.floor(py), Math.max(H - 2, 0));
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const fx = clamp(px - x0), fy = clamp(py - y0);
    const o = i * 4;
    idx[o] = y0 * W + x0; idx[o + 1] = y0 * W + x1; idx[o + 2] = y1 * W + x0; idx[o + 3] = y1 * W + x1;
    wt[o] = (1 - fx) * (1 - fy); wt[o + 1] = fx * (1 - fy); wt[o + 2] = (1 - fx) * fy; wt[o + 3] = fx * fy;
  }
  return { W, H, line, gx, gy, idx, wt };
}

const DX = [0, 1, 0, -1], DY = [1, 0, -1, 0];

function reset(s, params) {
  const { W, H, line } = s.g;
  s.state.fill(0);
  s.ants = [];
  for (let k = 0; k < params.ants; k++) {
    const x = Math.floor(W * (0.25 + 0.5 * Math.random())), y = Math.floor(H * (0.3 + 0.4 * Math.random()));
    const dir = line ? (Math.random() < 0.5 ? 1 : 3) : (Math.random() * 4) | 0;
    s.ants.push({ x, y, px: x, py: y, dir });
  }
  s.count = 0;
  s.clearing = 0;
}

export function setup(ctx) {
  const g = makeGrid(ctx, 10, 20, Math.max(16, Math.min(60, Math.round(ctx.n / 3))));
  const size = g.W * g.H;
  const s = { g, state: new Uint8Array(size), painted: new Float32Array(size), cells: new Float32Array(size * 3), ants: [], acc: 0, count: 0, clearing: 0 };
  reset(s, ctx.params);
  return s;
}

function tick(s, rule) {
  const { W, H, line } = s.g;
  const m = rule.length;
  for (const a of s.ants) {
    const i = a.y * W + a.x;
    const st = s.state[i] % m;
    const right = rule[st] === "R";
    if (line) { if (!right) a.dir = (a.dir + 2) % 4; }
    else a.dir = (a.dir + (right ? 1 : 3)) % 4;
    s.state[i] = (st + 1) % m;
    s.painted[i] = s.count;
    a.px = a.x; a.py = a.y;
    a.x = (a.x + DX[a.dir] + W) % W;
    a.y = (a.y + DY[a.dir] + H) % H;
  }
  s.count++;
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  const dt = Math.min(ctx.dt, 0.25);
  const step = 1 / params.speed;
  const rule = params.rule || "RL";
  if (s.clearing > 0) {
    s.clearing -= dt;
    if (s.clearing <= 0) { reset(s, params); s.acc = 0; }
  } else {
    s.acc += dt;
    while (s.acc >= step) {
      s.acc -= step;
      tick(s, rule);
      if (s.count >= params.steps) { s.clearing = 1.5; s.state.fill(0); break; }
    }
  }
  const c2 = colors[0] || [1, 0.55, 0.25];
  const c1 = colors[1] || [0.5, 0.25, 1];
  const ca = colors[2] || [1, 0.95, 0.85];
  const bg = colors[3] || [0, 0, 0];
  const m = rule.length;
  const { cells, state } = s;
  const k = 1 - Math.exp(-dt / Math.max(0.05, step * 1.5));
  for (let i = 0; i < state.length; i++) {
    const st = state[i] % m;
    const o = i * 3;
    for (let c = 0; c < 3; c++) {
      // Recently painted cells start in the fresh colour and age into the old one.
      const age = clamp((s.count - s.painted[i]) / 40);
      const v = m > 2 ? 0.35 + 0.65 * (st / (m - 1)) : 1;
      const target = st === 0 ? bg[c] : bg[c] + (lerp(c2[c], c1[c], age) - bg[c]) * 0.6 * v;
      cells[o + c] += (target - cells[o + c]) * k;
    }
  }
  const { idx, wt, gx, gy, W, H } = s.g;
  const p = s.clearing > 0 ? 1 : ease.inOut(clamp(s.acc / step));
  const antVis = s.clearing > 0 ? clamp(s.clearing / 1.5) : 1;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    for (let q = 0; q < 4; q++) {
      const c = idx[i * 4 + q] * 3, w = wt[i * 4 + q];
      r += cells[c] * w; g += cells[c + 1] * w; b += cells[c + 2] * w;
    }
    let ka = 0;
    for (const a of s.ants) {
      // Glide between cells, but not across the wrap-around edge.
      const wrap = Math.abs(a.x - a.px) > 1 || Math.abs(a.y - a.py) > 1;
      const ax = wrap ? a.x : lerp(a.px, a.x, p), ay = wrap ? a.y : lerp(a.py, a.y, p);
      const dx = gx[i] - ax, dy = gy[i] - ay;
      ka = Math.max(ka, clamp(1 - Math.sqrt(dx * dx + dy * dy) * 1.1));
    }
    ka *= ka * antVis * 0.9;
    const o = i * 3;
    out[o] = r + (ca[0] - r) * ka;
    out[o + 1] = g + (ca[1] - g) * ka;
    out[o + 2] = b + (ca[2] - b) * ka;
  }
}
