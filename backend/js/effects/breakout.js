export const meta = {
  name: "Breakout",
  description: "A self-playing paddle bounces a glowing ball into rows of bricks until the wall is cleared.",
  category: "Simulations & games",
  colors: [
    { id: "top", label: "Top bricks", default: "#ff4f7b" },
    { id: "bottom", label: "Bottom bricks", default: "#ffb23d" },
    { id: "ball", label: "Ball and paddle", default: "#d9f4ff" },
    { id: "background", label: "Background", default: "#030308" },
  ],
  params: {
    speed: { type: "number", label: "Ball speed", min: 2, max: 20, step: 0.5, default: 10 },
    rows: { type: "number", label: "Brick rows", min: 2, max: 8, step: 1, default: 4 },
    skill: { type: "number", label: "Player skill", min: 0, max: 1, step: 0.01, default: 0.9 },
    glow: { type: "number", label: "Ball glow", min: 0.3, max: 2, step: 0.05, default: 1 },
  },
};

// Logical grid mapped onto the LEDs by position. On a curtain it matches the
// LED columns and rows; on a straight string it is a single column laid
// along the string (paddle at the start, bricks at the far end).
function makeGrid(ctx, defW, defH, lineCells) {
  const { n, x, y } = ctx;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const count = (a) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(Math.round(a[i] * 500)); return s.size; };
  let W = defW, H = defH;
  if (line) { W = 1; H = lineCells; }
  else {
    const cx = count(x), cy = count(y);
    if (cx >= 4 && cx <= 32) W = cx;
    if (cy >= 4 && cy <= 48) H = cy;
  }
  const gx = new Float32Array(n), gy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gx[i] = line ? 0 : x[i] * (W - 1);
    gy[i] = (line ? x[i] : y[i]) * (H - 1);
  }
  return { W, H, line, gx, gy };
}

function build(s, params) {
  const { W, H, line } = s.g;
  const rows = line ? Math.max(3, Math.round(H * 0.3)) : Math.min(params.rows, Math.floor(H / 2));
  s.bricks.fill(0);
  const top = line ? H - 1 : H - 2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < W; c++) s.bricks[(top - r) * W + c] = 1;
  s.left = rows * W;
  s.rows = rows;
  s.top = top;
}

function serve(s, params) {
  const { W, line } = s.g;
  s.bx = s.pad;
  s.by = 1.2;
  s.sp = params.speed;
  const ang = line ? 0 : (Math.random() - 0.5) * 1.2;
  s.vx = Math.sin(ang);
  s.vy = Math.cos(ang);
  s.wait = 0.8;
  s.aimOff = 0;
  if (W === 1) s.vx = 0;
}

export function setup(ctx) {
  const g = makeGrid(ctx, 10, 20, Math.max(16, Math.min(60, Math.round(ctx.n / 3))));
  const size = g.W * g.H;
  const s = {
    g,
    bricks: new Uint8Array(size),
    level: new Float32Array(size), // displayed brick brightness
    hit: new Float32Array(size), // flash of a brick being broken
    pad: (g.W - 1) / 2,
    bx: 0, by: 0, vx: 0, vy: 0, sp: 0, wait: 0, aimOff: 0, left: 0, rows: 0, top: 0,
    cleared: 0,
  };
  build(s, ctx.params);
  serve(s, ctx.params);
  return s;
}

