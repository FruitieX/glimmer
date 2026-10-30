export const meta = {
  name: "Pong",
  description: "Two self-playing paddles rally a softly glowing ball, and the scorer's side lights up after a miss.",
  category: "Simulations & games",
  colors: [
    { id: "left", label: "Player one", default: "#2fb8ff" },
    { id: "right", label: "Player two", default: "#ff6a3d" },
    { id: "ball", label: "Ball", default: "#fff2cc" },
    { id: "background", label: "Background", default: "#030308" },
  ],
  params: {
    speed: { type: "number", label: "Ball speed", min: 2, max: 20, step: 0.5, default: 8 },
    skill: { type: "number", label: "Player skill", min: 0, max: 1, step: 0.01, default: 0.8 },
    paddle: { type: "number", label: "Paddle size", min: 1, max: 5, step: 0.5, default: 3 },
    glow: { type: "number", label: "Ball glow", min: 0.3, max: 2, step: 0.05, default: 1 },
  },
};

// Logical field in grid units, mapped onto the LEDs by position. The game is
// played along the longer side; on a straight string, along the string.
export function setup(ctx) {
  const { n, x, y } = ctx;
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
  const alongY = !line && H >= W;
  const La = alongY ? H - 1 : W - 1, Lb = line ? 0 : alongY ? W - 1 : H - 1;
  const A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gx = x[i] * (W - 1), gy = line ? 0 : y[i] * (H - 1);
    A[i] = alongY ? gy : gx;
    B[i] = alongY ? gx : gy;
  }
  const s = { A, B, La, Lb, line, pad: [Lb / 2, Lb / 2], aim: [Lb / 2, Lb / 2], miss: [false, false], flash: [0, 0], wait: 0.6, ba: 0, bb: 0, va: 0, vb: 0, sp: 0 };
  serve(s, ctx.params, Math.random() < 0.5 ? 1 : -1);
  return s;
}

function serve(s, params, dir) {
  s.ba = s.La / 2;
  s.bb = s.Lb * (0.3 + Math.random() * 0.4);
  s.sp = params.speed;
  const ang = (Math.random() - 0.5) * (s.line ? 0 : 1.1);
  s.va = Math.cos(ang) * dir;
  s.vb = Math.sin(ang);
  plan(s, params);
}

// Where will the ball cross the paddle line? Reflect off the side walls.
function plan(s, params) {
  const side = s.va < 0 ? 0 : 1;
  const dist = side === 0 ? s.ba - 1 : s.La - 1 - s.ba;
  let b = s.bb + (s.vb / Math.abs(s.va)) * Math.max(0, dist);
  if (s.Lb > 0) {
    const p = 2 * s.Lb;
    b = ((b % p) + p) % p;
    if (b > s.Lb) b = p - b;
  }
  const hw = paddleHalf(s, params);
  const misses = Math.random() > 0.35 + params.skill * 0.64;
  s.miss[side] = misses;
  s.aim[side] = misses
    ? b + (Math.random() < 0.5 ? -1 : 1) * (hw + 1.6)
    : b + (Math.random() - 0.5) * hw * 1.2;
  s.aim[1 - side] = s.Lb / 2;
}

function paddleHalf(s, params) {
  return s.Lb > 0 ? Math.min(params.paddle, s.Lb) / 2 : 0.5;
}

function advance(s, params, dt) {
  const hw = paddleHalf(s, params);
  // Paddles glide towards their aim.
  for (let k = 0; k < 2; k++) {
    const target = clamp(s.aim[k], hw - 0.5, s.Lb - hw + 0.5);
    const d = target - s.pad[k];
    const v = Math.min(Math.abs(d), dt * params.speed * 0.9);
    s.pad[k] += Math.sign(d) * v;
    s.flash[k] = Math.max(0, s.flash[k] - dt * 1.2);
  }
  if (s.wait > 0) { s.wait -= dt; return; }
  s.ba += s.va * s.sp * dt;
  s.bb += s.vb * s.sp * dt;
  if (s.Lb > 0) {
    if (s.bb < 0) { s.bb = -s.bb; s.vb = Math.abs(s.vb); }
    if (s.bb > s.Lb) { s.bb = 2 * s.Lb - s.bb; s.vb = -Math.abs(s.vb); }
  }
  const side = s.va < 0 ? 0 : 1;
  const line = side === 0 ? 1 : s.La - 1;
  const crossed = side === 0 ? s.ba <= line : s.ba >= line;
  if (crossed && !s.passed) {
    const off = s.bb - s.pad[side];
    if (!s.miss[side] && Math.abs(off) <= hw + 0.7) {
      s.ba = 2 * line - s.ba;
      s.va = -s.va;
      if (s.Lb > 0) {
        s.vb = clamp(s.vb * 0.5 + (off / (hw + 0.7)) * 0.8, -0.85, 0.85);
        s.va = Math.sign(s.va) * Math.sqrt(1 - s.vb * s.vb);
      }
      s.sp = Math.min(s.sp * 1.04, params.speed * 1.6);
      s.flash[side] = Math.max(s.flash[side], 0.25);
      plan(s, params);
    } else {
      s.passed = true;
    }
  }
  if (s.ba < -2 || s.ba > s.La + 2) {
    s.passed = false;
    const scorer = s.ba < 0 ? 1 : 0;
    s.flash[scorer] = 1;
    s.wait = 1.2;
    serve(s, params, scorer === 0 ? 1 : -1);
  }
}

export function render(ctx, s) {
  const { n, out, colors, params } = ctx;
  let dt = Math.min(ctx.dt, 0.25);
  while (dt > 0) {
    const h = Math.min(dt, 0.02);
    advance(s, params, h);
    dt -= h;
  }
  const c0 = colors[0] || [0.2, 0.7, 1];
  const c1 = colors[1] || [1, 0.4, 0.2];
  const cb = colors[2] || [1, 0.95, 0.8];
  const bg = colors[3] || [0, 0, 0];
  const { A, B, La } = s;
  const hw = paddleHalf(s, params);
  const sig = 0.45 * params.glow, halo = 1.6 * params.glow;
  const ballVis = s.wait > 0 ? clamp(1 - s.wait / 0.4) : 1;
  for (let i = 0; i < n; i++) {
    const a = A[i], b = B[i];
    const across0 = s.Lb > 0 ? clamp(hw + 0.5 - Math.abs(b - s.pad[0])) : 1;
    const across1 = s.Lb > 0 ? clamp(hw + 0.5 - Math.abs(b - s.pad[1])) : 1;
    const p0 = clamp(1 - a * 1.2) * across0 * (0.7 + 0.3 * s.flash[0]);
    const p1 = clamp(1 - (La - a) * 1.2) * across1 * (0.7 + 0.3 * s.flash[1]);
    // The scorer's half glows briefly.
    const half = a / La;
    const f0 = s.flash[0] > 0.3 ? (s.flash[0] - 0.3) * 0.35 * (1 - half) : 0;
    const f1 = s.flash[1] > 0.3 ? (s.flash[1] - 0.3) * 0.35 * half : 0;
    const da = a - s.ba, db = b - s.bb;
    const d2 = da * da + db * db;
    const kb = (Math.exp(-d2 / (2 * sig * sig)) * 0.9 + Math.exp(-d2 / (2 * halo * halo)) * 0.18) * ballVis;
    const o = i * 3;
    for (let c = 0; c < 3; c++) {
      out[o + c] = bg[c] + c0[c] * (p0 + f0) + c1[c] * (p1 + f1) + cb[c] * kb;
    }
  }
}
