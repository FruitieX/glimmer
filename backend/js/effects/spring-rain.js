export const meta = {
  name: "Spring rain shower",
  description: "Silvery raindrops streaking down and splashing into rings over fresh green.",
  category: "Seasonal",
  colors: [
    { id: "rain", label: "Rain", default: "#9fd2ff" },
    { id: "splash", label: "Splashes", default: "#d6f6ff" },
    { id: "ground", label: "Ground", default: "#2f9a4a" },
    { id: "sky", label: "Sky", default: "#13254a" },
  ],
  params: {
    drops: { type: "number", label: "Drops", min: 2, max: 40, step: 1, default: 14 },
    speed: { type: "number", label: "Speed", min: 0.3, max: 2, step: 0.01, default: 1 },
    wind: { type: "number", label: "Slant", min: -1, max: 1, step: 0.01, default: 0.2 },
    background: { type: "number", label: "Background", min: 0, max: 1, step: 0.01, default: 0.45 },
  },
  looks: [
    { name: "Drizzle", params: { drops: 6, speed: 0.6, wind: 0 }, colors: ["#b0dcff", "#e8fbff", "#3aa850", "#2a4a7a"] },
    { name: "Downpour", params: { drops: 34, speed: 1.6, wind: 0.5, background: 0.3 }, colors: ["#c8e6ff", "#ffffff", "#227a3a", "#0a1630"] },
    { name: "Sunshower", params: { background: 0.55 }, colors: ["#ffe8a0", "#ffffff", "#5ac850", "#4a9ae8"] },
    { name: "Dusk", params: {}, colors: ["#a0a8ff", "#e0d8ff", "#1e6a40", "#2a1a5a"] },
  ],
};

const PERIOD = 24;
const HIT = 0.82; // part of each drop's cycle spent falling; the rest splashes

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const rain = colors[0] || [0.62, 0.82, 1];
  const splash = colors[1] || [0.84, 0.96, 1];
  const ground = colors[2] || [0.18, 0.6, 0.29];
  const sky = colors[3] || [0.07, 0.15, 0.29];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const bg = params.background;
  for (let i = 0; i < n; i++) {
    const g = wide ? 0.6 + 0.25 * Math.sin(TAU * (x[i] * 3 + p * 2)) : smoothstep(0.3, 0.0, y[i]);
    const k = bg * (wide ? 0.5 : 0.35 + 0.35 * g);
    const o = i * 3;
    out[o] = (sky[0] + (ground[0] - sky[0]) * g) * k;
    out[o + 1] = (sky[1] + (ground[1] - sky[1]) * g) * k;
    out[o + 2] = (sky[2] + (ground[2] - sky[2]) * g) * k;
  }
  const slant = params.wind * 0.25;
  const len = 0.07;
  const soft = Math.max(spacing, 0.02);
  const lw = wide ? 0 : 0.055;
  for (let d = 0; d < params.drops; d++) {
    const laps = 14 + Math.floor(hash(d, 1) * 8);
    const ph = p * laps + hash(d, 2);
    const lap = Math.floor(ph) % laps;
    const f = ph - Math.floor(ph);
    const dx0 = hash(d * 977 + lap, 3);
    if (f < HIT) {
      if (wide) continue;
      // A falling streak with a bright head and a fading tail.
      const yh = 1.15 - (f / HIT) * 1.15;
      for (let i = 0; i < n; i++) {
        const along = y[i] - yh;
        if (along < -3 * soft || along > len * 4) continue;
        const xd = dx0 + slant * along;
        const ex = (x[i] - xd) / lw;
        if (ex > 3 || ex < -3) continue;
        const v = along < 0 ? Math.exp(-(along * along) / (soft * soft)) : Math.exp(-along / len);
        const a = v * Math.exp(-ex * ex) * 0.85;
        const o = i * 3;
        out[o] += (rain[0] - out[o]) * a;
        out[o + 1] += (rain[1] - out[o + 1]) * a;
        out[o + 2] += (rain[2] - out[o + 2]) * a;
      }
    } else {
      // Splash: a flash where it lands and a ring spreading outwards.
      const s = (f - HIT) / (1 - HIT);
      const radius = 0.02 + s * (wide ? 0.07 : 0.22);
      const fade = (1 - s) * (1 - s);
      const xs = dx0;
      for (let i = 0; i < n; i++) {
        let ddx = x[i] - xs;
        const dist = Math.abs(ddx) * (wide ? 1 : 1);
        const hy = wide ? 0 : y[i] / 0.1;
        if (hy > 2.5) continue;
        const ring = dist - radius;
        const rw = wide ? Math.max(spacing * 1.5, 0.006) : 0.07;
        const flash = Math.exp(-(dist * dist) / (rw * rw * 1.5)) * Math.max(0, 1 - s * 3);
        const v = (Math.exp(-(ring * ring) / (rw * rw)) * 0.7 + flash) * fade * Math.exp(-hy * hy);
        if (v < 0.004) continue;
        const a = clamp(v);
        const o = i * 3;
        out[o] += (splash[0] - out[o]) * a;
        out[o + 1] += (splash[1] - out[o + 1]) * a;
        out[o + 2] += (splash[2] - out[o + 2]) * a;
      }
    }
  }
}