function advance(s, params, dt) {
  const { W, H } = s.g;
  const hw = W > 2 ? 1.2 : 0.5;
  // Paddle follows the ball, aiming a little off-centre to steer it.
  const target = clamp(s.bx + s.aimOff, hw - 0.3, W - 1 - hw + 0.3);
  const d = target - s.pad;
  s.pad += Math.sign(d) * Math.min(Math.abs(d), dt * params.speed * (0.3 + params.skill * 0.9));
  if (s.cleared > 0) {
    s.cleared -= dt;
    if (s.cleared <= 0) { build(s, params); serve(s, params); }
    return;
  }
  if (s.wait > 0) { s.wait -= dt; s.bx = s.pad; return; }
  const ox = Math.round(s.bx), oy = Math.round(s.by);
  s.bx += s.vx * s.sp * dt;
  s.by += s.vy * s.sp * dt;
  if (s.bx < 0) { s.bx = -s.bx; s.vx = Math.abs(s.vx); }
  if (s.bx > W - 1) { s.bx = 2 * (W - 1) - s.bx; s.vx = -Math.abs(s.vx); }
  if (s.by > H - 1) { s.by = 2 * (H - 1) - s.by; s.vy = -Math.abs(s.vy); }
  const cx = clamp(Math.round(s.bx), 0, W - 1), cy = clamp(Math.round(s.by), 0, H - 1);
  const ci = cy * W + cx;
  if (s.bricks[ci]) {
    s.bricks[ci] = 0;
    s.hit[ci] = 1;
    s.left--;
    if (cy !== oy || cx === ox) s.vy = -s.vy;
    if (cx !== ox) s.vx = -s.vx;
    s.by = oy + (s.by - oy) * 0.2;
    s.sp = Math.min(s.sp * 1.01, params.speed * 1.4);
    if (s.left <= 0) s.cleared = 1.8;
  }
  if (s.vy < 0 && s.by <= 1) {
    const off = s.bx - s.pad;
    if (Math.abs(off) <= hw + 0.6) {
      s.by = 2 - s.by;
      if (W > 1) {
        s.vx = clamp(s.vx * 0.4 + (off / (hw + 0.6)) * 0.9 + (Math.random() - 0.5) * 0.2, -0.8, 0.8);
        s.vy = Math.sqrt(1 - s.vx * s.vx);
      } else s.vy = 1;
      // Next time, steer randomly; a worse player sometimes misjudges.
      s.aimOff = (Math.random() - 0.5) * hw * 1.4 + (Math.random() > params.skill ? (Math.random() < 0.5 ? -1 : 1) * (hw + 1.5) : 0);
    } else if (W === 1 && Math.random() < params.skill) {
      s.by = 2 - s.by; s.vy = 1;
    }
  }
  if (s.by < -1.5) serve(s, params);
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  let dt = Math.min(ctx.dt, 0.25);
  const fade = 1 - Math.exp(-Math.min(ctx.dt, 0.25) * 6);
  while (dt > 0) {
    const h = Math.min(dt, 0.015);
    advance(s, params, h);
    dt -= h;
  }
  const { W, gx, gy } = s.g;
  const ctop = colors[0] || [1, 0.3, 0.5];
  const cbot = colors[1] || [1, 0.7, 0.2];
  const cb = colors[2] || [0.85, 0.95, 1];
  const bg = colors[3] || [0, 0, 0];
  const { bricks, level, hit } = s;
  for (let i = 0; i < bricks.length; i++) {
    level[i] += (bricks[i] - level[i]) * fade;
    hit[i] *= 1 - fade * 0.8;
  }
  const hw = W > 2 ? 1.2 : 0.5;
  const sig = 0.45 * params.glow, halo = 1.4 * params.glow;
  const party = s.cleared > 0 ? Math.sin((1.8 - s.cleared) * PI / 1.8) : 0;
  for (let i = 0; i < n; i++) {
    const X = gx[i], Y = gy[i];
    // Bricks: nearest cells with soft weights.
    const c0 = Math.floor(X), r0 = Math.floor(Y);
    let br = 0, flash = 0, rowT = 0;
    for (let r = r0; r <= r0 + 1; r++) {
      if (r < 0 || r >= s.g.H) continue;
      const wy = 1 - Math.abs(Y - r);
      if (wy <= 0) continue;
      for (let c = c0; c <= c0 + 1; c++) {
        if (c < 0 || c >= W) continue;
        const w = (1 - Math.abs(X - c)) * wy;
        if (w <= 0) continue;
        const k = r * W + c;
        br += level[k] * w;
        flash += hit[k] * w;
        rowT += level[k] * w * clamp((s.top - r) / Math.max(1, s.rows - 1));
      }
    }
    const t = br > 0 ? rowT / br : 0;
    const shimmer = 0.75 + 0.25 * Math.sin(ctx.t * 2 + X * 0.9 + Y * 0.7);
    const dx = X - s.bx, dy = Y - s.by;
    const d2 = dx * dx + dy * dy;
    const kb = Math.exp(-d2 / (2 * sig * sig)) * 0.9 + Math.exp(-d2 / (2 * halo * halo)) * 0.15;
    const kp = clamp(1 - Y * 1.3) * clamp(hw + 0.5 - Math.abs(X - s.pad)) * 0.6;
    const o = i * 3;
    const ph = party > 0 ? hsv(Y * 0.05 + ctx.t * 0.3) : null;
    for (let c = 0; c < 3; c++) {
      const brick = ctop[c] + (cbot[c] - ctop[c]) * t;
      out[o + c] = bg[c] + brick * br * 0.75 * shimmer + cb[c] * (kb + kp + flash * 0.7) + (ph ? party * 0.25 * ph[c] : 0);
    }
  }
}
