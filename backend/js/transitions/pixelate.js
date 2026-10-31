export const meta = {
  name: "Mosaic",
  description: "The old look breaks into ever bigger blocks, which turn into the new look and sharpen again.",
  params: {
    size: { type: "number", label: "Largest blocks (LEDs)", min: 2, max: 12, step: 1, default: 5 },
  },
};

export function setup(ctx) {
  const { n, x, y, u } = ctx;
  const s = sampler(ctx);
  const levels = Math.max(2, Math.round(ctx.params.size));
  // For each block size (in LEDs): which block every LED belongs to.
  const blocks = [];
  for (let size = 2; size <= levels; size++) {
    const w = size * (s.line ? s.su : s.sx),
      h = size * s.sy;
    const id = new Int32Array(n);
    const ids = new Map();
    for (let i = 0; i < n; i++) {
      const key = s.line ? Math.floor(u[i] / w + 1e-4) : Math.floor(x[i] / w + 1e-4) * 4096 + Math.floor(y[i] / h + 1e-4);
      if (!ids.has(key)) ids.set(key, ids.size);
      id[i] = ids.get(key);
    }
    blocks.push({ id, count: ids.size, sum: new Float32Array(ids.size * 3), num: new Float32Array(ids.size) });
  }
  return { blocks, mixed: new Float32Array(n * 3), lo: new Float32Array(n * 3), hi: new Float32Array(n * 3) };
}

// Writes `src` averaged over the blocks of `level` (0: unchanged) into `dst`.
function mosaic(src, level, s, dst, n) {
  if (level === 0) {
    dst.set(src);
    return;
  }
  const { id, count, sum, num } = s.blocks[level - 1];
  sum.fill(0);
  num.fill(0);
  for (let i = 0; i < n; i++) {
    const k = id[i];
    sum[k * 3] += src[i * 3];
    sum[k * 3 + 1] += src[i * 3 + 1];
    sum[k * 3 + 2] += src[i * 3 + 2];
    num[k]++;
  }
  for (let i = 0; i < n; i++) {
    const k = id[i];
    for (let c = 0; c < 3; c++) dst[i * 3 + c] = sum[k * 3 + c] / num[k];
  }
}

export function render(ctx, s) {
  const { n, a, b, out, progress } = ctx;
  const m = smoothstep(0.35, 0.65, progress);
  const { mixed, lo, hi } = s;
  for (let i = 0; i < n * 3; i++) mixed[i] = a[i] + (b[i] - a[i]) * m;
  // Coarsest half way; blend between neighbouring block sizes so it never jumps.
  const level = ease.inOut(1 - Math.abs(progress * 2 - 1)) * s.blocks.length;
  const l0 = Math.floor(level);
  const f = level - l0;
  mosaic(mixed, l0, s, lo, n);
  if (f > 0 && l0 < s.blocks.length) {
    mosaic(mixed, l0 + 1, s, hi, n);
    for (let i = 0; i < n * 3; i++) out[i] = lo[i] + (hi[i] - lo[i]) * f;
  } else out.set(lo);
}
