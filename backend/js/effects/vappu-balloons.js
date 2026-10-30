export const meta = {
  name: "Vappu balloons",
  description: "Bright May Day balloons bobbing as they float up into a spring sky.",
  category: "Seasonal",
  colors: [
    { id: "a", label: "Balloon 1", default: "#ff1e3c" },
    { id: "b", label: "Balloon 2", default: "#ffd21a" },
    { id: "c", label: "Balloon 3", default: "#2a6bff" },
    { id: "d", label: "Balloon 4", default: "#22d36a" },
  ],
  params: {
    count: { type: "number", label: "Balloons", min: 1, max: 12, step: 1, default: 5 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Balloon size", min: 0.06, max: 0.25, step: 0.01, default: 0.12 },
    sky: { type: "number", label: "Sky brightness", min: 0, max: 0.5, step: 0.01, default: 0.12 },
  },
};

const PERIOD = 40;
const SKY = [0.35, 0.6, 1];

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const sk = params.sky;
  for (let i = 0; i < n; i++) {
    const k = sk * (wide ? 0.7 : 0.4 + 0.6 * y[i]);
    const o = i * 3;
    out[o] = SKY[0] * k;
    out[o + 1] = SKY[1] * k;
    out[o + 2] = SKY[2] * k;
  }
  const nc = colors.length || 1;
  const r = params.size;
  const soft = Math.max(spacing * 1.2, 0.03);
  for (let b = 0; b < params.count; b++) {
    const laps = 3 + Math.floor(hash(b, 1) * 3);
    const life = fract(p * laps + hash(b, 2));
    const sway = Math.sin(TAU * (p * laps * 3 + hash(b, 3)));
    const col = colors[b % nc] || [1, 0.2, 0.2];
    let bx, by, fade, rx, ry;
    if (wide) {
      bx = fract(hash(b, 4) + life * 0.25);
      by = 0.5;
      fade = Math.sin(PI * life);
      rx = r * 0.4;
      ry = 1;
    } else {
      // Spread across the width so balloons don't pile up.
      bx = (b + 0.5) / params.count + (hash(b, 4) - 0.5) * 0.15 + sway * 0.05;
      by = -r * 2.5 + life * (1 + r * 8);
      fade = 1;
      rx = r * 1.15;
      ry = r * 1.25;
    }
    for (let i = 0; i < n; i++) {
      let dx = x[i] - bx;
      if (wide) dx -= Math.round(dx);
      const ex = dx / rx;
      if (ex > 2 || ex < -2) continue;
      const ey = wide ? 0 : (y[i] - by) / ry;
      if (ey > 2 || ey < -4) continue;
      const d = Math.sqrt(ex * ex + ey * ey);
      // Round balloon with a glossy highlight up and to the left.
      const body = smoothstep(1 + soft / rx, 1 - soft / rx, d);
      const hx = ex + 0.35, hy = ey - 0.4;
      const shine = wide ? 0 : Math.exp(-(hx * hx + hy * hy) * 6) * 0.45;
      // A thin string trailing below.
      let str = 0;
      if (!wide && ey < -1) {
        const sx = (dx + 0.08 * Math.sin(ey * 2 + sway * 2) * r) / Math.max(soft * 0.8, 0.03);
        str = Math.exp(-sx * sx) * smoothstep(-3.5, -1.5, ey) * 0.3;
      }
      const shade = 0.75 + 0.25 * clamp(-ey + 0.2 - ex * 0.3);
      const a = Math.max(body, str) * fade;
      if (a < 0.005) continue;
      const o = i * 3;
      for (let ch = 0; ch < 3; ch++) {
        const c = body > str ? col[ch] * shade + (1 - col[ch]) * shine : 0.8;
        out[o + ch] += (c - out[o + ch]) * a;
      }
    }
  }
}
