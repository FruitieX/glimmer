export const meta = {
  name: "Christmas red & green chase",
  description: "Lively red and green bands chasing, swapping or meeting in the middle, with white sparkles.",
  category: "Seasonal",
  colors: [
    { id: "red", label: "Red", default: "#ff1020" },
    { id: "green", label: "Green", default: "#10d040" },
    { id: "sparkle", label: "Sparkles", default: "#fff4e0" },
  ],
  params: {
    mode: {
      type: "select",
      label: "Pattern",
      options: ["chase", "swap", "meet"],
      labels: ["Chase", "Swap", "Meet in the middle"],
      default: "chase",
    },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    width: { type: "number", label: "Band width", min: 2, max: 20, step: 1, unit: "LEDs", default: 6 },
    sparkle: { type: "number", label: "Sparkles", min: 0, max: 1, step: 0.01, default: 0.4 },
  },
};

const PERIOD = 16;
const SLOTS = 64;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  // Distance in LEDs along the bands' direction: diagonal on a curtain.
  const s = { pos: new Float32Array(n), mid: new Float32Array(n), off: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    if (wide) {
      s.pos[i] = u[i] * (n - 1);
      s.mid[i] = Math.abs(u[i] - 0.5) * (n - 1);
    } else {
      s.pos[i] = y[i] * 20 + x[i] * 9 * 0.6;
      s.mid[i] = Math.abs(y[i] - 0.5) * 20 + Math.abs(x[i] - 0.5) * 9 * 0.6;
    }
    s.off[i] = hash(i, 3) * SLOTS;
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const red = colors[0] || [1, 0.06, 0.12];
  const green = colors[1] || [0.06, 0.82, 0.25];
  const sp = colors[2] || [1, 0.96, 0.88];
  const p = (t * params.speed) / PERIOD;
  const beats = p * PERIOD * 2; // two band moves a second at speed 1
  const w = params.width;
  let ph;
  if (params.mode === "swap") {
    // Bands jump one width at a time, with a quick soft change.
    const b = Math.floor(beats);
    ph = b + smoothstep(0, 0.35, beats - b);
  } else {
    ph = beats;
  }
  const pos = params.mode === "meet" ? s.mid : s.pos;
  const dir = params.mode === "meet" ? 1 : -1;
  const thr = params.sparkle * 0.12;
  for (let i = 0; i < n; i++) {
    const v = Math.sin(PI * (pos[i] / w + dir * ph));
    // Soft-edged square wave: mostly solid bands, a short fade between.
    const k = smoothstep(-0.45, 0.45, v);
    // Brightest in the middle of each band.
    const lum = 0.7 + 0.3 * Math.abs(v);
    let r = (green[0] + (red[0] - green[0]) * k) * lum;
    let g = (green[1] + (red[1] - green[1]) * k) * lum;
    let b = (green[2] + (red[2] - green[2]) * k) * lum;
    const q = p * SLOTS + s.off[i];
    const slot = Math.floor(q);
    if (hash(i * 97 + (slot % SLOTS), 5) < thr) {
      const f = q - slot;
      const g2 = f < 0.1 ? f / 0.1 : Math.exp(-(f - 0.1) * 7);
      r += (sp[0] - r) * g2;
      g += (sp[1] - g) * g2;
      b += (sp[2] - b) * g2;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
