export const meta = {
  name: "New Year fireworks",
  description: "Rockets climbing into the night sky and bursting into fading, falling sparks.",
  category: "Seasonal",
  colors: [
    { id: "a", label: "Gold", default: "#ffc24a" },
    { id: "b", label: "Red", default: "#ff2d55" },
    { id: "c", label: "Blue", default: "#4f7dff" },
    { id: "d", label: "Green", default: "#3dff8a" },
  ],
  params: {
    rate: { type: "number", label: "Fireworks", min: 0.1, max: 3, step: 0.01, default: 0.7 },
    size: { type: "number", label: "Burst size", min: 0.1, max: 0.6, step: 0.01, default: 0.32 },
    trails: { type: "number", label: "Trails", min: 0.1, max: 2, step: 0.01, default: 0.7 },
    sky: { type: "number", label: "Sky brightness", min: 0, max: 0.3, step: 0.01, default: 0.05 },
  },
  looks: [
    { name: "Gold rush", params: { rate: 1.2 }, colors: ["#ffd040", "#ff9a20", "#fff0b0", "#ffb000"] },
    { name: "Grand finale", params: { rate: 2.6, size: 0.4, trails: 1 }, colors: ["#ffc24a", "#ff2080", "#40a0ff", "#a0ff40"] },
    { name: "Silver", params: { rate: 0.5, size: 0.45, trails: 1.4 }, colors: ["#ffffff", "#c0d0ff", "#8080ff", "#e0f0ff"] },
    { name: "Pastel", params: { rate: 0.9, size: 0.25, sky: 0.1 }, colors: ["#ffd0a0", "#ff90c0", "#a0c0ff", "#a0ffd0"] },
  ],
};

const MAX = 240;
const ROCKETS = 6;

export function setup(ctx) {
  return {
    buf: new Float32Array(ctx.n * 3),
    // Sparks: position, velocity, age, lifetime, colour index.
    px: new Float32Array(MAX), py: new Float32Array(MAX),
    vx: new Float32Array(MAX), vy: new Float32Array(MAX),
    age: new Float32Array(MAX), life: new Float32Array(MAX).fill(0),
    col: new Uint8Array(MAX),
    next: 0,
    // Rockets on their way up.
    rx: new Float32Array(ROCKETS), ry: new Float32Array(ROCKETS),
    rv: new Float32Array(ROCKETS), rtop: new Float32Array(ROCKETS),
    ron: new Uint8Array(ROCKETS),
    timer: 0.3,
    seed: 1,
  };
}

function rnd(s) {
  s.seed++;
  return hash(s.seed, 77);
}

function burst(s, bx, by, wide, size) {
  const c = Math.floor(rnd(s) * 4);
  const count = wide ? 14 : 22;
  for (let k = 0; k < count; k++) {
    const j = s.next;
    s.next = (s.next + 1) % MAX;
    const a = (k / count) * TAU + rnd(s) * 0.3;
    const sp = size * (0.7 + 0.5 * rnd(s)) * 1.6;
    s.px[j] = bx;
    s.py[j] = by;
    if (wide) {
      s.vx[j] = (k % 2 ? 1 : -1) * sp * (0.2 + 0.8 * rnd(s)) * 0.5;
      s.vy[j] = 0;
    } else {
      s.vx[j] = Math.cos(a) * sp * 1.25;
      s.vy[j] = Math.sin(a) * sp;
    }
    s.age[j] = 0;
    s.life[j] = 1.1 + 0.8 * rnd(s);
    s.col[j] = rnd(s) < 0.85 ? c : (c + 1) % 4;
  }
}

