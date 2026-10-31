export const meta = {
  name: "Christmas twinkling star",
  description: "A golden five-pointed star slowly turning and shimmering in a sky of tiny twinkling stars.",
  category: "Seasonal",
  colors: [
    { id: "star", label: "Star", default: "#ffc83c" },
    { id: "core", label: "Centre", default: "#fff4cc" },
    { id: "twinkles", label: "Little stars", default: "#cfe0ff" },
    { id: "sky", label: "Sky", default: "#050b2e" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    turn: { type: "number", label: "Turning", min: 0, max: 3, step: 1, default: 1 },
    size: { type: "number", label: "Size", min: 0.25, max: 0.5, step: 0.01, default: 0.42 },
    twinkles: { type: "number", label: "Little stars", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Silver star", params: { turn: 0 }, colors: ["#c8dcff", "#ffffff", "#ffe0b0", "#030820"] },
    { name: "Big bright", params: { size: 0.5, twinkles: 0.8 }, colors: ["#ffb000", "#ffffe0", "#e0e8ff", "#040a28"] },
    { name: "Fast spin", params: { speed: 1.8, turn: 3, size: 0.34 }, colors: ["#ff9a20", "#fff0a0", "#ffd0f0", "#0a0420"] },
    { name: "Red star", params: { twinkles: 0.3 }, colors: ["#ff1a20", "#ffd060", "#fff0d0", "#08020e"] },
  ],
};

const PERIOD = 40;
const SEG = TAU / 5;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const s = { pick: new Float32Array(n), phase: new Float32Array(n), cyc: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    s.pick[i] = hash(i, 1);
    s.phase[i] = hash(i, 2);
    s.cyc[i] = 2 + Math.floor(hash(i, 3) * 5);
  }
  return s;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect, spacing } = ctx;
  const gold = colors[0] || [1, 0.78, 0.24];
  const core = colors[1] || [1, 0.96, 0.8];
  const tw = colors[2] || [0.8, 0.88, 1];
  const sky = colors[3] || [0.02, 0.04, 0.18];
  const p = (t * params.speed) / PERIOD;
  const wide = aspect > 2.5;
  const R = params.size;
  const rin = R * 0.42;
  // The star's edge from an outer point (R, 0) to the inner corner beside it.
  const ix = rin * Math.cos(SEG / 2), iy = rin * Math.sin(SEG / 2);
  const ex = ix - R, ey = iy;
  const el = Math.hypot(ex, ey);
  const nx = ey / el, ny = -ex / el;
  const rot = TAU * p * params.turn + PI / 2;
  const soft = Math.max(spacing, 0.03);
  const shimmer = TAU * p * 7;
  const glow = 0.92 + 0.08 * Math.sin(TAU * p * 10);
  // On a long string, one star every 60 LEDs or so.
  const stars = wide ? Math.max(1, Math.round(n / 60)) : 1;
  const thr = params.twinkles * 0.2;
  for (let i = 0; i < n; i++) {
    let dx, dy;
    if (wide) {
      // Each star spans about 24 LEDs; measure in "star radii" along the string.
      const c = fract(u[i] * stars) - 0.5;
      dx = (c * (n - 1)) / stars / 12;
      dy = 0;
    } else {
      dx = (x[i] - 0.5) * aspect;
      dy = y[i] - 0.52;
    }
    let r, sd, halo;
    if (wide) {
      // Along a string the star is a glowing stretch with rays pulsing outwards.
      r = Math.abs(dx);
      sd = r - R * 0.6;
      halo = sd > 0 ? Math.exp(-sd * 4) * 0.35 * (0.7 + 0.3 * Math.cos(r * 6 - shimmer)) : 0;
    } else {
      r = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      let a = ang - rot;
      a = fract(a / SEG) * SEG - SEG / 2;
      const qx = r * Math.cos(a), qy = r * Math.abs(Math.sin(a));
      sd = (qx - R) * nx + qy * ny;
      // Outside: a soft halo with slowly circling rays.
      halo = sd > 0 ? Math.exp(-sd * 9) * 0.35 * (0.55 + 0.45 * Math.cos(ang * 10 - shimmer)) : 0;
    }
    const fill = smoothstep(soft, -soft, sd);
    // Inside: brighter towards the centre, with light rippling outwards.
    const ripple = 0.9 + 0.1 * Math.cos(r * 18 - shimmer * 2);
    const centre = Math.exp(-(r * r) / (R * R * 0.05)) * 0.8;
    let br = sky[0] * 0.6, bg = sky[1] * 0.6, bb = sky[2] * 0.6;
    // Little stars twinkle where the big one isn't.
    if (s.pick[i] < thr) {
      const k = Math.pow(0.5 + 0.5 * Math.cos(TAU * (p * s.cyc[i] * 3 + s.phase[i])), 3) * (1 - fill) * (0.35 + 0.4 * s.phase[i]);
      br += (tw[0] - br) * k;
      bg += (tw[1] - bg) * k;
      bb += (tw[2] - bb) * k;
    }
    const o = i * 3;
    const kf = fill * glow * ripple;
    const kh = (1 - fill) * halo * glow;
    for (let ch = 0; ch < 3; ch++) {
      const b0 = ch === 0 ? br : ch === 1 ? bg : bb;
      const sc = gold[ch] + (core[ch] - gold[ch]) * centre;
      out[o + ch] = b0 * (1 - fill) + sc * kf + gold[ch] * kh;
    }
  }
}
