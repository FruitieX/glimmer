export const meta = {
  name: "Halloween ghosts",
  description: "Pale ghosts with wavy hems drifting through a dark purple night.",
  category: "Seasonal",
  colors: [
    { id: "ghost", label: "Ghosts", default: "#d8f0ff" },
    { id: "glow", label: "Ghostly glow", default: "#5cffc8" },
    { id: "night", label: "Night", default: "#1a0630" },
  ],
  params: {
    count: { type: "number", label: "Ghosts", min: 1, max: 8, step: 1, default: 4 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Size", min: 0.1, max: 0.4, step: 0.01, default: 0.2 },
    night: { type: "number", label: "Night brightness", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
  looks: [
    { name: "Phantoms", params: { count: 6, speed: 1.4, size: 0.15 }, colors: ["#e8f8ff", "#a060ff", "#120424"] },
    { name: "Will-o'-wisp", params: { count: 3, speed: 0.6, size: 0.25 }, colors: ["#c8ffd8", "#40ff60", "#04140a"] },
    { name: "Pumpkin night", params: { night: 0.8 }, colors: ["#fff0d8", "#ff8a10", "#200818"] },
    { name: "Spectral", params: { count: 2, speed: 0.4, size: 0.35, night: 0.4 }, colors: ["#d0e0ff", "#40b0ff", "#020820"] },
  ],
};

const PERIOD = 30;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const ghost = colors[0] || [0.85, 0.94, 1];
  const glow = colors[1] || [0.36, 1, 0.78];
  const night = colors[2] || [0.1, 0.02, 0.19];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD; // 0..1 over one loop
  const nb = params.night;
  // Background: a slowly breathing purple haze.
  for (let i = 0; i < n; i++) {
    const h = 0.6 + 0.4 * Math.sin(TAU * (p * 2 + x[i] * 0.7 + y[i] * 0.4));
    const o = i * 3;
    out[o] = night[0] * nb * h;
    out[o + 1] = night[1] * nb * h;
    out[o + 2] = night[2] * nb * h;
  }
  const count = params.count;
  for (let g = 0; g < count; g++) {
    // Whole numbers of crossings, bobs and fades per loop keep it seamless.
    const laps = 2 + (g % 3);
    const ph = fract(p * laps + hash(g, 1));
    const dir = g % 2 ? -1 : 1;
    const span = 1 + 4 * params.size;
    let gx = -2 * params.size + span * ph;
    if (dir < 0) gx = 1 - gx;
    const bob = Math.sin(TAU * (p * (9 + g) + hash(g, 2)));
    const gy = 0.3 + 0.45 * hash(g, 3) + 0.05 * bob;
    const fade = 0.55 + 0.45 * Math.sin(TAU * (p * (3 + (g % 2)) + hash(g, 4)));
    const ry = params.size;
    const rx = wide ? ry * 0.6 : ry * 0.95;
    const soft = Math.max((spacing * 1.5) / ry, 0.25);
    const wave = TAU * p * (14 + g);
    for (let i = 0; i < n; i++) {
      const ex = (x[i] - gx) / rx;
      if (ex < -3.5 || ex > 3.5) continue;
      let body, trail;
      if (wide) {
        // Along a line: a soft head with a wispy trail behind it.
        const behind = -ex * dir;
        body = smoothstep(-soft, soft, 1 - Math.abs(ex));
        trail = behind > 0 ? Math.exp(-behind * 0.9) * 0.5 * (0.7 + 0.3 * Math.sin(behind * 4 - wave)) : 0;
      } else {
        const ey = (y[i] - gy) / ry;
        if (ey < -2 || ey > 1.5) continue;
        if (ey > 0) {
          body = smoothstep(-soft, soft, 1 - Math.sqrt(ex * ex + ey * ey));
        } else {
          // Straight sides down to a wavy hem.
          const hem = -1.1 + 0.22 * Math.sin(ex * 4.5 + wave);
          body = smoothstep(-soft, soft, 1 - Math.abs(ex)) * smoothstep(hem - soft, hem + soft, ey);
        }
        // Faint wisps trail behind.
        const behind = -ex * dir - 0.6;
        trail = behind > 0 ? Math.exp(-behind * 1.4 - ey * ey * 3) * 0.35 : 0;
      }
      const k = Math.max(body, trail) * fade;
      if (k <= 0.003) continue;
      // The body is pale; the edges and wisps glow green.
      const w = body * body;
      const o = i * 3;
      for (let ch = 0; ch < 3; ch++) {
        const c = glow[ch] + (ghost[ch] - glow[ch]) * w;
        out[o + ch] = out[o + ch] * (1 - k) + c * k * (0.55 + 0.35 * w);
      }
    }
  }
}