function splat(ctx, buf, px, py, rx, ry, r, g, b, wide) {
  const { n, x, y } = ctx;
  for (let i = 0; i < n; i++) {
    const ex = (x[i] - px) / rx;
    if (ex > 3 || ex < -3) continue;
    const ey = wide ? 0 : (y[i] - py) / ry;
    const d2 = ex * ex + ey * ey;
    if (d2 > 9) continue;
    const v = Math.exp(-d2);
    const o = i * 3;
    if (r * v > buf[o]) buf[o] = r * v;
    if (g * v > buf[o + 1]) buf[o + 1] = g * v;
    if (b * v > buf[o + 2]) buf[o + 2] = b * v;
  }
}

export function render(ctx, s) {
  const { n, out, colors, params, aspect, spacing } = ctx;
  const dt = Math.min(ctx.dt, 0.1);
  const wide = aspect > 2.5;
  const buf = s.buf;
  // Everything already drawn fades, leaving trails.
  const fade = Math.exp(-dt / (0.12 * params.trails));
  for (let i = 0; i < buf.length; i++) buf[i] *= fade;
  // Launch new fireworks now and then.
  s.timer -= dt;
  if (s.timer <= 0) {
    s.timer = (0.4 + rnd(s) * 1.2) / params.rate;
    const bx = 0.15 + 0.7 * rnd(s);
    if (wide) burst(s, bx, 0.5, true, params.size);
    else {
      for (let k = 0; k < ROCKETS; k++) {
        if (s.ron[k]) continue;
        s.ron[k] = 1;
        s.rx[k] = bx;
        s.ry[k] = -0.05;
        s.rv[k] = 1.5 + 0.3 * rnd(s);
        s.rtop[k] = 0.55 + 0.3 * rnd(s);
        break;
      }
    }
  }
  const rx = wide ? Math.max(spacing * 1.5, 0.008) : 0.07;
  const ry = wide ? 1 : Math.max(spacing * 1.1, 0.045);
  // Rockets: a dim warm spark climbing, slowing as it rises.
  for (let k = 0; k < ROCKETS; k++) {
    if (!s.ron[k]) continue;
    s.ry[k] += s.rv[k] * dt;
    s.rv[k] = Math.max(0.3, s.rv[k] - 1.3 * dt);
    s.rx[k] += Math.sin(s.ry[k] * 20) * 0.01 * dt;
    splat(ctx, buf, s.rx[k], s.ry[k], rx * 0.8, ry, 0.55, 0.38, 0.2, wide);
    if (s.ry[k] >= s.rtop[k]) {
      s.ron[k] = 0;
      burst(s, s.rx[k], s.ry[k], false, params.size);
    }
  }
  // Sparks: fly out, slow down, fall and fade.
  const drag = Math.exp(-dt * 1.6);
  for (let j = 0; j < MAX; j++) {
    if (s.age[j] >= s.life[j]) continue;
    s.age[j] += dt;
    s.vx[j] *= drag;
    s.vy[j] = s.vy[j] * drag - 0.35 * dt;
    s.px[j] += s.vx[j] * dt;
    s.py[j] += s.vy[j] * dt;
    const a = s.age[j] / s.life[j];
    if (a >= 1) continue;
    // Young sparks are hot and pale; old ones dim and flicker out.
    const k = Math.pow(1 - a, 1.5) * (a > 0.6 ? 0.6 + 0.4 * hash(j * 7 + Math.floor(s.age[j] * 20), 3) : 1);
    const c = colors[s.col[j]] || [1, 0.8, 0.3];
    const hot = Math.max(0, 1 - a * 5) * 0.5;
    splat(
      ctx, buf, s.px[j], s.py[j], rx, ry,
      (c[0] + (1 - c[0]) * hot) * k,
      (c[1] + (1 - c[1]) * hot) * k,
      (c[2] + (1 - c[2]) * hot) * k,
      wide,
    );
  }
  const sky = params.sky;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    out[o] = Math.min(1, buf[o] + sky * 0.15);
    out[o + 1] = Math.min(1, buf[o + 1] + sky * 0.2);
    out[o + 2] = Math.min(1, buf[o + 2] + sky * 0.6);
  }
}
