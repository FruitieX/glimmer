export const meta = {
  name: "Christmas snowy tree",
  description: "A snow-dusted tree with twinkling baubles and a glowing star; a bauble garland on a long string.",
  category: "Seasonal",
  colors: [
    { id: "tree", label: "Tree", default: "#0b8a2e" },
    { id: "bauble1", label: "Baubles", default: "#ff1e1e" },
    { id: "bauble2", label: "Baubles 2", default: "#ffaa1e" },
    { id: "bauble3", label: "Baubles 3", default: "#3c64ff" },
    { id: "star", label: "Star", default: "#ffd458" },
    { id: "snow", label: "Snow", default: "#e6f2ff" },
    { id: "sky", label: "Sky", default: "#040c2c" },
  ],
  params: {
    baubles: { type: "number", label: "Baubles", min: 0, max: 1, step: 0.01, default: 0.4 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    snow: { type: "number", label: "Snowfall", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Golden", params: { baubles: 0.6 }, colors: ["#0a8030", "#ffc020", "#ff8000", "#fff0b0", "#fff0a0", "#fff8e8", "#040a20"] },
    { name: "Frosty", params: { snow: 0.85 }, colors: ["#0a7a50", "#a0d0ff", "#e8f0ff", "#4080ff", "#e0f0ff", "#ffffff", "#020a28"] },
    { name: "Candy", params: { baubles: 0.7, speed: 1.4 }, colors: ["#10a030", "#ff2a8a", "#a040ff", "#20d0ff", "#ffe060", "#fff0f8", "#0a0420"] },
    { name: "Quiet night", params: { baubles: 0.25, speed: 0.6, snow: 0.3 }, colors: ["#086a24", "#ff1010", "#ffe0a0", "#ff1010", "#ffc040", "#d8e8ff", "#02061a"] },
  ],
};

const PERIOD = 30;
const FLAKES = 14;
// Tiers of the tree: bottom, top and half-width at the bottom.
const TIERS = [
  [0.14, 0.5, 0.47],
  [0.38, 0.72, 0.36],
  [0.58, 0.87, 0.25],
];
const BARK = [0.28, 0.13, 0.04];

export function loop(params) {
  return PERIOD / params.speed;
}

// The tree doesn't move, so its shape is worked out once per LED.
export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = {
    wide,
    tree: new Float32Array(n),
    dust: new Float32Array(n),
    trunk: new Float32Array(n),
    ground: new Float32Array(n),
    star: new Float32Array(n),
    halo: new Float32Array(n),
    shade: new Float32Array(n),
    pick: new Float32Array(n),
    hue: new Uint8Array(n),
    cyc: new Uint8Array(n),
    phase: new Float32Array(n),
    fx: new Float32Array(FLAKES),
    fy: new Float32Array(FLAKES),
  };
  for (let i = 0; i < n; i++) {
    s.pick[i] = hash(i, 7);
    s.hue[i] = Math.floor(hash(i, 8) * 3);
    s.cyc[i] = 1 + Math.floor(hash(i, 6) * 4);
    s.phase[i] = hash(i, 9);
    if (wide) {
      const led = Math.round(u[i] * (n - 1));
      s.shade[i] = 0.32 + 0.14 * Math.sin(led * 2.3) + 0.08 * Math.sin(led * 0.7);
      // A bauble on every fifth LED, the colours taking turns.
      s.tree[i] = led % 5 === 2 ? 1 : 0;
      s.hue[i] = Math.floor(led / 5) % 3;
      s.phase[i] = hash(led, 9);
      continue;
    }
    const xi = x[i], yi = y[i];
    const dx = Math.abs(xi - 0.5);
    s.ground[i] = smoothstep(0.09, 0.02, yi);
    s.trunk[i] = smoothstep(0.1, 0.06, dx) * smoothstep(0.17, 0.12, yi) * (1 - s.ground[i] * 0.6);
    let inside = 0, dusting = 0;
    for (let k = 0; k < 3; k++) {
      const tb = TIERS[k][0], tt = TIERS[k][1];
      if (yi < tb - 0.03 || yi > tt + 0.03) continue;
      const w = (TIERS[k][2] * (tt - yi)) / (tt - tb);
      const a = smoothstep(-0.05, 0.05, w - dx) * smoothstep(tb - 0.03, tb + 0.02, yi);
      if (a > inside) {
        inside = a;
        dusting = smoothstep(tb + 0.08, tb + 0.01, yi) * (0.45 + 0.55 * smoothstep(0, w + 0.05, dx));
      }
    }
    s.tree[i] = inside;
    s.dust[i] = dusting;
    s.shade[i] = 0.55 + 0.25 * Math.sin(yi * 31 + xi * 7) * Math.sin(xi * 19);
    // The star: a bright core with four soft points.
    const sx = (xi - 0.5) * aspect, sy = yi - 0.95;
    const sd = sx * sx + sy * sy;
    const rays = Math.exp(-sx * sx * 900 - sy * sy * 60) + Math.exp(-sy * sy * 900 - sx * sx * 40);
    s.star[i] = Math.exp(-sd * 300) * 1.3 + rays * 0.55;
    s.halo[i] = Math.exp(-sd * 30) * 0.18;
  }
  return s;
}

export function render(ctx, s) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const tree = colors[0] || [0.04, 0.54, 0.18];
  const nb = Math.max(1, Math.min(3, colors.length - 4));
  const star = colors[4] || [1, 0.83, 0.35];
  const snow = colors[5] || [0.9, 0.95, 1];
  const sky = colors[6] || [0.02, 0.05, 0.17];
  const p = (t * params.speed) / PERIOD;
  const density = params.baubles;

  if (s.wide) {
    // A garland: needles, a bauble every few LEDs and a gentle glow running along.
    const waves = Math.max(1, Math.round(n / 60));
    const glints = 0.025 * (0.3 + params.snow);
    for (let i = 0; i < n; i++) {
      const g = s.shade[i];
      const run = Math.pow(0.5 + 0.5 * Math.cos(TAU * (ctx.u[i] * waves - p * 6)), 4);
      let r = tree[0] * g, gr = tree[1] * g, b = tree[2] * g;
      if (s.tree[i] > 0 && s.pick[i] < 0.4 + density * 0.6) {
        const c = colors[1 + (s.hue[i] % nb)] || star;
        const tw = 0.5 + 0.5 * Math.cos(TAU * (p * s.cyc[i] + s.phase[i]));
        const k = (0.5 + 0.4 * tw) * (0.8 + 0.4 * run);
        r = c[0] * k;
        gr = c[1] * k;
        b = c[2] * k;
      } else {
        // An occasional snowy glint on the needles, otherwise the warm glow.
        const q = p * 60 + s.phase[i] * 60;
        const f = fract(q);
        let k = 0;
        if (hash(i * 31 + Math.floor(q), 4) < glints) k = Math.exp(-f * 6) * 0.8;
        r += star[0] * run * 0.25;
        gr += star[1] * run * 0.25;
        b += star[2] * run * 0.25;
        r += (snow[0] - r) * k;
        gr += (snow[1] - gr) * k;
        b += (snow[2] - b) * k;
      }
      const o = i * 3;
      out[o] = r;
      out[o + 1] = gr;
      out[o + 2] = b;
    }
    return;
  }

  // Falling snow behind the tree; flake positions once per frame.
  const flakes = Math.round(FLAKES * params.snow);
  for (let f = 0; f < flakes; f++) {
    const laps = 3 + (f % 3);
    s.fy[f] = 1.1 - fract(p * laps + hash(f, 1)) * 1.25;
    s.fx[f] = hash(f, 2) + 0.05 * Math.sin(TAU * (p * (5 + f) + hash(f, 3)));
  }
  const pulse = 0.8 + 0.2 * Math.sin(TAU * p * 8);
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    const sk = 0.55 + 0.45 * yi;
    let r = sky[0] * sk, g = sky[1] * sk, b = sky[2] * sk;
    for (let f = 0; f < flakes; f++) {
      const ey = yi - s.fy[f];
      if (ey > 0.07 || ey < -0.07) continue;
      const ex = (xi - s.fx[f]) * aspect;
      const d = (ex * ex + ey * ey) * 900;
      if (d < 4) {
        const k = Math.exp(-d) * 0.7;
        r += (snow[0] - r) * k;
        g += (snow[1] - g) * k;
        b += (snow[2] - b) * k;
      }
    }
    const ground = s.ground[i];
    if (ground > 0) {
      r += (snow[0] * 0.55 - r) * ground;
      g += (snow[1] * 0.55 - g) * ground;
      b += (snow[2] * 0.55 - b) * ground;
    }
    const trunk = s.trunk[i];
    if (trunk > 0) {
      r += (BARK[0] - r) * trunk;
      g += (BARK[1] - g) * trunk;
      b += (BARK[2] - b) * trunk;
    }
    const inside = s.tree[i];
    if (inside > 0) {
      const shade = s.shade[i], dusting = s.dust[i];
      let tr = tree[0] * shade, tg = tree[1] * shade, tbl = tree[2] * shade;
      tr += (snow[0] * 0.85 - tr) * dusting;
      tg += (snow[1] * 0.85 - tg) * dusting;
      tbl += (snow[2] * 0.85 - tbl) * dusting;
      if (dusting < 0.4 && s.pick[i] < density * 0.5) {
        const c = colors[1 + (s.hue[i] % nb)] || star;
        const lum = 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(TAU * (p * s.cyc[i] + s.phase[i])));
        tr = c[0] * lum;
        tg = c[1] * lum;
        tbl = c[2] * lum;
      }
      r += (tr - r) * inside;
      g += (tg - g) * inside;
      b += (tbl - b) * inside;
    }
    // The star on top glows and slowly pulses.
    const sk2 = clamp(s.star[i] * pulse + s.halo[i]);
    if (sk2 > 0.002) {
      r += (star[0] - r) * sk2;
      g += (star[1] - g) * sk2;
      b += (star[2] - b) * sk2;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
