export const meta = {
  name: "Surf",
  description: "Waves washing up a sandy beach in a line of foam and sliding back out.",
  category: "Nature",
  colors: [
    { id: "deep", label: "Deep water", default: "#06375c" },
    { id: "shallow", label: "Shallows", default: "#14a3b8" },
    { id: "foam", label: "Foam", default: "#f2fbff" },
    { id: "sand", label: "Sand", default: "#b8864a" },
  ],
  params: {
    period: { type: "number", label: "Seconds per wave", min: 3, max: 20, step: 0.5, unit: "s", default: 7 },
    size: { type: "number", label: "Wave reach", min: 0.05, max: 0.5, step: 0.01, default: 0.25 },
    shore: { type: "number", label: "Shoreline", min: 0.2, max: 0.8, step: 0.01, default: 0.45 },
    side: { type: "select", label: "Sea on the", options: ["left", "right"], labels: ["Left", "Right"], default: "left" },
  },
  looks: [
    { name: "Tropical", params: {}, colors: ["#0060a0", "#00e0c8", "#ffffff", "#ffd080"] },
    { name: "Stormy", params: { period: 4, size: 0.4 }, colors: ["#021a3a", "#1a5a8a", "#e0f0ff", "#c08040"] },
    { name: "Calm", params: { period: 12, size: 0.12 }, colors: ["#04305a", "#2a8ad0", "#e8f8ff", "#d0a060"] },
    { name: "Sunset beach", params: { side: "right" }, colors: ["#2a0a5a", "#ff5a6a", "#fff0e0", "#ff9a40"] },
  ],
};

// Waves come in sets of WAVES of different sizes, then the set repeats.
const WAVES = 5;

export function loop(params) {
  return WAVES * params.period;
}

export function render(ctx) {
  const { n, x, y, out, params, colors, t, spacing } = ctx;
  const deep = colors[0] || [0.02, 0.22, 0.36];
  const shallow = colors[1] || [0.08, 0.64, 0.72];
  const foam = colors[2] || [0.95, 0.98, 1];
  const sand = colors[3] || [0.79, 0.6, 0.36];
  const P = params.period;
  const L = WAVES * P;
  const tt = ((t % L) + L) % L;
  const k = Math.floor(tt / P);
  const ph = tt / P - k; // 0..1 through this wave
  const size = params.size * (0.6 + 0.6 * hash(k, 1));
  const prevSize = params.size * (0.6 + 0.6 * hash((k + WAVES - 1) % WAVES, 1));
  // Swash: rushes up fast, slides back slowly.
  const up = ph < 0.35 ? ease.out(ph / 0.35) : 1 - ease.inOut((ph - 0.35) / 0.65);
  const advancing = ph < 0.35;
  const soft = Math.max(spacing * 1.5, 0.03);
  const flip = params.side === "right";
  for (let i = 0; i < n; i++) {
    const xi = flip ? 1 - x[i] : x[i];
    const yi = y[i];
    // A gently wavy shoreline; each wave also reaches a little unevenly.
    const shore = params.shore + 0.07 * Math.sin(yi * 5.3 + 1) + 0.03 * Math.sin(yi * 11 + 2);
    const uneven = 1 + 0.4 * Math.sin(yi * 6 + k * 2.1);
    const edge = shore + size * uneven * up;
    const reach = shore + size * uneven;
    // Wet sand: dark where this wave (or the last one) has been, drying out.
    const prevReach = shore + prevSize * (1 + 0.4 * Math.sin(yi * 6 + ((k + WAVES - 1) % WAVES) * 2.1));
    const wetNow = smoothstep(reach + soft, reach - soft, xi) * (advancing ? up : 1);
    const wetPrev = smoothstep(prevReach + soft, prevReach - soft, xi) * (1 - ph);
    const wet = Math.max(wetNow, wetPrev);
    const sk = 1 - 0.4 * wet;
    let r = sand[0] * sk * (1 - 0.1 * wet), g = sand[1] * sk, b = sand[2] * sk + 0.03 * wet;
    // Water up to the moving edge.
    const water = smoothstep(edge + soft, edge - soft, xi);
    if (water > 0) {
      const depth = clamp((shore - xi) / Math.max(0.05, shore));
      // Swells rolling in towards the beach.
      const swell = Math.pow(0.5 + 0.5 * Math.sin(TAU * (xi * 4 - (tt / P) * 2) + yi * 2), 6) * depth;
      const wr = lerp(shallow[0], deep[0], depth) + (foam[0] - shallow[0]) * swell * 0.25;
      const wg = lerp(shallow[1], deep[1], depth) + (foam[1] - shallow[1]) * swell * 0.25;
      const wb = lerp(shallow[2], deep[2], depth) + (foam[2] - shallow[2]) * swell * 0.25;
      // Thin water over sand is see-through.
      const thin = clamp((edge - xi) / 0.12);
      const a = water * (0.45 + 0.55 * thin);
      r += (wr - r) * a;
      g += (wg - g) * a;
      b += (wb - b) * a;
    }
    // Foam on the leading edge, breaking up as the water draws back.
    const fd = (xi - (edge - soft * 0.5)) / (soft * 1.6);
    const foamK = advancing ? 0.35 + 0.65 * smoothstep(0, 0.1, ph) : 0.35 + 0.65 * smoothstep(1, 0.35, ph);
    let fo = Math.exp(-fd * fd) * foamK;
    fo *= 0.75 + 0.25 * Math.sin(yi * 17 + TAU * ph * 3);
    // Where the wave breaks, a band of white water.
    const bd = (xi - (shore - 0.08 + 0.04 * up)) / 0.06;
    fo = Math.max(fo, 0.45 * Math.exp(-bd * bd) * (0.5 - 0.5 * Math.cos(TAU * ph)));
    fo = clamp(fo);
    out[i * 3] = r + (foam[0] - r) * fo;
    out[i * 3 + 1] = g + (foam[1] - g) * fo;
    out[i * 3 + 2] = b + (foam[2] - b) * fo;
  }
}
