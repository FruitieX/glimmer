export const meta = {
  name: "Drifting Clouds",
  description: "Puffy clouds sailing across a blue daytime sky, the nearer ones faster.",
  category: "Nature",
  colors: [
    { id: "sky", label: "Sky", default: "#1f6fe0" },
    { id: "horizon", label: "Horizon", default: "#8cc8ff" },
    { id: "cloud", label: "Clouds", default: "#ffffff" },
    { id: "sun", label: "Sun", default: "#fff1b8" },
  ],
  params: {
    clouds: { type: "number", label: "Clouds", min: 1, max: 8, step: 1, default: 4 },
    speed: { type: "number", label: "Wind", min: 0.1, max: 3, step: 0.01, default: 0.6 },
    size: { type: "number", label: "Cloud size", min: 0.4, max: 2, step: 0.01, default: 1 },
    sun: { type: "boolean", label: "Sun", default: true },
  },
};

const PUFFS = 5;
const BASE = 80; // seconds for a near cloud to cross twice at wind 1

export function loop(params) {
  return BASE / params.speed;
}

export function setup(ctx) {
  const { n, y } = ctx;
  let flat = true;
  for (let i = 1; i < n; i++) if (Math.abs(y[i] - y[0]) > 1e-4) flat = false;
  // Per-LED cloud cover and shading, filled each frame.
  return { flat, cover: new Float32Array(n), shade: new Float32Array(n) };
}

export function render(ctx, s) {
  const { n, x, y, out, params, colors, t, spacing, aspect } = ctx;
  const skyC = colors[0] || [0.18, 0.5, 0.98];
  const hor = colors[1] || [0.66, 0.85, 1];
  const cloudC = colors[2] || [1, 1, 1];
  const sunC = colors[3] || [1, 0.95, 0.72];
  const L = BASE / params.speed;
  const asp = s.flat ? 1 : clamp(aspect || 1, 0.3, 3);
  const { cover, shade } = s;
  cover.fill(0);
  shade.fill(0);
  const count = Math.round(params.clouds);
  for (let c = 0; c < count; c++) {
    const near = c % 2 === 0;
    const turns = near ? 2 : 1;
    const size = params.size * (near ? 1 : 0.7) * (0.8 + 0.4 * hash(c, 1));
    const cx = -0.6 + 2.2 * fract(hash(c, 2) + (t * turns) / L);
    const cy = 0.35 + 0.5 * hash(c, 3);
    const k = near ? 1 : 0.75;
    for (let p = 0; p < PUFFS; p++) {
      const px = cx + (hash(c * 11 + p, 4) - 0.5) * 0.5 * size / asp;
      const py = cy + (hash(c * 11 + p, 5) - 0.3) * 0.12 * size;
      const r = Math.max((0.12 + 0.08 * hash(c * 11 + p, 6)) * size, spacing * 1.5);
      const rx = r / asp + spacing, ry = r;
      for (let i = 0; i < n; i++) {
        const dx = (x[i] - px) / rx;
        if (dx >= 1 || dx <= -1) continue;
        const dy = s.flat ? 0 : (y[i] - py) / ry;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const w = (1 - d) * (1 - d) * k;
        cover[i] += w;
        // Puffs are lit from above: their lower part is greyer.
        shade[i] += w * clamp(0.5 - dy * 0.5);
      }
    }
  }
  const sunX = 0.78, sunY = 0.8;
  for (let i = 0; i < n; i++) {
    const yi = s.flat ? 0.6 : y[i];
    const h = smoothstep(0, 1, yi);
    let r = hor[0] + (skyC[0] - hor[0]) * h;
    let g = hor[1] + (skyC[1] - hor[1]) * h;
    let b = hor[2] + (skyC[2] - hor[2]) * h;
    if (params.sun) {
      const dx = (x[i] - sunX) * asp, dy = s.flat ? 0 : yi - sunY;
      const d = Math.sqrt(dx * dx + dy * dy);
      const disc = smoothstep(0.1 + spacing, 0.1 - spacing * 0.5, d);
      const halo = 0.35 * Math.exp(-d * 5);
      const sk = clamp(disc + halo);
      r += (sunC[0] - r) * sk;
      g += (sunC[1] - g) * sk;
      b += (sunC[2] - b) * sk;
    }
    const cv = smoothstep(0.1, 0.6, cover[i]);
    if (cv > 0) {
      const lit = cover[i] > 0 ? shade[i] / cover[i] : 0.5;
      const ck = 0.72 + 0.28 * lit;
      r += (cloudC[0] * ck - r) * cv;
      g += (cloudC[1] * ck - g) * cv;
      b += (cloudC[2] * ck - b) * cv;
    }
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}
