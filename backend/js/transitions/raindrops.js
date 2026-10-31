export const meta = {
  name: "Raindrops",
  description: "Drops fall and splash; each splash spreads the new look in a growing ring until it covers everything.",
  params: {
    drops: { type: "number", label: "Drops", min: 4, max: 60, step: 1, default: 18 },
    shine: { type: "number", label: "Shine", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
};

export function setup(ctx) {
  const line = sampler(ctx).line;
  const count = Math.round(ctx.params.drops);
  const drops = [];
  for (let k = 0; k < count; k++) {
    drops.push({
      x: hash(k, 1),
      // Where it lands (a line has no height to fall through).
      y: line ? 0.5 : 0.1 + hash(k, 2) * 0.8,
      // When it starts falling, as a share of the transition.
      at: Math.pow(hash(k, 3), 1.3) * 0.55,
    });
  }
  return { line, drops };
}

export function render(ctx, s) {
  const { n, x, y, u, a, b, out, progress, params, aspect } = ctx;
  const fall = s.line ? 0.04 : 0.14;
  const grow = 0.55;
  const soft = Math.max(0.05, ctx.spacing * 1.5);
  const water = [0.75, 0.88, 1];
  for (let i = 0; i < n; i++) {
    const px = s.line ? u[i] : x[i] * aspect;
    const py = s.line ? 0.5 : y[i];
    let k = 0,
      light = 0;
    for (const d of s.drops) {
      const since = progress - d.at;
      if (since <= 0) continue;
      const dx = px - (s.line ? d.x : d.x * aspect);
      if (since < fall) {
        // Falling: a short bright streak heading for its landing point.
        if (s.line || Math.abs(dx) > soft * 2) continue;
        const head = 1 + soft - (1 + soft - d.y) * (since / fall);
        const along = py - head;
        const streak = Math.exp(-((dx / (soft * 0.6)) ** 2)) * smoothstep(soft * 2.5, 0, along) * smoothstep(-soft, 0, along);
        light = Math.max(light, streak * 0.8);
        continue;
      }
      // Landed: a ring spreads out and leaves the new look inside it.
      const r = (since - fall) * grow;
      if (Math.abs(dx) > r + soft * 2) continue;
      const dist = Math.hypot(dx, py - d.y);
      k = Math.max(k, smoothstep(dist, dist + soft, r));
      const ring = Math.exp(-(((r - dist - soft * 0.5) / soft) ** 2)) * Math.max(0, 1 - r * 2.2);
      light = Math.max(light, ring);
    }
    // Whatever the rain missed fills in at the end.
    k = Math.max(k, smoothstep(0.82, 1, progress));
    light *= params.shine * Math.min(1, (1 - progress) * 10);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const v = a[j + c] + (b[j + c] - a[j + c]) * k;
      out[j + c] = v + (water[c] - v) * light;
    }
  }
}
