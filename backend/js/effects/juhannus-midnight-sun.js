export const meta = {
  name: "Juhannus midnight sun",
  description: "The midsummer sun skimming a dark lakeside treeline, mirrored in still water.",
  category: "Seasonal",
  colors: [
    { id: "sun", label: "Sun", default: "#ffcf6e" },
    { id: "glow", label: "Horizon", default: "#ff8a5c" },
    { id: "sky", label: "Sky", default: "#9a7ad8" },
    { id: "lake", label: "Lake", default: "#3a5aa8" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    trees: { type: "number", label: "Treeline", min: 0, max: 1, step: 0.01, default: 0.6 },
    ripples: { type: "number", label: "Ripples", min: 0, max: 1, step: 0.01, default: 0.5 },
    brightness: { type: "number", label: "Brightness", min: 0.2, max: 1, step: 0.01, default: 0.85 },
  },
  looks: [
    { name: "Golden", params: { brightness: 1 }, colors: ["#ffe070", "#ffa030", "#ffa040", "#4a60b0"] },
    { name: "Rose dusk", params: { trees: 0.4 }, colors: ["#ffb080", "#ff5a7a", "#c060c0", "#5040a0"] },
    { name: "Still lake", params: { speed: 0.4, ripples: 0.15 }, colors: ["#fff0a0", "#ff9a50", "#6a90ff", "#2050c0"] },
    { name: "Light night", params: { brightness: 0.7, ripples: 0.7 }, colors: ["#ffd0a0", "#ff80c0", "#8a70ff", "#2a3a90"] },
  ],
};

const PERIOD = 60;
const HZ = 0.36; // horizon height

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
  const sun = colors[0] || [1, 0.81, 0.43];
  const glow = colors[1] || [1, 0.54, 0.36];
  const sky = colors[2] || [0.6, 0.48, 0.85];
  const lake = colors[3] || [0.23, 0.35, 0.66];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const br = params.brightness;
  // The sun drifts along the horizon, dipping a little but never setting.
  const sx = 0.5 + 0.28 * Math.sin(TAU * p);
  const sy = HZ + 0.12 + 0.05 * Math.cos(TAU * p * 2);
  const sr = 0.11;
  const soft = Math.max(spacing * 1.2, 0.03);
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    let r = 0, g = 0, b = 0;
    if (wide) {
      const d = Math.abs(xi - sx);
      const warm = Math.exp(-d * 3);
      const disc = smoothstep(0.05 + soft, 0.05 - soft, d);
      const sh = 0.85 + 0.15 * Math.sin(TAU * (xi * 9 - p * 20));
      r = (sky[0] + (glow[0] - sky[0]) * warm) * 0.6 * sh;
      g = (sky[1] + (glow[1] - sky[1]) * warm) * 0.6 * sh;
      b = (sky[2] + (glow[2] - sky[2]) * warm) * 0.6 * sh;
      r += (sun[0] - r) * disc;
      g += (sun[1] - g) * disc;
      b += (sun[2] - b) * disc;
    } else {
      // Mirror the sky in the lake, broken up by gentle ripples.
      const under = y[i] < HZ;
      const ripple = under ? Math.sin(TAU * ((HZ - y[i]) * 14 - p * 30) + xi * 4) * params.ripples : 0;
      const yy = under ? 2 * HZ - y[i] : y[i];
      const xx = xi + ripple * 0.03;
      const above = yy - HZ;
      const dx = (xx - sx) * 1.2, dy = yy - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Pastel sky: warm low down and around the sun, lilac higher up.
      const warm = clamp(Math.exp(-above * 4) * 0.8 + Math.exp(-dist * 5) * 0.6);
      const dim = 0.5 + 0.25 * Math.exp(-dist * 4);
      r = (sky[0] + (glow[0] - sky[0]) * warm) * dim;
      g = (sky[1] + (glow[1] - sky[1]) * warm) * dim;
      b = (sky[2] + (glow[2] - sky[2]) * warm) * dim;
      const disc = smoothstep(sr + soft, sr - soft, dist);
      r += (sun[0] - r) * disc;
      g += (sun[1] - g) * disc;
      b += (sun[2] - b) * disc;
      if (under) {
        // The water is darker and bluer than the sky it reflects.
        const depth = clamp((HZ - y[i]) / HZ);
        const k = 0.55 - 0.15 * depth + 0.12 * ripple;
        // A glittering golden path under the sun.
        const pd = (xi - sx) / (0.07 + depth * 0.1);
        const path = Math.exp(-pd * pd) * (0.5 + 0.5 * ripple) * 0.6;
        r = r * k * 0.8 + lake[0] * 0.2 + sun[0] * path;
        g = g * k * 0.8 + lake[1] * 0.2 + sun[1] * path;
        b = b * k * 0.8 + lake[2] * 0.2 + sun[2] * path;
      }
      // Spruce treeline on the far shore, mirrored too.
      const tc = xi * 9;
      const tooth = Math.abs(fract(tc + 0.5 * hash(Math.floor(tc), 3)) - 0.5) * 2;
      const tree = params.trees * (0.03 + 0.14 * (0.3 + 0.7 * hash(Math.floor(tc), 4)) * (1 - tooth));
      const sil = smoothstep(tree + soft, tree - soft * 0.5, Math.abs(y[i] - HZ) * (under ? 1.6 : 1));
      const keep = 1 - sil * 0.85;
      r *= keep;
      g *= keep;
      b *= keep;
    }
    const o = i * 3;
    out[o] = r * br;
    out[o + 1] = g * br;
    out[o + 2] = b * br;
  }
}
