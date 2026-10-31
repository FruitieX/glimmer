export const meta = {
  name: "Melt",
  description: "The old look melts and drips down in uneven runs, uncovering the new one from the top.",
  params: {
    drips: { type: "number", label: "Unevenness", min: 0, max: 1, step: 0.01, default: 0.6 },
    glow: { type: "number", label: "Glowing drips", min: 0, max: 1, step: 0.01, default: 0.4 },
  },
};

export function setup(ctx) {
  const { n, x, u } = ctx;
  const s = sampler(ctx);
  // How much faster each column runs; columns close together run alike.
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = s.line ? u[i] : x[i];
    const f = s.line ? 3 : 1 / Math.max(0.02, s.sx);
    speed[i] = clamp(0.5 + 0.6 * noise(at * f * 0.9, 0.37) + 0.3 * noise(at * f * 0.31, 2.1));
  }
  return { s, speed, rgb: [0, 0, 0] };
}

export function render(ctx, st) {
  const { n, x, y, u, a, b, out, progress, params } = ctx;
  const { s, speed, rgb } = st;
  // Falls slowly at first, then faster.
  const p = ease.in(progress);
  const soft = Math.max(0.04, (s.line ? s.su : s.sy) * 1.5);
  for (let i = 0; i < n; i++) {
    // Height on a curtain; a line melts towards its start.
    const h = s.line ? u[i] : y[i];
    const drop = p * (1 + soft) * (1 + params.drips * speed[i]);
    const top = 1 - drop;
    const k = smoothstep(top, top + soft, h);
    const src = Math.min(1, h + drop);
    if (s.line) s.along(a, src, rgb);
    else s.at(a, x[i], src, rgb);
    // The leading drips glow with the old colours, a bit brighter.
    const tip = params.glow * Math.sin(PI * progress) * Math.exp(-(((top - h) / (soft * 2)) ** 2)) * (1 - k);
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const v = rgb[c] + (1 - rgb[c]) * tip * 0.6;
      out[j + c] = v + (b[j + c] - v) * k;
    }
  }
}
