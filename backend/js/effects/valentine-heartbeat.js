export const meta = {
  name: "Valentine heartbeat",
  description: "A glowing heart beating lub-dub, sending soft pink ripples outwards.",
  category: "Seasonal",
  colors: [
    { id: "heart", label: "Heart", default: "#ff1240" },
    { id: "ripple", label: "Ripples", default: "#ff5c9e" },
    { id: "background", label: "Background", default: "#2a0010" },
  ],
  params: {
    bpm: { type: "number", label: "Beats per minute", min: 30, max: 140, step: 1, default: 64 },
    size: { type: "number", label: "Heart size", min: 0.15, max: 0.5, step: 0.01, default: 0.36 },
    ripples: { type: "number", label: "Ripples", min: 0, max: 1, step: 0.01, default: 0.6 },
    background: { type: "number", label: "Background", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Racing heart", params: { bpm: 120, ripples: 0.8 }, colors: ["#ff2a2a", "#ff6a50", "#200008"] },
    { name: "Sleepy", params: { bpm: 44, ripples: 0.4 }, colors: ["#ff2a8a", "#ff90e0", "#1e0418"] },
    { name: "Big heart", params: { size: 0.48, ripples: 0.3 }, colors: ["#ff1e5a", "#ff7ab0", "#26000e"] },
    { name: "Violet", params: { bpm: 80 }, colors: ["#e020ff", "#ff60c8", "#16021e"] },
  ],
};

const BEATS = 8;

export function loop(params) {
  return (BEATS * 60) / params.bpm;
}

function pulse(v, c, w) {
  const d = (v - c) / w;
  return Math.exp(-d * d);
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const heart = colors[0] || [1, 0.07, 0.25];
  const ripple = colors[1] || [1, 0.36, 0.62];
  const back = colors[2] || [0.16, 0, 0.06];
  const wide = aspect > 2.5;
  const beat = fract((t * params.bpm) / 60);
  // Lub-dub: a strong beat and a softer one just after.
  const env = Math.min(1, pulse(beat, 0.08, 0.06) + 0.75 * pulse(beat, 0.32, 0.07));
  const s = params.size * (1 + 0.08 * env);
  const bright = 0.5 + 0.5 * env;
  const ringR = beat * (wide ? 0.5 : 0.9);
  const ringFade = Math.pow(1 - beat, 2) * params.ripples;
  const ringW = wide ? 0.04 : 0.07;
  const reps = wide ? Math.max(1, Math.round(aspect / 10)) : 1;
  const bgk = params.background * (0.6 + 0.4 * env);
  const soft = Math.max(spacing * 1.5, 0.04) / s;
  for (let i = 0; i < n; i++) {
    let h, d;
    if (wide) {
      // Along a line: a beating glow repeated every so often.
      const lx = fract(x[i] * reps) - 0.5;
      const X = Math.abs(lx) / (s / reps / 1.5);
      h = smoothstep(1 + soft, 1 - soft, X);
      d = Math.abs(lx) * 1;
    } else {
      // Heart curve: X² + (Y − |X|^⅔)² ≤ 1, softened at the edge.
      const X = (x[i] - 0.5) / s;
      const Y = (y[i] - 0.45) / (s * 0.8);
      const q = Y - Math.pow(Math.abs(X), 2 / 3);
      const f = X * X + q * q - 1;
      h = smoothstep(soft * 2, -soft * 2, f);
      d = Math.sqrt((x[i] - 0.5) * (x[i] - 0.5) + (y[i] - 0.5) * (y[i] - 0.5));
    }
    const rd = (d - ringR) / ringW;
    const ring = Math.exp(-rd * rd) * ringFade * (1 - h);
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const b = back[ch] * bgk + ripple[ch] * ring * 0.8;
      out[o + ch] = b + (heart[ch] * bright - b) * h;
    }
  }
}
