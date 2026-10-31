export const meta = {
  name: "Winter calm snowfall",
  description: "Big soft flakes drifting slowly down a quiet blue evening onto glistening snowbanks. Made for leaving on.",
  category: "Seasonal",
  colors: [
    { id: "snow", label: "Snow", default: "#f0f6ff" },
    { id: "sky", label: "Sky", default: "#0a1a4a" },
    { id: "horizon", label: "Horizon", default: "#1e3a7a" },
  ],
  params: {
    flakes: { type: "number", label: "Flakes", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 2, step: 0.01, default: 0.6 },
    sky: { type: "number", label: "Sky brightness", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Blizzard", params: { flakes: 0.95, speed: 1.4 }, colors: ["#ffffff", "#0a1430", "#2a3a60"] },
    { name: "Midnight", params: { flakes: 0.3, speed: 0.4, sky: 0.3 }, colors: ["#d8e4ff", "#020624", "#0a1a50"] },
    { name: "Twilight", params: { flakes: 0.6 }, colors: ["#fff0f8", "#1a0a40", "#5a2a70"] },
    { name: "Arctic", params: { speed: 0.5, sky: 0.6 }, colors: ["#e8fcff", "#020a1a", "#0a4a5a"] },
  ],
};

const PERIOD = 60;
const MAX = 24;
const CELL = 8; // LEDs per flake slot on a string

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const cells = Math.ceil(n / CELL) + 3;
  const s = {
    fx: new Float32Array(MAX),
    fy: new Float32Array(MAX),
    fs: new Float32Array(MAX),
    glint: new Float32Array(n),
    // Per stretch of string: the flake's position and brightness this frame.
    cx: new Float32Array(cells),
    ck: new Float32Array(cells),
  };
  for (let i = 0; i < n; i++) s.glint[i] = hash(i, 9);
  return s;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect } = ctx;
  const snow = colors[0] || [0.94, 0.96, 1];
  const sky = colors[1] || [0.04, 0.1, 0.29];
  const hor = colors[2] || [0.12, 0.23, 0.48];
  const p = (t * params.speed) / PERIOD;
  const sb = params.sky;
  if (aspect > 2.5) {
    // Along a string: each stretch of a few LEDs has a flake that drifts
    // into view, lingers and melts away, swaying a little as it goes.
    const span = Math.max(1, n - 1);
    const thr = 0.25 + 0.75 * params.flakes;
    const cells = s.cx.length;
    for (let j = 0; j < cells; j++) {
      const c = j - 1;
      const cyc = 4 + Math.floor(hash(c, 1) * 5);
      const q = p * cyc + hash(c, 2);
      const gen = Math.floor(q);
      const life = q - gen;
      const env = Math.sin(PI * life);
      s.ck[j] = hash(c * 13 + gen, 3) > thr ? 0 : env * env * 0.9;
      s.cx[j] = c + 0.2 + 0.6 * hash(c * 7 + gen, 4) + 0.35 * Math.sin(TAU * life + c);
    }
    for (let i = 0; i < n; i++) {
      const pos = (u[i] * span) / CELL;
      const ci = Math.floor(pos);
      const h = 0.5 + 0.5 * Math.sin(TAU * (u[i] * 1.5 + p * 2));
      let r = (sky[0] + (hor[0] - sky[0]) * h) * sb, g = (sky[1] + (hor[1] - sky[1]) * h) * sb, b = (sky[2] + (hor[2] - sky[2]) * h) * sb;
      for (let j = ci; j <= ci + 2 && j < cells; j++) {
        if (s.ck[j] <= 0) continue;
        const d = (pos - s.cx[j]) * CELL;
        const k = Math.exp(-d * d * 0.45) * s.ck[j];
        if (k > 0.002) {
          r += (snow[0] - r) * k;
          g += (snow[1] - g) * k;
          b += (snow[2] - b) * k;
        }
      }
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  const count = Math.round(MAX * params.flakes);
  for (let f = 0; f < count; f++) {
    // Whole numbers of falls per loop; nearer flakes are bigger and faster.
    const near = hash(f, 5);
    const laps = 2 + Math.floor(near * 3);
    s.fy[f] = 1.15 - fract(p * laps + hash(f, 1)) * 1.3;
    s.fx[f] = hash(f, 2) + 0.07 * Math.sin(TAU * (p * (3 + (f % 4)) + hash(f, 3)));
    s.fs[f] = 0.55 + 0.45 * near;
  }
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    // Darker overhead, lighter near the horizon.
    const h = smoothstep(0.9, 0.15, yi);
    let r = (sky[0] + (hor[0] - sky[0]) * h) * sb, g = (sky[1] + (hor[1] - sky[1]) * h) * sb, b = (sky[2] + (hor[2] - sky[2]) * h) * sb;
    // Gentle snowbanks along the bottom, glistening now and then.
    const bank = 0.12 + 0.04 * Math.sin(xi * 7 + 1) + 0.02 * Math.sin(xi * 17);
    const bk = smoothstep(bank + 0.04, bank - 0.03, yi);
    if (bk > 0) {
      const gl = s.glint[i] < 0.3 ? Math.pow(0.5 + 0.5 * Math.cos(TAU * (p * (5 + Math.floor(s.glint[i] * 20)) + s.glint[i] * 3)), 8) * 0.4 : 0;
      const lv = 0.5 + gl;
      r += (snow[0] * lv - r) * bk;
      g += (snow[1] * lv - g) * bk;
      b += (snow[2] * lv - b) * bk;
    }
    for (let f = 0; f < count; f++) {
      const ey = yi - s.fy[f];
      if (ey > 0.09 || ey < -0.09) continue;
      const ex = (xi - s.fx[f]) * aspect;
      const rr = 0.06 * s.fs[f];
      const d = (ex * ex + ey * ey) / (rr * rr);
      if (d < 5) {
        const k = Math.exp(-d) * (0.5 + 0.45 * s.fs[f]);
        r += (snow[0] - r) * k;
        g += (snow[1] - g) * k;
        b += (snow[2] - b) * k;
      }
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
