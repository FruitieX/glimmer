export const meta = {
  name: "Water drop",
  description: "A drop falls in the middle; rings ripple outwards, bending the picture, and the new look spreads behind them.",
  params: {
    cx: { type: "number", label: "Centre (horizontal)", min: 0, max: 1, step: 0.01, default: 0.5 },
    cy: { type: "number", label: "Centre (vertical)", min: 0, max: 1, step: 0.01, default: 0.5 },
    rings: { type: "number", label: "Rings", min: 1, max: 6, step: 1, default: 3 },
    strength: { type: "number", label: "Ripple strength", min: 0, max: 1, step: 0.01, default: 0.6 },
  },
};

export function setup(ctx) {
  const { n, x, y, u, aspect, params } = ctx;
  const s = sampler(ctx);
  const d = new Float32Array(n);
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    d[i] = s.line ? Math.abs(u[i] - params.cx) : Math.hypot((x[i] - params.cx) * aspect, y[i] - params.cy);
    max = Math.max(max, d[i]);
  }
  // Unit vectors pointing away from the centre, in 0..1 coordinates.
  const dx = new Float32Array(n),
    dy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ex = s.line ? u[i] - params.cx : (x[i] - params.cx) * aspect;
    const ey = s.line ? 0 : y[i] - params.cy;
    const l = Math.hypot(ex, ey) || 1;
    dx[i] = ex / l / (s.line ? 1 : aspect);
    dy[i] = ey / l;
    d[i] /= max;
  }
  return { s, d, dx, dy, scale: max, rgb: [0, 0, 0], rgb2: [0, 0, 0] };
}

export function render(ctx, st) {
  const { n, x, y, u, a, b, out, progress, params } = ctx;
  const { s, d, rgb, rgb2 } = st;
  const wave = 0.25;
  const front = ease.out(progress) * (1 + wave);
  const amp = params.strength * Math.sin(PI * progress);
  const rings = Math.round(params.rings);
  // Shift by up to about one and a half LEDs.
  const gap = s.line ? s.su : Math.max(s.sx, s.sy);
  for (let i = 0; i < n; i++) {
    const behind = front - d[i];
    // Rings live just behind the front and die out further back.
    const shape = behind > -0.08 ? Math.exp(-Math.max(0, behind) * 4) * smoothstep(-0.08, 0, behind) : 0;
    const h = Math.sin(behind * rings * 2 * PI * 3.2) * shape * amp;
    const k = smoothstep(0, wave, behind);
    const off = h * gap * 1.5;
    if (s.line) {
      s.along(a, u[i] - st.dx[i] * off, rgb);
      s.along(b, u[i] - st.dx[i] * off, rgb2);
    } else {
      s.at(a, x[i] - st.dx[i] * off, y[i] - st.dy[i] * off, rgb);
      s.at(b, x[i] - st.dx[i] * off, y[i] - st.dy[i] * off, rgb2);
    }
    // Crests catch the light.
    const light = Math.max(0, h) * 0.45;
    const j = i * 3;
    for (let c = 0; c < 3; c++) {
      const v = rgb[c] + (rgb2[c] - rgb[c]) * k;
      out[j + c] = v + (1 - v) * light;
    }
  }
}
