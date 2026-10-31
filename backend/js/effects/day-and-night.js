export const meta = {
  name: "Day and Night",
  description: "A sped-up day: dawn glow, the sun arcing across a blue sky, sunset, then stars.",
  category: "Nature",
  colors: [
    { id: "day", label: "Day sky", default: "#2f86f0" },
    { id: "dusk", label: "Dawn and dusk", default: "#ff6a2b" },
    { id: "night", label: "Night sky", default: "#040824" },
    { id: "sun", label: "Sun", default: "#fff2b0" },
  ],
  params: {
    length: { type: "number", label: "Day length", min: 10, max: 600, step: 5, unit: "s", default: 90 },
    sun: { type: "number", label: "Sun size", min: 0.04, max: 0.2, step: 0.01, default: 0.09 },
    stars: { type: "number", label: "Stars", min: 0, max: 0.5, step: 0.01, default: 0.12 },
    glow: { type: "number", label: "Sunrise glow", min: 0, max: 1, step: 0.01, default: 0.7 },
  },
};

export function loop(params) {
  return params.length;
}

export function setup(ctx) {
  const { n, y } = ctx;
  let flat = true;
  for (let i = 1; i < n; i++) if (Math.abs(y[i] - y[0]) > 1e-4) flat = false;
  return { flat };
}

export function render(ctx, s) {
  const { n, x, y, out, params, colors, t, spacing, aspect } = ctx;
  const day = colors[0] || [0.18, 0.53, 0.94];
  const dusk = colors[1] || [1, 0.42, 0.17];
  const night = colors[2] || [0.02, 0.03, 0.14];
  const sunC = colors[3] || [1, 0.95, 0.69];
  const asp = s.flat ? 1 : clamp(aspect || 1, 0.3, 3);
  const phase = fract(t / params.length);
  // Sunrise at a quarter of the way through, sunset at three quarters.
  const th = TAU * (phase - 0.25);
  const el = Math.sin(th);
  const sx = 0.5 - 0.45 * Math.cos(th);
  const sy = -0.12 + 0.85 * el;
  const daylight = smoothstep(-0.2, 0.35, el);
  const twilight = Math.exp(-el * el * 8) * params.glow;
  const starK = smoothstep(-0.05, -0.3, el);
  const sunCol = mix(dusk, sunC, smoothstep(-0.05, 0.45, el));
  const R = params.sun;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = s.flat ? 0.4 : y[i];
    // Sky: dark night or blue day, paler near the horizon by day.
    const hz = 1 - yi;
    let r = night[0] + (day[0] * (1 - 0.35 * hz) + 0.35 * hz * 0.8 - night[0]) * daylight;
    let g = night[1] + (day[1] * (1 - 0.35 * hz) + 0.35 * hz * 0.85 - night[1]) * daylight;
    let b = night[2] + (day[2] * (1 - 0.25 * hz) + 0.25 * hz * 1 - night[2]) * daylight;
    // Dawn and dusk: a warm glow low in the sky, strongest on the sun's side.
    const side = Math.exp(-(xi - sx) * (xi - sx) * 2.5);
    const gk = clamp(twilight * (0.35 + 0.65 * side) * Math.pow(Math.max(0, hz), 1.6) * 1.2);
    r += (dusk[0] - r) * gk;
    g += (dusk[1] - g) * gk;
    b += (dusk[2] - b) * gk;
    // Stars come out at night, twinkling a whole number of times per day.
    if (starK > 0 && hash(i, 9) < params.stars) {
      const tw = 0.6 + 0.4 * Math.sin(TAU * (phase * 40 + hash(i, 10)));
      const k = starK * tw * (0.5 + 0.5 * hash(i, 11)) * smoothstep(0.05, 0.4, yi);
      r += (1 - r) * k;
      g += (1 - g) * k;
      b += (0.9 - b) * k;
    }
    // The sun with a soft halo.
    const dx = (xi - sx) * asp, dy = s.flat ? 0 : yi - sy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const soft = spacing * 1.2;
    const disc = smoothstep(R + soft, R - soft * 0.5, d) * smoothstep(-0.25, 0, el);
    const halo = 0.4 * Math.exp(-d / (R * 1.8)) * smoothstep(-0.2, 0, el);
    const sk = clamp(disc + halo);
    r += (sunCol[0] - r) * sk;
    g += (sunCol[1] - g) * sk;
    b += (sunCol[2] - b) * sk;
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}
