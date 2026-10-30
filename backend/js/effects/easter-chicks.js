export const meta = {
  name: "Easter chicks",
  description: "Fluffy yellow chicks hopping across the grass under soft pastel waves.",
  category: "Seasonal",
  colors: [
    { id: "chick", label: "Chicks", default: "#ffd81a" },
    { id: "beak", label: "Beaks", default: "#ff6a00" },
    { id: "pastel1", label: "Pastel", default: "#ff9ed2" },
    { id: "pastel2", label: "Pastel 2", default: "#9ad8ff" },
  ],
  params: {
    count: { type: "number", label: "Chicks", min: 1, max: 8, step: 1, default: 3 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Chick size", min: 0.06, max: 0.2, step: 0.01, default: 0.11 },
    background: { type: "number", label: "Background", min: 0, max: 1, step: 0.01, default: 0.35 },
  },
};

const PERIOD = 30;
const GRASS = [0.45, 0.85, 0.3];

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const chick = colors[0] || [1, 0.85, 0.1];
  const beak = colors[1] || [1, 0.42, 0];
  const pa = colors[2] || [1, 0.62, 0.82];
  const pb = colors[3] || [0.6, 0.85, 1];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const bg = params.background;
  const ground = 0.16;
  // Soft pastel waves washing across, fresh grass along the bottom.
  for (let i = 0; i < n; i++) {
    const w = 0.5 + 0.5 * Math.sin(TAU * (x[i] * 1.5 + y[i] * 0.8 - p * 4));
    const g = wide ? 0 : smoothstep(ground + 0.06, ground - 0.04, y[i]);
    const k = bg * (0.8 + 0.2 * Math.sin(TAU * (x[i] - p * 3) + y[i] * 3));
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const sky = (pa[ch] + (pb[ch] - pa[ch]) * w) * k;
      out[o + ch] = sky + (GRASS[ch] * bg * 0.8 - sky) * g;
    }
  }
  const r = params.size;
  const soft = Math.max(spacing * 1.2, 0.03);
  for (let c = 0; c < params.count; c++) {
    // Each chick makes whole laps of the width; it hops, pauses and hops again.
    const laps = 2 + (c % 2);
    const hops = laps * 10;
    const hp = p * hops + hash(c, 1) * hops;
    const hi = Math.floor(hp);
    const hf = hp - hi;
    const move = hf < 0.5 ? ease.inOut(hf / 0.5) : 1;
    const dir = c % 2 ? -1 : 1;
    let cx = fract(((hi + move) / hops) * laps * dir + hash(c, 2));
    const lift = hf < 0.5 ? Math.sin((hf / 0.5) * PI) : 0;
    const peck = hf >= 0.5 ? Math.sin(((hf - 0.5) / 0.5) * PI) : 0;
    const cy = ground + r * 0.95 + lift * r * 1.3;
    const rx = wide ? r * 0.35 : r * 1.25;
    const ry = r;
    const bdx = dir * rx * 0.95;
    const bdy = r * (0.25 - 0.5 * peck);
    for (let i = 0; i < n; i++) {
      let dx = x[i] - cx;
      dx -= Math.round(dx);
      const ex = dx / rx;
      if (ex > 2 || ex < -2) continue;
      const ey = wide ? 0 : (y[i] - cy) / ry;
      const d = Math.sqrt(ex * ex + ey * ey);
      const body = smoothstep(1 + soft / ry, 1 - soft / ry, d);
      // A little beak at the front of the head.
      const bx = (dx - bdx) / (wide ? rx * 0.35 : rx * 0.45);
      const by = wide ? 0 : (y[i] - cy - bdy) / (ry * 0.4);
      const bk = Math.exp(-(bx * bx + by * by) * 1.5);
      if (body < 0.01 && bk < 0.01) continue;
      // Fluffy: slightly brighter in the middle.
      const fluff = 0.8 + 0.2 * (1 - d);
      const o = i * 3;
      for (let ch = 0; ch < 3; ch++) {
        let v = out[o + ch] + (chick[ch] * fluff - out[o + ch]) * body;
        v += (beak[ch] - v) * bk * 0.9;
        out[o + ch] = v;
      }
    }
  }
}
