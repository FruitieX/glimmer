export const meta = {
  name: "Christmas warm white twinkle",
  description: "Classic warm-white fairy lights, each bulb softly breathing on its own with the odd gentle sparkle.",
  category: "Seasonal",
  colors: [
    { id: "warm", label: "Warm white", default: "#ffb460" },
    { id: "sparkle", label: "Sparkle", default: "#fff0d8" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 2, step: 0.01, default: 0.5 },
    twinkle: { type: "number", label: "Twinkle", min: 0, max: 1, step: 0.01, default: 0.5 },
    sparkle: { type: "number", label: "Sparkles", min: 0, max: 1, step: 0.01, default: 0.3 },
    level: { type: "number", label: "Brightness", min: 0.2, max: 1, step: 0.01, default: 0.8 },
  },
  looks: [
    { name: "Candlelight", params: { speed: 0.3, twinkle: 0.7, level: 0.6 }, colors: ["#ff8a20", "#ffd090"] },
    { name: "Cool white", params: { sparkle: 0.5 }, colors: ["#d0e4ff", "#ffffff"] },
    { name: "Golden", params: { speed: 1, sparkle: 0.8 }, colors: ["#ff9a20", "#ffffff"] },
    { name: "Steady", params: { twinkle: 0.15, sparkle: 0.1, level: 1 }, colors: ["#ffb460", "#fff0d8"] },
  ],
};

const PERIOD = 60;
const SLOTS = 30;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const s = {
    c1: new Uint8Array(n),
    c2: new Uint8Array(n),
    p1: new Float32Array(n),
    p2: new Float32Array(n),
    off: new Float32Array(n),
    base: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    // Two slow, unrelated breaths per bulb, so no two bulbs move together.
    s.c1[i] = 3 + Math.floor(hash(i, 1) * 6);
    s.c2[i] = 7 + Math.floor(hash(i, 2) * 9);
    s.p1[i] = hash(i, 3);
    s.p2[i] = hash(i, 4);
    s.off[i] = hash(i, 5) * SLOTS;
    // Real bulbs differ a little in brightness.
    s.base[i] = 0.85 + 0.15 * hash(i, 6);
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const warm = colors[0] || [1, 0.7, 0.38];
  const sp = colors[1] || [1, 0.94, 0.85];
  const p = (t * params.speed) / PERIOD;
  const depth = params.twinkle;
  const level = params.level;
  const thr = params.sparkle * 0.08;
  for (let i = 0; i < n; i++) {
    const a = 0.5 + 0.5 * Math.cos(TAU * (p * s.c1[i] + s.p1[i]));
    const b = 0.5 + 0.5 * Math.cos(TAU * (p * s.c2[i] + s.p2[i]));
    // Mostly bright, dipping softly now and then.
    const dip = a * a * (0.6 + 0.4 * b);
    const k = s.base[i] * level * (1 - depth * 0.75 * dip);
    // Dimmer bulbs glow a little redder, like incandescents.
    let r = warm[0] * k;
    let g = warm[1] * Math.pow(k, 1.25);
    let bl = warm[2] * Math.pow(k, 1.5);
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    if (hash(i * 53 + (slot % SLOTS), 8) < thr) {
      // A slow glint: rises and settles over a couple of seconds.
      const f = q - slot;
      const gl = Math.sin(PI * Math.min(1, f * 1.6));
      const m = gl * gl * level;
      r += (sp[0] - r) * m;
      g += (sp[1] - g) * m;
      bl += (sp[2] - bl) * m;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = bl;
  }
}
