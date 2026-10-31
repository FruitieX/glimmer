export const meta = {
  name: "Christmas tinsel shimmer",
  description: "Strands of gold, silver and red tinsel swaying and flashing as light runs over them. Lively.",
  category: "Seasonal",
  colors: [
    { id: "gold", label: "Gold", default: "#ffb830" },
    { id: "silver", label: "Silver", default: "#c8d8ff" },
    { id: "red", label: "Red", default: "#ff1838" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    sparkle: { type: "number", label: "Glitter", min: 0, max: 1, step: 0.01, default: 0.6 },
    strand: { type: "number", label: "Strand length", min: 3, max: 30, step: 1, unit: "LEDs", default: 10 },
  },
};

const PERIOD = 20;
const SLOTS = 160;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { wide, along: new Float32Array(n), off: new Float32Array(n), ph: new Float32Array(n), led: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    // On a curtain each column is a strand hanging down; along a string the
    // strands lie end to end.
    s.along[i] = wide ? u[i] * (n - 1) : (1 - y[i]) * 20 + x[i] * 3;
    s.led[i] = wide ? u[i] * (n - 1) : x[i] * 9;
    s.off[i] = hash(i, 2) * SLOTS;
    s.ph[i] = hash(i, 3);
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const nc = Math.max(1, colors.length);
  const p = (t * params.speed) / PERIOD;
  const len = params.strand;
  const thr = params.sparkle * 0.18;
  const sweep = p * 6; // light runs pass per loop
  for (let i = 0; i < n; i++) {
    // Which strand: by column on a curtain, by stretch along a string.
    const sid = s.wide ? Math.floor(s.led[i] / len) : Math.round(s.led[i]);
    const c = colors[((sid % nc) + nc) % nc] || [1, 0.7, 0.2];
    const a = s.along[i];
    // The strand sways, turning its foil towards and away from the light.
    const sway = Math.sin(TAU * (p * (8 + (sid % 3)) + hash(sid, 1)) + a * 0.25);
    const base = 0.34 + 0.18 * sway;
    // Bright bands of light running along.
    const run = 0.5 + 0.5 * Math.cos(TAU * (a / 16 - sweep * 2) + sway);
    const r2 = run * run;
    let k = base + 0.5 * r2 * r2;
    // Glitter: brief, crisp flashes.
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    let gl = 0;
    if (hash(i * 59 + (slot % SLOTS), 7) < thr) {
      const f = q - slot;
      gl = f < 0.15 ? f / 0.15 : Math.exp(-(f - 0.15) * 6);
    }
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const v = c[ch] * k;
      out[o + ch] = v + (Math.min(1, c[ch] * 0.4 + 0.75) - v) * gl;
    }
  }
}
