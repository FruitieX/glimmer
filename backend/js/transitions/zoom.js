export const meta = {
  name: "Zoom",
  description: "Flies into the old look while the new one grows out of the middle, optionally spinning.",
  params: {
    twist: { type: "number", label: "Spin", min: -1, max: 1, step: 0.05, default: 0.35 },
    depth: { type: "number", label: "Zoom", min: 0.5, max: 4, step: 0.1, default: 2 },
  },
};

export function setup(ctx) {
  return { s: sampler(ctx), rgb: [0, 0, 0], rgb2: [0, 0, 0] };
}

// Samples `frame` scaled by `zoom` and turned by `turn` around the middle;
// black outside the picture, fading over `soft`.
function view(ctx, s, frame, i, zoom, turn, soft, rgb) {
  if (s.line) {
    const pu = 0.5 + (ctx.u[i] - 0.5) / zoom;
    const outside = Math.max(0, -pu, pu - 1);
    s.along(frame, pu, rgb);
    const k = clamp(1 - outside / soft);
    for (let c = 0; c < 3; c++) rgb[c] *= k;
    return rgb;
  }
  const asp = ctx.aspect;
  const dx = (ctx.x[i] - 0.5) * asp,
    dy = ctx.y[i] - 0.5;
  const cs = Math.cos(turn),
    sn = Math.sin(turn);
  const px = 0.5 + (dx * cs - dy * sn) / zoom / asp,
    py = 0.5 + (dx * sn + dy * cs) / zoom;
  const outside = Math.max(0, -px, px - 1, -py, py - 1);
  s.at(frame, px, py, rgb);
  const k = clamp(1 - outside / soft);
  for (let c = 0; c < 3; c++) rgb[c] *= k;
  return rgb;
}

export function render(ctx, st) {
  const { n, a, b, out, progress, params } = ctx;
  const { s, rgb, rgb2 } = st;
  const p = ease.inOut(progress);
  const soft = Math.max(ctx.spacing * 2, 0.05);
  // The old look grows past the edges; the new one starts small.
  const za = 1 + params.depth * p,
    zb = 1 / (1 + params.depth * (1 - p));
  const ta = params.twist * PI * p,
    tb = -params.twist * PI * (1 - p);
  const m = smoothstep(0.2, 0.8, progress);
  for (let i = 0; i < n; i++) {
    view(ctx, s, a, i, za, ta, soft, rgb);
    view(ctx, s, b, i, zb, tb, soft, rgb2);
    const j = i * 3;
    for (let c = 0; c < 3; c++) out[j + c] = rgb[c] + (rgb2[c] - rgb[c]) * m;
  }
}
