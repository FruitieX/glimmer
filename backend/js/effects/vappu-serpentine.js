export const meta = {
  name: "Vappu serpentine",
  description: "Curly paper streamers twirling down through a shower of May Day confetti.",
  category: "Seasonal",
  colors: [
    { id: "a", label: "Colour 1", default: "#ff2a6a" },
    { id: "b", label: "Colour 2", default: "#ffd400" },
    { id: "c", label: "Colour 3", default: "#00b4ff" },
    { id: "d", label: "Colour 4", default: "#7dff3a" },
  ],
  params: {
    streamers: { type: "number", label: "Streamers", min: 1, max: 10, step: 1, default: 4 },
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    curl: { type: "number", label: "Curliness", min: 0.5, max: 3, step: 0.01, default: 1.5 },
    confetti: { type: "number", label: "Confetti", min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  looks: [
    { name: "Confetti storm", params: { streamers: 7, confetti: 0.9, speed: 1.5 }, colors: ["#ff1e8c", "#ffe600", "#00d8ff", "#a040ff"] },
    { name: "Lazy curls", params: { streamers: 3, speed: 0.6, curl: 2.5, confetti: 0.2 }, colors: ["#ff6ab0", "#ffb000", "#40e0ff", "#a0ff60"] },
    { name: "Pastel", params: { curl: 1 }, colors: ["#ff70c0", "#ffe040", "#60c8ff", "#90ff70"] },
    { name: "Tropical", params: { streamers: 5, confetti: 0.6 }, colors: ["#ff4000", "#ff00a0", "#00ffb0", "#ffe000"] },
  ],
};

const PERIOD = 30;
const SLOTS = 60;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const nc = colors.length || 1;
  // Confetti: short colourful flashes scattered everywhere.
  for (let i = 0; i < n; i++) {
    const ph = p * SLOTS + hash(i, 1);
    const sl = Math.floor(ph) % SLOTS;
    const f = ph - Math.floor(ph);
    const o = i * 3;
    out[o] = out[o + 1] = out[o + 2] = 0;
    if (hash(i * 71 + sl, 2) < params.confetti * 0.12) {
      const c = colors[Math.floor(hash(i * 13 + sl, 3) * nc)] || [1, 1, 1];
      const k = Math.pow(Math.sin(f * PI), 2) * 0.8;
      out[o] = c[0] * k;
      out[o + 1] = c[1] * k;
      out[o + 2] = c[2] * k;
    }
  }
  const curl = params.curl;
  const w = wide ? Math.max(spacing * 2, 0.01) : Math.max(spacing * 1.1, 0.05);
  const S = params.streamers;
  for (let s = 0; s < S; s++) {
    const c = colors[s % nc] || [1, 1, 1];
    const laps = 2 + (s % 3);
    const head = fract(p * laps + hash(s, 4)); // how far the streamer has fallen
    const spin = TAU * (p * laps * 8 + hash(s, 5));
    const len = 0.55 + 0.25 * hash(s, 6);
    const x0 = (s + 0.5) / S + (hash(s, 7) - 0.5) * 0.3 / S;
    const amp = 0.06 + 0.04 * hash(s, 8);
    for (let i = 0; i < n; i++) {
      let along, lat;
      if (wide) {
        // Along a line: a ribbon sliding by, its twists flashing as they turn.
        let d = x[i] - fract(hash(s, 9) + head * 0.6);
        d -= Math.round(d);
        along = (d + len * 0.25) / (len * 0.25);
        lat = 0;
      } else {
        // Falling from the top: the ribbon's lower end leads.
        const bottom = 1.05 - head * (1.1 + len);
        along = (y[i] - bottom) / len;
        lat = 1;
      }
      if (along < 0 || along > 1) continue;
      const phase = along * TAU * curl * (wide ? 1.5 : 2) + spin;
      // A helix seen from the side: it swings left and right, bright when facing us.
      const face = 0.35 + 0.65 * Math.abs(Math.cos(phase));
      const ends = smoothstep(0, 0.12, along) * smoothstep(1, 0.85, along);
      let k = face * ends * (wide ? Math.sin(PI * head) : 1);
      if (lat) {
        const cx = x0 + amp * Math.sin(phase);
        const e = (x[i] - cx) / (w * 1.4);
        k *= Math.exp(-e * e);
      }
      if (k < 0.005) continue;
      const o = i * 3;
      out[o] += (c[0] - out[o]) * k;
      out[o + 1] += (c[1] - out[o + 1]) * k;
      out[o + 2] += (c[2] - out[o + 2]) * k;
    }
  }
}
