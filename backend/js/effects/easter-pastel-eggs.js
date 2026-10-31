export const meta = {
  name: "Easter pastel eggs",
  description: "Painted Easter eggs in soft pastels, their zigzag bands turning slowly as if the eggs were spinning.",
  category: "Seasonal",
  colors: [
    { id: "pink", label: "Pink", default: "#ff9ac0" },
    { id: "blue", label: "Blue", default: "#8ad4ff" },
    { id: "yellow", label: "Yellow", default: "#ffe880" },
    { id: "green", label: "Green", default: "#a8f090" },
    { id: "grass", label: "Background", default: "#14401c" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 0.8 },
    size: { type: "number", label: "Egg size", min: 8, max: 40, step: 1, unit: "LEDs", default: 14 },
  },
};

const PERIOD = 40;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, u, out, colors, params, t, aspect, spacing } = ctx;
  const nc = Math.max(1, Math.min(4, colors.length - 1));
  const bg = colors[4] || [0.08, 0.25, 0.11];
  const p = (t * params.speed) / PERIOD;
  if (aspect > 2.5) {
    // A row of eggs gliding slowly along, each with a band of another colour.
    const size = params.size;
    const span = Math.max(1, n - 1);
    const slot = size + 3;
    const shift = p * slot * 4;
    for (let i = 0; i < n; i++) {
      const q = (u[i] * span - shift) / slot;
      const ei = Math.floor(q);
      const e = ((q - ei) * slot - size / 2) / (size / 2); // -1..1 across the egg
      const ae = Math.abs(e);
      const shape = smoothstep(1.05, 0.85, ae);
      let r = bg[0] * 0.6, g = bg[1] * 0.6, b = bg[2] * 0.6;
      if (shape > 0) {
        const ci = ((ei % nc) + nc) % nc;
        const base = colors[ci] || [1, 0.7, 0.8];
        const deco = colors[(ci + 1) % nc] || base;
        // Two stripes either side of the middle, wobbling as the egg turns.
        const wob = 0.08 * Math.sin(TAU * (p * 12 + ei * 0.3));
        const sd = Math.abs(ae - 0.45 - wob);
        const stripe = smoothstep(0.2, 0.1, sd);
        const lv = 0.6 + 0.35 * (1 - ae * ae);
        const cr = (base[0] + (deco[0] - base[0]) * stripe) * lv;
        const cg = (base[1] + (deco[1] - base[1]) * stripe) * lv;
        const cb = (base[2] + (deco[2] - base[2]) * stripe) * lv;
        r += (cr - r) * shape;
        g += (cg - g) * shape;
        b += (cb - b) * shape;
      }
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  // One big egg in the middle, slowly turning; its colours change every few turns.
  const cycle = p * 4;
  const ei = Math.floor(cycle);
  const dim = 1 - 0.85 * Math.sin(PI * smoothstep(0.88, 1, cycle - ei));
  const base = colors[ei % nc] || [1, 0.7, 0.8];
  const deco = colors[(ei + 1) % nc] || base;
  const deco2 = colors[(ei + 2) % nc] || base;
  const soft = Math.max(spacing, 0.03);
  const turn = p * 8;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] - 0.5) * aspect, dy = y[i] - 0.5;
    // Grass along the bottom with a gentle sway.
    const gr = smoothstep(0.14 + 0.03 * Math.sin(x[i] * 20 + TAU * p * 4), 0.04, y[i]);
    let r = bg[0] * (0.35 + 0.65 * gr), g = bg[1] * (0.35 + 0.65 * gr), b = bg[2] * (0.35 + 0.65 * gr);
    // An egg: narrower at the top.
    const ry = 0.4, rx = 0.33 * (1 - 0.18 * clamp(dy / ry));
    const d2 = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (d2 < 1.6) {
      const d = Math.sqrt(d2);
      const shape = smoothstep(1 + soft / ry, 1 - soft / ry, d);
      // Where on the egg's surface this is, around (a) and up (v).
      const a = dx / (rx * Math.sqrt(Math.max(0.05, 1 - (dy * dy) / (ry * ry))));
      const v = dy / ry;
      // Three broad zigzag bands sliding round as the egg turns.
      const zig = 0.12 * Math.abs(fract(a * 1.2 + turn) - 0.5) * 2;
      const w = fract((v + zig) * 1.4 + 0.5);
      const stripe = smoothstep(0.08, 0.2, w) * smoothstep(0.52, 0.4, w);
      const thin = Math.exp(-Math.pow((w - 0.72) / 0.07, 2));
      const lv = (0.6 + 0.4 * (1 - d2)) * dim;
      let cr = base[0] + (deco[0] - base[0]) * stripe, cg = base[1] + (deco[1] - base[1]) * stripe, cb = base[2] + (deco[2] - base[2]) * stripe;
      cr += (deco2[0] - cr) * thin;
      cg += (deco2[1] - cg) * thin;
      cb += (deco2[2] - cb) * thin;
      r += (cr * lv - r) * shape;
      g += (cg * lv - g) * shape;
      b += (cb * lv - b) * shape;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
