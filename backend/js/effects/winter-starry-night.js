export const meta = {
  name: "Winter starry night",
  description: "A clear, frosty night sky: stars of every brightness scintillating over a faint Milky Way, with the odd shooting star.",
  category: "Seasonal",
  colors: [
    { id: "stars", label: "Stars", default: "#e4ecff" },
    { id: "warm", label: "Warm stars", default: "#ffd8a8" },
    { id: "milky", label: "Milky Way", default: "#2a3a7a" },
    { id: "sky", label: "Sky", default: "#020616" },
  ],
  params: {
    stars: { type: "number", label: "Stars", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    milky: { type: "number", label: "Milky Way", min: 0, max: 1, step: 0.01, default: 0.5 },
    shooting: { type: "boolean", label: "Shooting stars", default: true },
  },
};

const PERIOD = 40;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { wide, pick: new Float32Array(n), mag: new Float32Array(n), c1: new Uint8Array(n), c2: new Uint8Array(n), ph: new Float32Array(n), band: new Float32Array(n), along: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    s.pick[i] = hash(i, 1);
    // Mostly faint stars, a few bright ones.
    const m = hash(i, 2);
    s.mag[i] = 0.25 + 0.75 * m * m * m;
    s.c1[i] = 9 + Math.floor(hash(i, 3) * 20);
    s.c2[i] = 23 + Math.floor(hash(i, 4) * 30);
    s.ph[i] = hash(i, 5);
    // The Milky Way: a soft diagonal band, a little clumpy.
    if (wide) {
      const v = u[i] * Math.max(1, n / 150);
      s.band[i] = Math.pow(0.5 + 0.5 * Math.sin(TAU * v), 3) * (0.7 + 0.3 * noise(v * 9, 3.1));
      s.along[i] = u[i];
    } else {
      const d = y[i] - (0.25 + 0.6 * x[i]);
      s.band[i] = Math.exp(-d * d * 18) * (0.7 + 0.3 * noise(x[i] * 4, y[i] * 4, 1.7));
      s.along[i] = x[i];
    }
  }
  return s;
}

export function render(ctx, s) {
  const { n, y, out, colors, params, t, aspect } = ctx;
  const star = colors[0] || [0.9, 0.93, 1];
  const warm = colors[1] || [1, 0.85, 0.66];
  const milky = colors[2] || [0.16, 0.23, 0.48];
  const sky = colors[3] || [0.01, 0.02, 0.09];
  const p = (t * params.speed) / PERIOD;
  const thr = params.stars * 0.35;
  const mw = params.milky;
  // Shooting stars: two per loop, each a short streak.
  const shoot = params.shooting;
  const sq = fract(p * 2);
  const which = Math.floor(p * 2);
  const sp = sq / 0.08; // the streak lasts the first 8% of each half
  const headX = 1.1 - sp * 1.3;
  const headY = 0.95 - sp * 0.5 + 0.2 * hash(which, 7);
  for (let i = 0; i < n; i++) {
    const bnd = s.band[i] * mw;
    let r = sky[0] + milky[0] * bnd, g = sky[1] + milky[1] * bnd, b = sky[2] + milky[2] * bnd;
    // More stars where the Milky Way is.
    if (s.pick[i] < thr * (0.6 + bnd)) {
      const a = Math.cos(TAU * (p * s.c1[i] + s.ph[i]));
      const c = Math.cos(TAU * (p * s.c2[i] + s.ph[i] * 3));
      const tw = 0.7 + 0.18 * a + 0.12 * c;
      const k = s.mag[i] * tw;
      const col = s.ph[i] < 0.25 ? warm : star;
      r += (col[0] - r) * k;
      g += (col[1] - g) * k;
      b += (col[2] - b) * k;
    }
    if (shoot && sp < 1) {
      const fade = Math.sin(PI * sp);
      let d;
      if (s.wide) d = (s.along[i] - (1 - sp)) * 30;
      else {
        // Distance along and across the streak's direction (down-left).
        const dx = (s.along[i] - headX) * aspect, dy = y[i] - headY;
        const al = dx * 0.93 + dy * 0.36, ac = -dx * 0.36 + dy * 0.93;
        // A bright head with a tail trailing back up the sky.
        d = al < -0.03 ? 99 : Math.abs(al) * 2.2 + (ac * ac) / 0.0009;
      }
      const k = d >= 0 && d < 6 ? Math.exp(-d) * fade : 0;
      r += (star[0] - r) * k;
      g += (star[1] - g) * k;
      b += (star[2] - b) * k;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
