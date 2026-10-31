export const meta = {
  name: "Christmas gift ribbons",
  description: "Wrapped presents with shimmering golden ribbons and bows; a row of gifts gliding along a long string.",
  category: "Seasonal",
  colors: [
    { id: "paper1", label: "Paper", default: "#d0102a" },
    { id: "paper2", label: "Paper 2", default: "#0c7a3a" },
    { id: "paper3", label: "Paper 3", default: "#2040b0" },
    { id: "ribbon", label: "Ribbon", default: "#ffc840" },
    { id: "night", label: "Background", default: "#060414" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    size: { type: "number", label: "Gift size", min: 8, max: 40, step: 1, unit: "LEDs", default: 16 },
    shimmer: { type: "number", label: "Shimmer", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
};

const PERIOD = 36;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect } = ctx;
  const np = Math.max(1, Math.min(3, colors.length - 2));
  const ribbon = colors[3] || [1, 0.78, 0.25];
  const night = colors[4] || [0.02, 0.02, 0.08];
  const p = (t * params.speed) / PERIOD;
  const sh = params.shimmer;

  if (aspect > 2.5) {
    // Gifts in a row, gliding slowly; each has a ribbon round its middle.
    const size = params.size;
    const shift = p * size * 6; // six gifts pass per loop
    const span = n - 1;
    for (let i = 0; i < n; i++) {
      const pos = u[i] * span - shift;
      const q = pos / size;
      const gi = Math.floor(q);
      const f = q - gi; // 0..1 across this gift
      const e = (f - 0.5) * size; // LEDs from the gift's middle
      const half = size * 0.5 - 1;
      const box = smoothstep(half + 0.5, half - 0.5, Math.abs(e));
      const rib = smoothstep(1.6, 0.6, Math.abs(e));
      const c = colors[((gi % np) + np) % np] || [0.8, 0.1, 0.1];
      // A diagonal sheen sliding over the paper and a glint along the ribbon.
      const pat = 0.72 + 0.18 * Math.cos(TAU * (f * 3 + p * 4));
      const glint = Math.pow(0.5 + 0.5 * Math.cos(TAU * (u[i] * 2 - p * 9)), 12) * sh;
      const o = i * 3;
      for (let ch = 0; ch < 3; ch++) {
        let v = c[ch] * pat;
        v += (ribbon[ch] * (0.75 + 0.25 * sh * Math.cos(TAU * (p * 12 + gi * 0.3))) - v) * rib;
        v = night[ch] + (v - night[ch]) * box;
        out[o + ch] = v + (1 - v) * glint * 0.45 * box;
      }
    }
    return;
  }

  // One big present; its paper changes every six seconds or so.
  const gifts = 6;
  const g = p * gifts;
  const gi = Math.floor(g);
  const blend = smoothstep(0.85, 1, g - gi);
  const c0 = colors[gi % np] || [0.8, 0.1, 0.1];
  const c1 = colors[(gi + 1) % np] || c0;
  const top = 0.76;
  // The old paper dims away and the new one glows up, instead of a muddy mix.
  const dip = 1 - 0.9 * Math.sin(PI * blend);
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    const dx = Math.abs(xi - 0.5);
    const box = smoothstep(top + 0.03, top - 0.02, yi) * smoothstep(0.02, 0.06, yi) * smoothstep(0.49, 0.45, dx);
    // The ribbon: one band down, one across, and a bow on top.
    const ribV = smoothstep(0.1, 0.06, dx);
    const ribH = smoothstep(0.065, 0.03, Math.abs(yi - 0.42));
    const lid = smoothstep(0.05, 0.02, Math.abs(yi - (top - 0.03))) * 0.35;
    const bx = (dx - 0.18) * aspect, by = yi - 0.86;
    const loopR = Math.sqrt(bx * bx * 1.1 + by * by * 2.2);
    const bow = smoothstep(0.13, 0.09, loopR) * (0.6 + 0.4 * smoothstep(0.02, 0.09, loopR)) + smoothstep(0.08, 0.04, Math.sqrt(dx * dx * aspect * aspect + (yi - 0.82) * (yi - 0.82)));
    const rib = Math.max(ribV * box, ribH * box, clamp(bow));
    // A glint travels round the ribbon: up the band, then out along the bow.
    const along = ribV > ribH ? yi : 0.42 + dx;
    const glint = Math.pow(0.5 + 0.5 * Math.cos(TAU * (along * 1.2 - p * 12)), 10) * sh;
    // Paper: soft diagonal stripes.
    const pat = 0.6 + 0.25 * smoothstep(-0.3, 0.3, Math.sin((xi * 0.9 + yi) * 18));
    const o = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      let v = (blend < 0.5 ? c0[ch] : c1[ch]) * pat * (1 + lid) * dip;
      v = night[ch] + (v - night[ch]) * box;
      const rc = ribbon[ch] * (0.8 + 0.2 * Math.cos(TAU * (p * 18 + xi)));
      v += (rc - v) * rib;
      out[o + ch] = v + (1 - v) * glint * rib * 0.7;
    }
  }
}
