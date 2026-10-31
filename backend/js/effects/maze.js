export const meta = {
  name: "Maze",
  description: "A maze is carved out passage by passage, flooded from the entrance, and its solution traced in light.",
  category: "Simulations & games",
  colors: [
    { id: "passage", label: "Passages", default: "#2a3f8f" },
    { id: "flood", label: "Search", default: "#21d6c4" },
    { id: "path", label: "Solution", default: "#ffc94a" },
    { id: "wall", label: "Walls", default: "#020206" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 2, max: 40, step: 1, default: 12 },
    hold: { type: "number", label: "Show solution for", min: 0.5, max: 10, step: 0.5, default: 3, unit: "s" },
    brightness: { type: "number", label: "Brightness", min: 0.2, max: 1, step: 0.01, default: 0.8 },
  },
  looks: [
    { name: "Neon", params: { speed: 20 }, colors: ["#6a20e0", "#ff20c0", "#40ff40", "#020004"] },
    { name: "Ember", params: { brightness: 0.9 }, colors: ["#c03000", "#ff8020", "#fff080", "#040100"] },
    { name: "Glacier", params: { speed: 8, hold: 5 }, colors: ["#2060c0", "#60e0ff", "#ffffff", "#010308"] },
    { name: "Forest", params: { speed: 30, hold: 1.5 }, colors: ["#10a040", "#a0ff30", "#ff6040", "#010401"] },
  ],
};

// The maze lives on a pixel grid (cells at odd coordinates, walls between),
// laid onto a curtain's columns and rows. On a straight string the pixel
// grid is read row by row in a zigzag along the string.
export function setup(ctx) {
  // Small effect sizes put LEDs outside 0..1: repeat the grid there.
  const { n } = ctx;
  const x = ctx.x.map(tile), y = ctx.y.map(tile);
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = 10, H = 21;
  if (!line) {
    const cx = count(x), cy = count(y);
    if (cx >= 5 && cx <= 32) W = cx;
    if (cy >= 5 && cy <= 48) H = cy;
  }
  let mw = Math.max(2, (W - 1) >> 1), mh = Math.max(2, (H - 1) >> 1);
  if (line) { mw = 4; mh = Math.max(3, Math.min(12, Math.round((n / 9 - 1) / 2))); }
  const PW = mw * 2 + 1, PH = mh * 2 + 1, size = PW * PH;
  // Up to two pixels (with weights) per LED.
  const pa = new Int32Array(n * 4), pw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (line) {
      const u = x[i] * (size - 1);
      const k0 = Math.floor(u), k1 = Math.min(k0 + 1, size - 1), f = u - k0;
      const zig = (k) => { const r = (k / PW) | 0, c = k % PW; return r * PW + (r & 1 ? PW - 1 - c : c); };
      pa[o] = zig(k0); pa[o + 1] = zig(k1); pa[o + 2] = pa[o + 3] = 0;
      pw[o] = 1 - f; pw[o + 1] = f; pw[o + 2] = pw[o + 3] = 0;
    } else {
      // Grid columns beyond the maze show as wall.
      const gx = x[i] * (W - 1), gy = y[i] * (H - 1);
      const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
      const at = (c, r) => (c >= 0 && c < PW && r >= 0 && r < PH ? r * PW + c : -1);
      pa[o] = at(x0, y0); pa[o + 1] = at(x0 + 1, y0); pa[o + 2] = at(x0, y0 + 1); pa[o + 3] = at(x0 + 1, y0 + 1);
      pw[o] = (1 - fx) * (1 - fy); pw[o + 1] = fx * (1 - fy); pw[o + 2] = (1 - fx) * fy; pw[o + 3] = fx * fy;
    }
  }
  const s = {
    n, PW, PH, mw, mh, pa, pw,
    open: new Uint8Array(size),
    dist: new Int32Array(size),
    onPath: new Uint8Array(size),
    disp: new Float32Array(size * 3),
    stack: [], queue: [], next: [], path: [],
    phase: "carve", acc: 0, timer: 0, layer: 0, shown: 0,
  };
  newMaze(s);
  return s;
}

function newMaze(s) {
  s.open.fill(0);
  s.dist.fill(-1);
  s.onPath.fill(0);
  const start = s.PW + 1;
  s.open[start] = 1;
  s.stack = [start];
  s.phase = "carve";
  s.layer = 0;
  s.shown = 0;
  s.timer = 0;
}

