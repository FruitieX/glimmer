export const meta = {
  name: "Spring cherry blossoms",
  description: "Pink cherry-blossom petals drifting on a spring breeze over a soft sky.",
  category: "Seasonal",
  colors: [
    { id: "petal", label: "Petals", default: "#ff8fc0" },
    { id: "light", label: "Pale petals", default: "#fff0f6" },
    { id: "sky", label: "Sky", default: "#3c78c8" },
    { id: "grass", label: "Grass", default: "#3cb43c" },
  ],
  params: {
    count: { type: "number", label: "Petals", min: 2, max: 40, step: 1, default: 16 },
    breeze: { type: "number", label: "Breeze", min: 0.2, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Petal size", min: 0.02, max: 0.15, step: 0.01, default: 0.05 },
    background: { type: "number", label: "Background", min: 0, max: 1, step: 0.01, default: 0.3 },
  },
};

const PERIOD = 40;

export function loop(params) {
  return PERIOD / params.breeze;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const petal = colors[0] || [1, 0.56, 0.75];
  const light = colors[1] || [1, 0.94, 0.96];
  const sky = colors[2] || [0.24, 0.47, 0.78];
  const grass = colors[3] || [0.24, 0.7, 0.24];
  const wide = aspect > 2.5;
  const p = (t * params.breeze) / PERIOD;
  const bg = params.background;
  // Pale sky above fresh green, both dim so the petals stand out.
  for (let i = 0; i < n; i++) {
    const h = wide ? 0.65 + 0.35 * Math.sin(TAU * (x[i] * 2 - p * 3)) : smoothstep(0.1, 0.45, y[i]);
    const k = bg * (0.5 + 0.2 * Math.sin(TAU * (x[i] + p * 2)));
    const o = i * 3;
    out[o] = (grass[0] + (sky[0] - grass[0]) * h) * k;
    out[o + 1] = (grass[1] + (sky[1] - grass[1]) * h) * k;
    out[o + 2] = (grass[2] + (sky[2] - grass[2]) * h) * k;
  }
  const r = params.size;
  // Gusts: the whole breeze speeds up and slows down together.
  for (let j = 0; j < params.count; j++) {
    const lapsX = 3 + Math.floor(hash(j, 1) * 3);
    const lapsY = 2 + Math.floor(hash(j, 2) * 3);
    const gust = 0.04 * Math.sin(TAU * (p * 5 + hash(j, 9) * 0.2));
    const flutterPh = TAU * (p * (lapsX * 6) + hash(j, 3));
    const px = fract(hash(j, 4) + p * lapsX + gust);
    const py = 1.1 - fract(hash(j, 5) + p * lapsY) * 1.2 + 0.04 * Math.sin(flutterPh);
    // Petals glint as they turn in the light.
    const glint = Math.pow(0.5 + 0.5 * Math.sin(flutterPh * 0.5), 6);
    const w = hash(j, 6);
    const cr = petal[0] + (light[0] - petal[0]) * w * 0.7;
    const cg = petal[1] + (light[1] - petal[1]) * w * 0.7;
    const cb = petal[2] + (light[2] - petal[2]) * w * 0.7;
    const bright = 0.75 + 0.25 * glint;
    const fade = wide ? Math.sin(PI * fract(hash(j, 5) + p * lapsY)) : 1;
    const rx = wide ? r * 0.35 : r * 1.6;
    for (let i = 0; i < n; i++) {
      let dx = x[i] - px;
      dx -= Math.round(dx);
      const ex = dx / rx;
      if (ex > 3 || ex < -3) continue;
      const ey = wide ? 0 : (y[i] - py) / r;
      const d2 = ex * ex + ey * ey;
      if (d2 > 9) continue;
      const a = Math.exp(-d2 * 1.6) * fade;
      const o = i * 3;
      out[o] += (cr * bright - out[o]) * a;
      out[o + 1] += (cg * bright - out[o + 1]) * a;
      out[o + 2] += (cb * bright - out[o + 2]) * a;
    }
  }
}
