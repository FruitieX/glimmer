export const meta = {
  name: "Juhannus bonfire",
  description: "A midsummer kokko bonfire blazing by the lake, sparks rising into the light night.",
  category: "Seasonal",
  colors: [
    { id: "core", label: "Flame core", default: "#ffd36b" },
    { id: "flame", label: "Flames", default: "#ff5a0a" },
    { id: "ember", label: "Embers", default: "#8a1004" },
    { id: "night", label: "Summer night", default: "#2a3a78" },
  ],
  params: {
    height: { type: "number", label: "Fire size", min: 0.3, max: 1.2, step: 0.01, default: 0.75 },
    speed: { type: "number", label: "Speed", min: 0.3, max: 2, step: 0.01, default: 1 },
    sparks: { type: "number", label: "Sparks", min: 0, max: 30, step: 1, default: 10 },
    night: { type: "number", label: "Sky brightness", min: 0, max: 1, step: 0.01, default: 0.35 },
  },
  looks: [
    { name: "Kokko", params: { height: 1.1, sparks: 22 }, colors: ["#fff0a0", "#ff7010", "#b01800", "#283070"] },
    { name: "Embers", params: { height: 0.55, speed: 0.6, sparks: 4 }, colors: ["#ffa040", "#e03000", "#600800", "#1a2050"] },
    { name: "Dusk", params: { night: 0.55 }, colors: ["#ffd080", "#ff5020", "#901010", "#5a3a80"] },
    { name: "Blue hour", params: { speed: 0.8, sparks: 18, night: 0.55 }, colors: ["#ffe070", "#ff6a00", "#a01a00", "#1a40b0"] },
  ],
};

const PERIOD = 20;
const SCROLL = 30; // noise units the flames rise per loop

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const core = colors[0] || [1, 0.83, 0.42];
  const flame = colors[1] || [1, 0.35, 0.04];
  const ember = colors[2] || [0.54, 0.06, 0.02];
  const night = colors[3] || [0.16, 0.23, 0.47];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  // Scrolling noise that loops: blend two copies one loop apart.
  const s = fract(p) * SCROLL;
  const w = s / SCROLL;
  const H = params.height;
  const nb = params.night;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    let heat, sky;
    if (wide) {
      // Along a line: the fire in the middle, flickering outwards.
      const d = Math.abs(xi - 0.5) / (0.18 * H);
      const fx = d * 3;
      const tb = (1 - w) * noise(fx - s * 0.3, 1.5) + w * noise(fx - s * 0.3 + SCROLL * 0.3, 1.5);
      heat = clamp(1.15 - d * (0.9 + 0.5 * tb) + tb * 0.3);
      sky = 0.6;
    } else {
      const yi = y[i];
      heat = 0;
      // Logs glowing along the bottom.
      if (yi < 0.07) heat = 0.45 * smoothstep(0.5, 0.25, Math.abs(xi - 0.5));
      if (Math.abs(xi - 0.5) < 0.42 && yi < H * 1.3) {
        const ny = yi * 3.2 - s;
        const nx = xi * 4.5;
        const tb = (1 - w) * noise(nx, ny, 0.5) + w * noise(nx, ny + SCROLL, 0.5);
        // A cone of flame: tall in the middle, tapering to the sides.
        const side = Math.abs(xi - 0.5 + tb * 0.08) / 0.32;
        const top = H * (1 - side * side) * (0.8 + 0.4 * tb);
        if (top > 0) heat = Math.max(heat, clamp((1 - yi / top) * 1.3 + tb * 0.35));
      }
      sky = 0.25 + 0.75 * yi;
    }
    let r, g, b;
    // Embers → flames → yellow-white core.
    if (heat < 0.4) {
      const k = heat / 0.4;
      r = ember[0] * k;
      g = ember[1] * k;
      b = ember[2] * k;
    } else if (heat < 0.75) {
      const k = (heat - 0.4) / 0.35;
      r = ember[0] + (flame[0] - ember[0]) * k;
      g = ember[1] + (flame[1] - ember[1]) * k;
      b = ember[2] + (flame[2] - ember[2]) * k;
    } else {
      const k = (heat - 0.75) / 0.25;
      r = flame[0] + (core[0] - flame[0]) * k;
      g = flame[1] + (core[1] - flame[1]) * k;
      b = flame[2] + (core[2] - flame[2]) * k;
    }
    // The bright summer night shows where the fire doesn't.
    const bg = nb * sky * (1 - clamp(heat * 2));
    const o = i * 3;
    out[o] = r + night[0] * bg;
    out[o + 1] = g + night[1] * bg;
    out[o + 2] = b + night[2] * bg;
  }
  // Sparks floating up and drifting.
  const rs = wide ? Math.max(spacing * 1.2, 0.006) : Math.max(spacing * 0.8, 0.035);
  for (let k = 0; k < params.sparks; k++) {
    const laps = 6 + Math.floor(hash(k, 1) * 6);
    const life = fract(p * laps + hash(k, 2));
    const drift = Math.sin(TAU * (p * laps * 2 + hash(k, 3)));
    let sx, sy;
    if (wide) {
      sx = 0.5 + (hash(k, 4) - 0.5) * 0.12 * H + (hash(k, 5) < 0.5 ? -1 : 1) * life * 0.25 * H;
      sy = 0.5;
    } else {
      sx = 0.5 + (hash(k, 4) - 0.5) * 0.3 + drift * 0.06 + (hash(k, 5) - 0.5) * life * 0.3;
      sy = H * 0.5 + life * (1.1 - H * 0.4);
    }
    const fade = (1 - life) * (1 - life) * smoothstep(0, 0.1, life);
    const flick = 0.7 + 0.3 * Math.sin(TAU * (p * laps * 9 + hash(k, 6)));
    const a = fade * flick;
    for (let i = 0; i < n; i++) {
      const ex = (x[i] - sx) / (wide ? rs : rs * 1.8);
      if (ex > 3 || ex < -3) continue;
      const ey = wide ? 0 : (y[i] - sy) / rs;
      const d2 = ex * ex + ey * ey;
      if (d2 > 9) continue;
      const v = Math.exp(-d2 * 1.5) * a;
      const o = i * 3;
      out[o] = Math.max(out[o], core[0] * v);
      out[o + 1] = Math.max(out[o + 1], core[1] * v * 0.75);
      out[o + 2] = Math.max(out[o + 2], core[2] * v * 0.4);
    }
  }
}
