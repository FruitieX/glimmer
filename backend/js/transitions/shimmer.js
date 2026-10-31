export const meta = {
  name: "Heat haze",
  description: "A crossfade seen through rising heat: the pictures waver and the new look seeps in unevenly.",
  params: {
    strength: { type: "number", label: "Waver", min: 0, max: 1, step: 0.01, default: 0.6 },
    patchiness: { type: "number", label: "Patchiness", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
};

export function setup(ctx) {
  const { n, x, y, u } = ctx;
  const s = sampler(ctx);
  // Where the new look seeps in first.
  const local = new Float32Array(n);
  for (let i = 0; i < n; i++) local[i] = clamp(noise((s.line ? u[i] : x[i]) * 3, (s.line ? 0.5 : y[i]) * 3, 5.5) * 1.4, -1, 1);
  return { s, local, rgb: [0, 0, 0], rgb2: [0, 0, 0] };
}

export function render(ctx, st) {
  const { n, x, y, u, a, b, out, progress, params, t } = ctx;
  const { s, rgb, rgb2 } = st;
  const env = Math.sin(PI * progress);
  // Wavers by up to about two LEDs.
  const amp = params.strength * env * 2;
  const patch = params.patchiness * 0.5;
  for (let i = 0; i < n; i++) {
    const px = s.line ? u[i] : x[i];
    const py = s.line ? 0.5 : y[i];
    // Heat rises: the pattern drifts upwards (or along the wire).
    const fx = px * 5,
      fy = py * 5 - t * 1.6;
    const wx = noise(fx, fy, 0.3) * amp;
    const wy = noise(fx + 7.1, fy, 2.9) * amp * 1.5;
    if (s.line) {
      s.along(a, u[i] + wx * s.su, rgb);
      s.along(b, u[i] + wx * s.su, rgb2);
    } else {
      s.at(a, px + wx * s.sx, py + wy * s.sy, rgb);
      s.at(b, px + wx * s.sx, py + wy * s.sy, rgb2);
    }
    const m = smoothstep(0, 1, progress * (1 + 2 * patch) - patch + st.local[i] * patch);
    // The hot air glimmers slightly.
    const lift = 1 + 0.06 * wy;
    const j = i * 3;
    for (let c = 0; c < 3; c++) out[j + c] = (rgb[c] + (rgb2[c] - rgb[c]) * m) * lift;
  }
}
