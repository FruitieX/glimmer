export const meta = {
  name: "Blinds",
  description: "Venetian blinds: slats turn over one after another to show the new look.",
  params: {
    slats: { type: "number", label: "Slats", min: 2, max: 16, step: 1, default: 6 },
    orientation: {
      type: "select",
      label: "Slats run",
      options: ["horizontal", "vertical"],
      labels: ["Horizontally", "Vertically"],
      default: "horizontal",
    },
    stagger: { type: "number", label: "One after another", min: 0, max: 1, step: 0.01, default: 0.5 },
    softness: { type: "number", label: "Edge softness", min: 0.01, max: 0.5, step: 0.01, default: 0.15 },
  },
};

export function setup(ctx) {
  return { line: sampler(ctx).line };
}

export function render(ctx, s) {
  const { n, x, y, u, a, b, out, progress, params } = ctx;
  const count = Math.max(1, Math.round(params.slats));
  const len = 1 - (params.stagger * (count - 1)) / count;
  // Softness in units of one slat, at least about one LED.
  const soft = Math.max(params.softness, ctx.spacing * count * 1.5);
  for (let i = 0; i < n; i++) {
    // Slats are counted from the top (or the left, or the start of the wire).
    const across = s.line ? u[i] : params.orientation === "vertical" ? x[i] : 1 - y[i];
    const slat = Math.min(count - 1, Math.floor(across * count));
    const local = across * count - slat;
    const q = ease.inOut(clamp((progress - (slat / count) * params.stagger) / len));
    const k = smoothstep(local, local + soft, q * (1 + soft));
    // Turning slats catch the light for a moment.
    const shine = 0.25 * Math.sin(PI * q) * Math.max(0, 1 - Math.abs(local - q) * 2);
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      const v = a[j] + (b[j] - a[j]) * k;
      out[j] = v + (1 - v) * shine;
    }
  }
}