function carveStep(s) {
  const { PW, PH } = s;
  while (s.stack.length) {
    const c = s.stack[s.stack.length - 1];
    const cx = c % PW, cy = (c / PW) | 0;
    const opts = [];
    if (cx > 2 && !s.open[c - 2]) opts.push(-1);
    if (cx < PW - 3 && !s.open[c + 2]) opts.push(1);
    if (cy > 2 && !s.open[c - 2 * PW]) opts.push(-PW);
    if (cy < PH - 3 && !s.open[c + 2 * PW]) opts.push(PW);
    if (!opts.length) { s.stack.pop(); continue; }
    const d = opts[(Math.random() * opts.length) | 0];
    s.open[c + d] = 1;
    s.open[c + 2 * d] = 1;
    s.stack.push(c + 2 * d);
    return true;
  }
  return false;
}

function startSolve(s) {
  const start = s.PW + 1;
  s.dist[start] = 0;
  s.queue = [start];
  s.layer = 0;
  s.phase = "solve";
}

function solveStep(s) {
  const goal = (s.PH - 2) * s.PW + s.PW - 2;
  const next = [];
  s.layer++;
  for (const c of s.queue) {
    for (const d of [-1, 1, -s.PW, s.PW]) {
      const k = c + d;
      if (s.open[k] && s.dist[k] < 0) { s.dist[k] = s.layer; next.push(k); }
    }
  }
  s.queue = next;
  if (s.dist[goal] >= 0 || !next.length) {
    // Walk back from the goal to the entrance.
    const path = [];
    let c = goal;
    while (c >= 0 && s.dist[c] > 0) {
      path.push(c);
      let best = -1;
      for (const d of [-1, 1, -s.PW, s.PW]) if (s.dist[c + d] === s.dist[c] - 1) best = c + d;
      c = best;
    }
    path.push(s.PW + 1);
    s.path = path.reverse();
    s.shown = 0;
    s.phase = "trace";
  }
}

export function render(ctx, s) {
  const { out, colors, params } = ctx;
  const dt = Math.min(ctx.dt, 0.25);
  const step = 1 / params.speed;
  s.acc += dt;
  while (s.acc >= step) {
    s.acc -= step;
    if (s.phase === "carve") { if (!carveStep(s)) startSolve(s); }
    else if (s.phase === "solve") solveStep(s);
    else if (s.phase === "trace") {
      if (s.shown < s.path.length) s.onPath[s.path[s.shown++]] = 1;
      else s.phase = "hold";
    }
  }
  if (s.phase === "hold") {
    s.timer += dt;
    if (s.timer > params.hold) { s.phase = "fade"; s.timer = 0; }
  } else if (s.phase === "fade") {
    s.timer += dt;
    if (s.timer > 1.5) newMaze(s);
  }
  const passage = colors[0] || [0.15, 0.25, 0.55];
  const flood = colors[1] || [0.1, 0.85, 0.75];
  const pathC = colors[2] || [1, 0.8, 0.3];
  const wall = colors[3] || [0, 0, 0];
  const head = s.phase === "carve" && s.stack.length ? s.stack[s.stack.length - 1] : -1;
  const fadeOut = s.phase === "fade";
  const k = 1 - Math.exp(-dt * (fadeOut ? 3 : 9));
  const { disp, open, dist, onPath } = s;
  const span = Math.max(1, s.layer);
  for (let i = 0; i < open.length; i++) {
    let r = wall[0], g = wall[1], b = wall[2];
    if (open[i] && !fadeOut) {
      r = passage[0] * 0.6; g = passage[1] * 0.6; b = passage[2] * 0.6;
      if (dist[i] >= 0) {
        // Searched area: brightest at the wavefront, settling behind it.
        const behind = s.phase === "solve" ? s.layer - dist[i] : 99;
        const front = Math.exp(-behind * 0.5);
        const t = 0.35 + 0.65 * front;
        const tint = 0.5 + 0.5 * (dist[i] / span);
        r = lerp(r, flood[0] * tint, t); g = lerp(g, flood[1] * tint, t); b = lerp(b, flood[2] * tint, t);
      }
      if (onPath[i]) { r = pathC[0]; g = pathC[1]; b = pathC[2]; }
      if (i === head) { r = 0.6 + passage[0] * 0.4; g = 0.6 + passage[1] * 0.4; b = 0.6 + passage[2] * 0.4; }
    }
    const o = i * 3;
    disp[o] += (r - disp[o]) * k; disp[o + 1] += (g - disp[o + 1]) * k; disp[o + 2] += (b - disp[o + 2]) * k;
  }
  const { pa, pw, n } = s;
  const br = params.brightness;
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, b = 0;
    for (let q = 0; q < 4; q++) {
      const w = pw[i * 4 + q];
      if (w <= 0) continue;
      const p = pa[i * 4 + q];
      if (p < 0) { r += wall[0] * w; g += wall[1] * w; b += wall[2] * w; continue; }
      r += disp[p * 3] * w; g += disp[p * 3 + 1] * w; b += disp[p * 3 + 2] * w;
    }
    out[i * 3] = r * br; out[i * 3 + 1] = g * br; out[i * 3 + 2] = b * br;
  }
}
