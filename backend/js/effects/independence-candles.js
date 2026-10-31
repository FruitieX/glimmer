export const meta = {
  name: "Independence Day candles",
  description: "Two calm candles glowing in every window on a still blue winter night.",
  category: "Seasonal",
  colors: [
    { id: "flame", label: "Flame", default: "#ffb648" },
    { id: "candle", label: "Candles", default: "#f4f0ff" },
    { id: "night", label: "Night", default: "#0b2a6e" },
  ],
  params: {
    windows: { type: "number", label: "Windows", min: 1, max: 12, step: 1, default: 1 },
    flicker: { type: "number", label: "Flicker", min: 0, max: 1, step: 0.01, default: 0.3 },
    night: { type: "number", label: "Night brightness", min: 0, max: 1, step: 0.01, default: 0.35 },
    snow: { type: "number", label: "Snowfall", min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  looks: [
    { name: "Many windows", params: { windows: 6 }, colors: ["#ffb040", "#fff4e8", "#08205a"] },
    { name: "Snowy night", params: { snow: 0.8, night: 0.45 }, colors: ["#ffc060", "#f0f4ff", "#0e3080"] },
    { name: "Still midnight", params: { flicker: 0.1, night: 0.2, snow: 0 }, colors: ["#ff9a30", "#fff0e0", "#040e30"] },
    { name: "Neighbourhood", params: { windows: 12, flicker: 0.5 }, colors: ["#ffd070", "#ffffff", "#0a2468"] },
  ],
};

const PERIOD = 40;
const SNOW = 10;
const MAXW = 256;
const LVL = new Float32Array(MAXW * 2);
const SWAY = new Float32Array(MAXW * 2);

export function loop() {
  return PERIOD;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const flame = colors[0] || [1, 0.71, 0.28];
  const candle = colors[1] || [0.96, 0.94, 1];
  const night = colors[2] || [0.04, 0.16, 0.43];
  const wide = aspect > 2.5;
  const p = t / PERIOD;
  const th = TAU * p;
  const ct = Math.cos(th), st = Math.sin(th);
  const W = Math.min(MAXW, wide ? params.windows * Math.max(1, Math.round(aspect / 6)) : params.windows);
  const fl = params.flicker;
  // Calm flicker for each candle, looping round a circle in noise space.
  for (let id = 0; id < W * 2; id++) {
    const f = noise(ct * 9 + id * 3.7, st * 9 + 1.3, 0.5) * 0.6 + noise(ct * 23 + id, st * 23, 2.5) * 0.4;
    LVL[id] = 1 - fl * 0.5 * (0.5 - f);
    SWAY[id] = fl * 0.03 * noise(ct * 6 + id, st * 6, 4.2);
  }
  const nb = params.night;
  const soft = Math.max(spacing * 1.2, 0.025);
  for (let i = 0; i < n; i++) {
    const cell = x[i] * W;
    const ci = clamp(Math.floor(cell), 0, W - 1);
    const cx = cell - ci; // 0..1 inside this window
    let r = 0, g = 0, b = 0;
    // Two candles per window.
    for (let k = 0; k < 2; k++) {
      const id = ci * 2 + k;
      const lvl = LVL[id];
      const sway = SWAY[id];
      const px = (k === 0 ? 0.32 : 0.68) + sway;
      const dx = (cx - px) / W;
      if (wide) {
        const e = dx / Math.max(0.06 / W, spacing * 1.5);
        const v = Math.exp(-e * e) * lvl;
        const halo = Math.exp(-Math.abs(dx) * W * 12) * 0.2 * lvl;
        r += flame[0] * (v + halo);
        g += flame[1] * (v + halo) * (0.85 + 0.15 * v);
        b += flame[2] * (v + halo);
      } else {
        const yi = y[i];
        // Teardrop flame above a pale candle.
        const fyc = 0.5;
        const ex = (dx * W) / 0.07;
        const ey = (yi - fyc) / (yi > fyc ? 0.1 : 0.05);
        const v = Math.exp(-(ex * ex + ey * ey)) * lvl;
        const halo = Math.exp(-Math.sqrt(dx * dx * W * W * 1.2 + (yi - fyc) * (yi - fyc)) * 7) * 0.25 * lvl;
        const body = smoothstep(0.08 + soft, 0.08 - soft, Math.abs(dx * W)) * smoothstep(0.42 + soft, 0.42 - soft, yi) * smoothstep(0.08, 0.12, yi);
        // The candle is lit from above by its flame.
        const lit = body * (0.25 + 0.3 * smoothstep(0.1, 0.42, yi)) * lvl;
        r += flame[0] * (v + halo) + candle[0] * lit;
        g += flame[1] * (v + halo) * (0.8 + 0.2 * v) + candle[1] * lit;
        b += flame[2] * (v + halo) + candle[2] * lit;
      }
    }
    // The window glows faintly warm; outside, the blue night.
    const inside = wide ? 0 : smoothstep(0.03, 0.1, cx) * smoothstep(0.97, 0.9, cx) * smoothstep(0.02, 0.08, y[i]) * smoothstep(0.92, 0.85, y[i]);
    const o = i * 3;
    out[o] = r + night[0] * nb * (1 - inside * 0.6) + flame[0] * inside * 0.04;
    out[o + 1] = g + night[1] * nb * (1 - inside * 0.6) + flame[1] * inside * 0.04;
    out[o + 2] = b + night[2] * nb * (1 - inside * 0.6) + flame[2] * inside * 0.04;
  }
  // A few slow snowflakes drifting past.
  const sn = Math.round(params.snow * SNOW);
  const rs = wide ? Math.max(spacing * 1.5, 0.006) : Math.max(spacing * 0.8, 0.03);
  for (let s = 0; s < sn; s++) {
    const laps = 2 + Math.floor(hash(s, 1) * 3);
    const life = fract(p * laps + hash(s, 2));
    const sx = fract(hash(s, 3) + 0.03 * Math.sin(TAU * (p * laps * 3 + hash(s, 4))));
    const sy = 1.05 - life * 1.1;
    const fade = wide ? Math.sin(PI * life) : 1;
    for (let i = 0; i < n; i++) {
      const ex = (x[i] - sx) / (wide ? rs : rs * 1.8);
      if (ex > 3 || ex < -3) continue;
      const ey = wide ? 0 : (y[i] - sy) / rs;
      const d2 = ex * ex + ey * ey;
      if (d2 > 9) continue;
      const v = Math.exp(-d2 * 1.5) * 0.45 * fade;
      const o = i * 3;
      out[o] += (0.8 - out[o]) * v;
      out[o + 1] += (0.85 - out[o + 1]) * v;
      out[o + 2] += (0.95 - out[o + 2]) * v;
    }
  }
}
