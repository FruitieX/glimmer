export const meta = {
  name: "Vappu sima",
  description: "A glass of golden May Day sima: streams of fizzy bubbles, a frothy top and raisins bobbing up when it's ready.",
  category: "Seasonal",
  colors: [
    { id: "sima", label: "Sima", default: "#ffb412" },
    { id: "light", label: "Light", default: "#fff07a" },
    { id: "foam", label: "Foam", default: "#fff8e6" },
    { id: "raisin", label: "Raisins", default: "#3a1206" },
  ],
  params: {
    fizz: { type: "number", label: "Fizz", min: 0, max: 1, step: 0.01, default: 0.6 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    raisins: { type: "number", label: "Raisins", min: 0, max: 4, step: 1, default: 3 },
  },
  looks: [
    { name: "Lime fizz", params: { fizz: 0.9, speed: 1.4 }, colors: ["#a0ff00", "#e8ff80", "#f8ffe8", "#1a0a04"] },
    { name: "Dark sima", params: { fizz: 0.4, speed: 0.7 }, colors: ["#ff7a00", "#ffc040", "#fff0d0", "#280804"] },
    { name: "Still", params: { fizz: 0.2, speed: 0.4, raisins: 1 }, colors: ["#ffc400", "#fff4b0", "#ffffff", "#3a1206"] },
    { name: "Pink sima", params: { raisins: 2 }, colors: ["#ff4a6a", "#ffa0b0", "#fff0f4", "#300614"] },
  ],
};

const PERIOD = 30;
const STREAMS = 7;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const s = { sx: new Float32Array(STREAMS), rx: new Float32Array(4), ry: new Float32Array(4), off: new Float32Array(n) };
  for (let i = 0; i < n; i++) s.off[i] = hash(i, 4);
  return s;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect } = ctx;
  const sima = colors[0] || [1, 0.7, 0.07];
  const light = colors[1] || [1, 0.94, 0.48];
  const foam = colors[2] || [1, 0.97, 0.9];
  const raisin = colors[3] || [0.23, 0.07, 0.02];
  const p = (t * params.speed) / PERIOD;
  const fz = params.fizz;
  const nr = params.raisins;
  if (aspect > 2.5) {
    // Along a string: golden light rippling, bubbles fizzing up as quick
    // glints, raisins drifting slowly as dark spots.
    const span = Math.max(1, n - 1);
    for (let r0 = 0; r0 < nr; r0++) s.rx[r0] = fract(hash(r0, 1) + 0.15 * Math.sin(TAU * (p * (1 + r0) + hash(r0, 2)))) * span;
    for (let i = 0; i < n; i++) {
      const v = u[i] * span;
      const wave = 0.5 + 0.5 * Math.sin(TAU * (v / 23 - p * 4)) * Math.sin(TAU * (v / 9 + p * 3));
      const lv = 0.45 + 0.25 * wave;
      let r = sima[0] * lv, g = sima[1] * lv, b = sima[2] * lv;
      const hl = wave * wave * 0.35;
      r += (light[0] - r) * hl;
      g += (light[1] - g) * hl;
      b += (light[2] - b) * hl;
      // Fizz: each LED pops now and then.
      const q = p * 60 + s.off[i] * 60;
      const sl = Math.floor(q);
      if (hash(i * 29 + (sl % 60), 3) < fz * 0.2) {
        const f = q - sl;
        const k = f < 0.2 ? f / 0.2 : Math.exp(-(f - 0.2) * 6);
        r += (foam[0] - r) * k * 0.8;
        g += (foam[1] - g) * k * 0.8;
        b += (foam[2] - b) * k * 0.8;
      }
      for (let r0 = 0; r0 < nr; r0++) {
        let d = Math.abs(v - s.rx[r0]);
        if (d > span / 2) d = span - d;
        if (d < 3) {
          const k = smoothstep(2.2, 0.8, d) * 0.85;
          r += (raisin[0] - r) * k;
          g += (raisin[1] - g) * k;
          b += (raisin[2] - b) * k;
        }
      }
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  for (let k = 0; k < STREAMS; k++) s.sx[k] = (k + 0.5) / STREAMS + 0.04 * Math.sin(TAU * (p * (2 + k) + hash(k, 3)));
  // Raisins rise to the top, float a while and sink back down.
  for (let k = 0; k < nr; k++) {
    const ph = fract(p * (1 + (k % 2)) + hash(k, 5));
    const lift = smoothstep(0, 0.35, ph) * (1 - smoothstep(0.65, 1, ph));
    s.ry[k] = 0.08 + lift * 0.72 + 0.015 * Math.sin(TAU * p * (9 + k));
    s.rx[k] = 0.15 + 0.7 * hash(k, 6) + 0.05 * Math.sin(TAU * (p * (3 + k)));
  }
  const top = 0.86;
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    // Deeper gold at the bottom of the glass, lighter towards the top.
    const depth = 0.45 + 0.4 * yi;
    let r = sima[0] * depth, g = sima[1] * depth, b = sima[2] * depth;
    // Bubble streams: dots rising up each stream.
    for (let k = 0; k < STREAMS; k++) {
      const ex = (xi - s.sx[k]) * aspect;
      if (ex > 0.07 || ex < -0.07) continue;
      const rise = fract(yi * 3.2 - p * (40 + 7 * k) + hash(k, 8));
      const bub = Math.exp(-ex * ex * 350) * Math.pow(Math.max(0, 1 - Math.abs(rise - 0.5) * 3.5), 2) * fz * 1.3;
      r += (foam[0] - r) * bub;
      g += (foam[1] - g) * bub;
      b += (foam[2] - b) * bub;
    }
    // Froth on top, sparkling.
    const fk = smoothstep(top - 0.04, top + 0.04, yi);
    if (fk > 0) {
      const sp = 0.75 + 0.25 * Math.sin(TAU * (p * (20 + s.off[i] * 20) + s.off[i]));
      r += (foam[0] * sp - r) * fk;
      g += (foam[1] * sp - g) * fk;
      b += (foam[2] * sp - b) * fk;
    }
    for (let k = 0; k < nr; k++) {
      const ex = (xi - s.rx[k]) * aspect, ey = (yi - s.ry[k]) * 0.8;
      const d = ex * ex + ey * ey;
      if (d > 0.01) continue;
      const rk = Math.min(1, Math.exp(-d / 0.004) * 1.2);
      r += (raisin[0] - r) * rk;
      g += (raisin[1] - g) * rk;
      b += (raisin[2] - b) * rk;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
