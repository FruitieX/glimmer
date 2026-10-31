export const meta = {
  name: "Spring meadow bloom",
  description: "Flowers opening and closing in turn over swaying spring grass, under a soft morning sky.",
  category: "Seasonal",
  colors: [
    { id: "flower1", label: "Flowers", default: "#ff6ec0" },
    { id: "flower2", label: "Flowers 2", default: "#b07aff" },
    { id: "flower3", label: "Flowers 3", default: "#ffffff" },
    { id: "centre", label: "Centres", default: "#ffd02a" },
    { id: "grass", label: "Grass", default: "#2ea83a" },
    { id: "sky", label: "Sky", default: "#5aa8e8" },
  ],
  params: {
    flowers: { type: "number", label: "Flowers", min: 1, max: 12, step: 1, default: 7 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    sky: { type: "number", label: "Sky brightness", min: 0, max: 1, step: 0.01, default: 0.35 },
  },
  looks: [
    { name: "Tulips", params: {}, colors: ["#ff2a2a", "#ffd000", "#ff7a00", "#ffffff", "#2ea83a", "#5aa8e8"] },
    { name: "Bluebells", params: { flowers: 10 }, colors: ["#4a6aff", "#a07aff", "#ffffff", "#ffe060", "#1e9a40", "#4a90d8"] },
    { name: "Twilight", params: { sky: 0.3 }, colors: ["#ff4fa0", "#ffb000", "#ffffff", "#ffd02a", "#2a8a30", "#7a3aff"] },
    { name: "Moonlit", params: { speed: 0.5, sky: 0.5 }, colors: ["#ff6ec0", "#7af0ff", "#ffffff", "#ffe060", "#0e5a20", "#0a1a50"] },
  ],
};

const PERIOD = 30;
const MAXF = 12;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  return { fx: new Float32Array(MAXF), fy: new Float32Array(MAXF), fr: new Float32Array(MAXF) };
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect, spacing } = ctx;
  const nf = Math.max(1, Math.min(3, colors.length - 3));
  const centre = colors[3] || [1, 0.82, 0.16];
  const grass = colors[4] || [0.18, 0.66, 0.23];
  const sky = colors[5] || [0.35, 0.66, 0.91];
  const p = (t * params.speed) / PERIOD;
  const count = params.flowers;
  const wide = aspect > 2.5;
  // Each flower opens and closes once or twice per loop, at its own time.
  for (let f = 0; f < count; f++) {
    const cyc = 1 + (f % 2);
    const ph = fract(p * cyc + hash(f, 1));
    const open = smoothstep(0, 0.3, ph) * (1 - smoothstep(0.7, 1, ph));
    s.fr[f] = open;
    s.fx[f] = (f + 0.2 + 0.6 * hash(f, 2)) / count;
    s.fy[f] = 0.22 + 0.35 * hash(f, 3);
  }
  const span = Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const xi = wide ? u[i] : x[i];
    const sway = Math.sin(TAU * (p * 5 + xi * 3)) * 0.5 + 0.5;
    let r, g, b;
    if (wide) {
      const blade = 0.3 + 0.15 * Math.sin(i * 1.7 + TAU * p * 6) + 0.1 * sway;
      r = grass[0] * blade;
      g = grass[1] * blade;
      b = grass[2] * blade;
    } else {
      // Grass up to a wavy edge, the sky above it fading to light near the ground.
      const edge = 0.45 + 0.05 * Math.sin(xi * 17 + TAU * p * 3) + 0.04 * Math.sin(xi * 41);
      const gk = smoothstep(edge + 0.04, edge - 0.04, y[i]);
      const sb = params.sky * (0.6 + 0.4 * (1 - y[i]));
      const blade = 0.35 + 0.15 * Math.sin(xi * 53 + y[i] * 9 + TAU * p * 4) * sway;
      r = sky[0] * sb + (grass[0] * blade - sky[0] * sb) * gk;
      g = sky[1] * sb + (grass[1] * blade - sky[1] * sb) * gk;
      b = sky[2] * sb + (grass[2] * blade - sky[2] * sb) * gk;
    }
    for (let f = 0; f < count; f++) {
      const open = s.fr[f];
      if (open <= 0.01) continue;
      let d, ang = 0;
      if (wide) {
        d = (Math.abs(xi - s.fx[f]) * span) / 4.5; // a flower spans about 9 LEDs
      } else {
        const dx = (xi - s.fx[f]) * aspect, dy = y[i] - s.fy[f];
        d = Math.sqrt(dx * dx + dy * dy) / 0.16;
        ang = Math.atan2(dy, dx);
      }
      if (d > 1.3) continue;
      // Five rounded petals that grow as the flower opens; a yellow centre.
      const petal = wide ? 1 : 0.78 + 0.22 * Math.cos(5 * ang + f);
      const rad = open * petal;
      const soft = wide ? 0.25 : Math.max(spacing / 0.16, 0.2);
      const k = smoothstep(rad + soft, rad - soft, d) * open;
      const ck = smoothstep(0.3 * open + soft * 0.5, 0.3 * open - soft * 0.5, d) * open;
      const c = colors[f % nf] || [1, 0.4, 0.75];
      r += (c[0] - r) * k;
      g += (c[1] - g) * k;
      b += (c[2] - b) * k;
      r += (centre[0] - r) * ck;
      g += (centre[1] - g) * ck;
      b += (centre[2] - b) * ck;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
