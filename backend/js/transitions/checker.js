export const meta = {
  name: "Checkerboard",
  description: "Squares turn over like tiles, first every other one, then the rest.",
  params: {
    cells: { type: "number", label: "Squares across", min: 2, max: 12, step: 1, default: 4 },
    flip: { type: "boolean", label: "Turn over (instead of fading)", default: true },
  },
};

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const line = sampler(ctx).line;
  const cells = Math.max(1, Math.round(ctx.params.cells));
  const start = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let cx, cy;
    if (line) {
      cx = Math.min(cells * 2 - 1, Math.floor(u[i] * cells * 2));
      cy = 0;
    } else {
      // Roughly square cells in real proportions.
      const rows = Math.max(1, Math.round(cells / Math.max(0.2, aspect)));
      cx = Math.min(cells - 1, Math.floor(x[i] * cells));
      cy = Math.min(rows - 1, Math.floor(y[i] * rows));
    }
    start[i] = ((cx + cy) % 2) * 0.45 + hash(cy * 64 + cx, 3) * 0.15;
  }
  return { start };
}

export function render(ctx, s) {
  const { n, a, b, out, progress, params } = ctx;
  for (let i = 0; i < n; i++) {
    const q = smoothstep(s.start[i], s.start[i] + 0.4, progress);
    let k = q,
      level = 1;
    if (params.flip) {
      // A turning tile shows its edge (dark) half way through.
      k = q < 0.5 ? 0 : 1;
      level = Math.abs(Math.cos(PI * q));
    }
    for (let c = 0; c < 3; c++) {
      const j = i * 3 + c;
      out[j] = (a[j] + (b[j] - a[j]) * k) * level;
    }
  }
}
