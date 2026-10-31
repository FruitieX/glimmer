export const meta = {
  name: "Elementary Automaton",
  description: "Wolfram's one-dimensional cellular automata such as rule 30 and rule 110, scrolling generation by generation.",
  category: "Simulations & games",
  colors: [
    { id: "new", label: "Newest row", default: "#ffd35c" },
    { id: "old", label: "Oldest row", default: "#d1307a" },
    { id: "background", label: "Background", default: "#04030a" },
  ],
  params: {
    rule: {
      type: "select",
      label: "Rule",
      options: ["30", "110", "90", "150", "45", "73", "184"],
      labels: ["Rule 30", "Rule 110", "Rule 90", "Rule 150", "Rule 45", "Rule 73", "Rule 184"],
      default: "30",
    },
    speed: { type: "number", label: "Generations per second", min: 0.5, max: 12, step: 0.5, default: 4 },
    start: { type: "select", label: "Start", options: ["single", "random"], labels: ["Single cell", "Random"], default: "single" },
    brightness: { type: "number", label: "Brightness", min: 0.2, max: 1, step: 0.01, default: 0.75 },
  },
};

// Logical grid mapped onto the LEDs by position. On a curtain, new
// generations appear at the top and scroll down; on a straight string the
// current generation is shown along the string, cross-fading to the next.
export function setup(ctx) {
  // Small effect sizes put LEDs outside 0..1: repeat the grid there.
  const { n } = ctx;
  const x = ctx.x.map(tile), y = ctx.y.map(tile);
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = 10, H = 20;
  if (line) { W = Math.max(16, Math.min(60, Math.round(n / 3))); H = 1; }
  else {
    const cx = count(x), cy = count(y);
    if (cx >= 4 && cx <= 32) W = cx;
    if (cy >= 4 && cy <= 48) H = cy;
  }
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let i = 0; i < n; i++) { gx[i] = x[i] * (W - 1); gy[i] = line ? 0 : y[i] * (H - 1); }
  const R = H + 3;
  const s = { W, H, R, line, gx, gy, rows: new Uint8Array(W * R), head: 0, acc: 0, hashes: new Float64Array(48), hpos: 0, stale: 0, rule: "", start: "" };
  return s;
}

function seed(s, start) {
  s.rows.fill(0);
  const row = s.head * s.W;
  if (start === "random") for (let c = 0; c < s.W; c++) s.rows[row + c] = Math.random() < 0.5 ? 1 : 0;
  else s.rows[row + (s.W >> 1)] = 1;
  s.hashes.fill(-1);
  s.stale = 0;
}

function generate(s, rule) {
  const { W, R } = s;
  const prev = s.head * W;
  s.head = (s.head + 1) % R;
  const cur = s.head * W;
  let h = 17, alive = 0;
  for (let c = 0; c < W; c++) {
    const l = s.rows[prev + ((c - 1 + W) % W)], m = s.rows[prev + c], r = s.rows[prev + ((c + 1) % W)];
    const v = (rule >> ((l << 2) | (m << 1) | r)) & 1;
    s.rows[cur + c] = v;
    alive += v;
    h = (h * 3 + v) % 1e15;
  }
  // A small wrapped row soon repeats itself; nudge it after a while.
  let seen = alive === 0 || alive === W;
  for (let k = 0; k < s.hashes.length; k++) if (s.hashes[k] === h) seen = true;
  s.hashes[s.hpos] = h;
  s.hpos = (s.hpos + 1) % s.hashes.length;
  s.stale = seen ? s.stale + 1 : 0;
  if (s.stale > (s.line ? 12 : s.H * 1.5)) {
    s.rows[cur + ((Math.random() * W) | 0)] ^= 1;
    if (alive === 0 || alive === W) s.rows[cur + ((Math.random() * W) | 0)] ^= 1;
    s.stale = 0;
  }
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  const rule = parseInt(params.rule, 10) || 30;
  if (s.rule !== params.rule || s.start !== params.start) {
    s.rule = params.rule;
    s.start = params.start;
    seed(s, params.start);
  }
  const dt = Math.min(ctx.dt, 0.25);
  const step = 1 / params.speed;
  s.acc += dt;
  while (s.acc >= step) {
    s.acc -= step;
    generate(s, rule);
  }
  const p = ease.inOut(clamp(s.acc / step));
  const cn = colors[0] || [1, 0.8, 0.35];
  const co = colors[1] || [0.8, 0.2, 0.5];
  const bg = colors[2] || [0, 0, 0];
  const { W, H, R, rows, gx, gy, line } = s;
  const br = params.brightness;
  const cell = (age, c) => rows[((s.head - age + R * 4) % R) * W + c];
  for (let i = 0; i < n; i++) {
    const X = gx[i];
    const c0 = Math.min(Math.floor(X), W - 1), c1 = Math.min(c0 + 1, W - 1), fx = X - c0;
    let v, ageT;
    if (line) {
      const now = cell(0, c0) * (1 - fx) + cell(0, c1) * fx;
      const before = cell(1, c0) * (1 - fx) + cell(1, c1) * fx;
      v = lerp(before, now, p);
      ageT = 0;
    } else {
      // Fractional age: the newest row slides in from above the top.
      const a = H - gy[i] - p;
      const a0 = Math.floor(a), fa = a - a0;
      const at = (ag) => (ag < 0 ? 0 : cell(ag, c0) * (1 - fx) + cell(ag, c1) * fx);
      v = at(a0) * (1 - fa) + at(a0 + 1) * fa;
      ageT = clamp(a / H);
    }
    const o = i * 3;
    for (let c = 0; c < 3; c++) out[o + c] = bg[c] + (cn[c] + (co[c] - cn[c]) * ageT - bg[c]) * v * br;
  }
}
