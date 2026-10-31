export const meta = {
  name: "Burn",
  description: "A glowing ember edge eats through the old look, charring it, and leaves the new one behind.",
  params: {
    from: {
      type: "select",
      label: "Starts",
      options: ["bottom", "top", "middle", "everywhere"],
      labels: ["At the bottom", "At the top", "In the middle", "In patches everywhere"],
      default: "bottom",
    },
    hue: { type: "number", label: "Ember colour", min: 0, max: 1, step: 0.01, default: 0.06 },
    glow: { type: "number", label: "Glow", min: 0, max: 1, step: 0.01, default: 1 },
    width: { type: "number", label: "Ember width", min: 0.02, max: 0.3, step: 0.01, default: 0.08 },
  },
};

export function setup(ctx) {
  const { n, x, y, u, aspect, params } = ctx;
  const line = sampler(ctx).line;
  // The order in which LEDs catch fire: a shape plus ragged noise.
  const order = new Float32Array(n);
  let lo = Infinity,
    hi = -Infinity;
  const rough = params.from === "everywhere" ? 1 : 0.35;
  for (let i = 0; i < n; i++) {
    const px = line ? u[i] : x[i] * aspect,
      py = line ? 0.5 : y[i];
    let base;
    if (params.from === "top") base = line ? 1 - u[i] : 1 - y[i];
    else if (params.from === "middle")
      base = line ? Math.abs(u[i] - 0.5) * 2 : Math.hypot((x[i] - 0.5) * aspect, y[i] - 0.5);
    else if (params.from === "everywhere") base = 0;
    else base = line ? u[i] : y[i];
    const ragged = 0.5 + 0.5 * (noise(px * 3.1, py * 3.1, 4.2) * 0.7 + noise(px * 7.3, py * 7.3, 9.1) * 0.3);
    order[i] = base * (1 - rough) + ragged * rough;
    lo = Math.min(lo, order[i]);
    hi = Math.max(hi, order[i]);
  }
  for (let i = 0; i < n; i++) order[i] = hi - lo > 1e-6 ? (order[i] - lo) / (hi - lo) : 0;
  return { order };
}

export function render(ctx, s) {
  const { n, x, y, u, a, b, out, progress, params, t } = ctx;
  const ember = Math.max(params.width, ctx.spacing * 2);
  const char = ember * 1.2;
  const front = progress * (1 + char + ember * 1.5) - char;
  const hot = hsv(params.hue, 0.95, 1);
  const core = hsv(params.hue + 0.05, 0.75, 1);
  // No glow left at the very start and end.
  const env = Math.min(1, Math.sin(PI * progress) * 8);
  for (let i = 0; i < n; i++) {
    // How far the fire has got past this LED.
    const d = front - s.order[i];
    // Ahead of the edge the old look darkens and browns.
    const charring = smoothstep(-char, 0, d);
    // At the edge it glows (and flickers a little); behind, the new look appears.
    const flicker = 1 + 0.25 * noise(i * 0.37, t * 6);
    const heat = 1.3 * env * params.glow * Math.exp(-(((d - ember * 0.5) / (ember * 0.45)) ** 2)) * flicker;
    const k = smoothstep(ember * 0.3, ember * 1.3, d);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const old = a[j + c] * (1 - 0.85 * charring) + hot[c] * 0.15 * charring;
      const v = old + (b[j + c] - old) * k;
      const glow = hot[c] + (core[c] - hot[c]) * clamp((heat - 0.6) * 1.4);
      out[j + c] = v + (glow - v) * clamp(heat);
    }
  }
}
