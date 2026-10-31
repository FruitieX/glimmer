export const meta = {
  name: "Halloween cauldron",
  description: "A witch's cauldron over a crackling fire, its green brew bubbling and steaming purple mist.",
  category: "Seasonal",
  colors: [
    { id: "brew", label: "Brew", default: "#3cff4a" },
    { id: "mist", label: "Mist", default: "#a03cff" },
    { id: "fire", label: "Fire", default: "#ff6010" },
    { id: "pot", label: "Cauldron", default: "#2a2436" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    bubbles: { type: "number", label: "Bubbles", min: 1, max: 12, step: 1, default: 6 },
    mist: { type: "number", label: "Mist", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  looks: [
    { name: "Toxic", params: { speed: 1.5, bubbles: 10 }, colors: ["#a0ff20", "#30ff90", "#ff8a00", "#1a2a20"] },
    { name: "Witch's brew", params: { mist: 0.9 }, colors: ["#c040ff", "#ff40c0", "#ff5010", "#241a36"] },
    { name: "Bloodmoon", params: { speed: 0.7, bubbles: 4 }, colors: ["#ff2020", "#ff7a10", "#ff4a00", "#2a1418"] },
    { name: "Frost hex", params: { speed: 0.6, mist: 0.4 }, colors: ["#40e8ff", "#6a60ff", "#20a0ff", "#14203a"] },
  ],
};

const PERIOD = 24;
const RIM = 0.52;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { wide, pot: new Float32Array(n), rim: new Float32Array(n), fire: new Float32Array(n), bx: new Float32Array(12), by: new Float32Array(12), bk: new Float32Array(12) };
  if (!wide) {
    for (let i = 0; i < n; i++) {
      const dx = (x[i] - 0.5) * aspect, dy = (y[i] - RIM) * 1.15;
      // A round-bellied pot, cut flat at the rim.
      const r = Math.sqrt(dx * dx + dy * dy);
      s.pot[i] = smoothstep(0.43, 0.38, r) * smoothstep(RIM + 0.02, RIM - 0.02, y[i]) * smoothstep(0.1, 0.14, y[i]);
      s.rim[i] = Math.exp(-Math.pow((y[i] - RIM) / 0.025, 2)) * smoothstep(0.48, 0.42, Math.abs(dx));
      s.fire[i] = smoothstep(0.15, 0.03, y[i]) * smoothstep(0.42, 0.25, Math.abs(dx));
    }
  }
  return s;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect } = ctx;
  const brew = colors[0] || [0.24, 1, 0.29];
  const mist = colors[1] || [0.63, 0.24, 1];
  const fire = colors[2] || [1, 0.38, 0.06];
  const pot = colors[3] || [0.16, 0.14, 0.21];
  const p = (t * params.speed) / PERIOD;
  const nb = params.bubbles;
  const mk = params.mist;
  if (s.wide) {
    // Along a string: a bubbling green brew with bubbles swelling and popping,
    // purple wisps drifting through.
    const span = Math.max(1, n - 1);
    const cells = Math.max(2, Math.round(span / 10));
    // One bubble per stretch of about ten LEDs at a time; nb sets how often.
    if (!s.cl || s.cl.length < cells) {
      s.cl = new Float32Array(cells);
      s.cc = new Float32Array(cells);
    }
    for (let c = 0; c < cells; c++) {
      const cyc = Math.max(1, Math.round(nb * 0.8 + hash(c, 1) * 3));
      const q = p * cyc + hash(c, 2);
      s.cl[c] = fract(q);
      s.cc[c] = c + 0.25 + 0.5 * hash(c * 7 + Math.floor(q), 3);
    }
    for (let i = 0; i < n; i++) {
      const pos = u[i] * cells;
      const ci = Math.floor(pos);
      const slosh = 0.5 + 0.5 * Math.sin(TAU * (u[i] * 3 + p * 5)) * Math.sin(TAU * (u[i] * 7 - p * 3));
      const lv = 0.12 + 0.2 * slosh;
      let r = brew[0] * lv, g = brew[1] * lv, b = brew[2] * lv;
      const cj = clamp(ci, 0, cells - 1);
      const life = s.cl[cj];
      const d = ((pos - s.cc[cj]) * span) / cells;
      const size = 0.6 + 2.4 * life;
      const ring = Math.exp(-Math.pow((Math.abs(d) - size * 0.6) / 0.9, 2)) * (life < 0.85 ? 1 : 1 - (life - 0.85) / 0.15);
      const pop = life > 0.85 ? Math.exp(-d * d * 0.2) * (1 - (life - 0.85) / 0.15) : 0;
      const bk = clamp(ring * 0.8 + pop);
      r += (brew[0] - r) * bk;
      g += (brew[1] - g) * bk;
      b += (brew[2] - b) * bk;
      const w = mk * Math.pow(0.5 + 0.5 * Math.sin(TAU * (u[i] * 2.3 - p * 4) + 2 * Math.sin(TAU * (u[i] * 0.9 + p * 2))), 3) * 0.75;
      r += (mist[0] - r) * w;
      g += (mist[1] - g) * w;
      b += (mist[2] - b) * w;
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  // Bubbles rising from the brew surface and popping.
  for (let k = 0; k < nb; k++) {
    const cyc = 6 + (k % 4) * 2;
    const life = fract(p * cyc + hash(k, 1));
    const gen = Math.floor(p * cyc + hash(k, 1));
    s.bx[k] = 0.5 + (hash(k * 31 + gen, 2) - 0.5) * 0.55;
    s.by[k] = RIM - 0.02 + life * 0.14;
    s.bk[k] = life < 0.8 ? smoothstep(0, 0.2, life) : 1 - (life - 0.8) / 0.2;
  }
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    const dx = (xi - 0.5) * aspect;
    let r = 0.02, g = 0.0, b = 0.04;
    // Purple mist curling up from the pot.
    if (yi > RIM - 0.05) {
      const h = yi - RIM;
      const sway = Math.sin(TAU * (h * 1.6 - p * 4) + dx * 6) + 0.6 * Math.sin(TAU * (h * 2.7 + p * 3) - dx * 9);
      const col = Math.exp(-Math.pow((dx - 0.12 * Math.sin(TAU * (p * 2 + h))) / (0.18 + h * 0.4), 2));
      const w = 1.6 * mk * col * (0.45 + 0.35 * sway) * Math.exp(-h * 2.2) * smoothstep(RIM - 0.05, RIM + 0.03, yi);
      const m = clamp(h * 4);
      r += (brew[0] + (mist[0] - brew[0]) * m) * w;
      g += (brew[1] + (mist[1] - brew[1]) * m) * w;
      b += (brew[2] + (mist[2] - brew[2]) * m) * w;
    }
    // The fire under the pot.
    const fk = s.fire[i];
    if (fk > 0) {
      const flick = 0.55 + 0.25 * Math.sin(TAU * (p * 37 + xi * 3)) * Math.sin(TAU * (p * 23 - xi * 5)) + 0.2 * Math.sin(TAU * (p * 11 + xi * 7));
      const k = fk * flick;
      r += fire[0] * k;
      g += fire[1] * k * k;
      b += fire[2] * k * k;
    }
    // The pot, lit from below by the fire.
    const pk = s.pot[i];
    if (pk > 0) {
      const lit = 1 + 1.5 * smoothstep(0.3, 0.12, yi);
      r += (pot[0] * lit + fire[0] * 0.06 * (lit - 1) - r) * pk;
      g += (pot[1] * lit - g) * pk;
      b += (pot[2] * lit - b) * pk;
    }
    // The brew's surface at the rim.
    const rk = s.rim[i];
    if (rk > 0) {
      const glow = 0.55 + 0.3 * Math.sin(TAU * (xi * 2 + p * 6)) * Math.sin(TAU * (xi * 3.3 - p * 4));
      r += (brew[0] * glow - r) * rk;
      g += (brew[1] * glow - g) * rk;
      b += (brew[2] * glow - b) * rk;
    }
    for (let k = 0; k < nb; k++) {
      const ex = (xi - s.bx[k]) * aspect, ey = yi - s.by[k];
      const d = ex * ex + ey * ey;
      if (d > 0.012) continue;
      const bk = Math.exp(-d / 0.0018) * s.bk[k];
      r += (brew[0] - r) * bk;
      g += (brew[1] - g) * bk;
      b += (brew[2] - b) * bk;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
