export const meta = {
  name: "Curtain",
  description: "The old look parts in the middle like a stage curtain and slides away to both sides (or the new one closes in).",
  params: {
    mode: {
      type: "select",
      label: "Curtain",
      options: ["open", "close"],
      labels: ["Opens (old look slides away)", "Closes (new look slides in)"],
      default: "open",
    },
    axis: {
      type: "select",
      label: "Parts towards",
      options: ["sides", "ends"],
      labels: ["The sides", "Top and bottom"],
      default: "sides",
    },
    folds: { type: "number", label: "Folds", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
};

export function setup(ctx) {
  return { s: sampler(ctx), rgb: [0, 0, 0] };
}

export function render(ctx, st) {
  const { n, x, y, u, out, params } = ctx;
  const { s, rgb } = st;
  // Closing is opening backwards with the pictures swapped.
  const closing = params.mode === "close";
  const p = ease.inOut(closing ? 1 - ctx.progress : ctx.progress);
  const front = closing ? ctx.b : ctx.a;
  const behind = closing ? ctx.a : ctx.b;
  const vertical = params.axis === "ends";
  const soft = Math.max(0.02, ctx.spacing * 1.5);
  const shift = p * (0.5 + soft);
  // Folds a few LEDs wide, fixed to the cloth so they travel with it.
  const period = 4 * (s.line ? s.su : vertical ? s.sy : s.sx);
  const edge = 0.5 + soft - shift;
  for (let i = 0; i < n; i++) {
    const pos = s.line ? u[i] : vertical ? y[i] : x[i];
    // Distance from the outer end of this half (0) towards the middle (0.5).
    const side = pos < 0.5 ? -1 : 1;
    const c = pos < 0.5 ? pos : 1 - pos;
    const k = smoothstep(edge - soft, edge, c);
    // The curtain half moved outwards by `shift`.
    const from = Math.min(0.5, c + shift);
    const src = side < 0 ? from : 1 - from;
    if (s.line) s.along(front, src, rgb);
    else if (vertical) s.at(front, x[i], src, rgb);
    else s.at(front, src, y[i], rgb);
    // Gathered cloth bunches into folds; it casts a shadow on what's behind.
    const fold = 1 - params.folds * Math.min(1, p * 3) * 0.6 * (0.5 + 0.5 * Math.cos((TAU * from) / period));
    const shadow = 1 - 0.6 * (1 - p) * Math.exp(-Math.max(0, c - edge) / 0.08) * smoothstep(0, 0.05, p);
    const j = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const f = rgb[ch] * fold;
      const bv = behind[j + ch] * shadow;
      out[j + ch] = f + (bv - f) * k;
    }
  }
}
