export const meta = {
  name: "Bubbles",
  description: "Bubbles wobbling up through deep water and popping near the surface.",
  category: "Particles & physics",
  colors: [
    { id: "water", label: "Water", default: "#022b4a" },
    { id: "bubble", label: "Bubbles", default: "#8fe3ff" },
    { id: "rim", label: "Rim", default: "#ffffff" },
  ],
  params: {
    bubbles: { type: "number", label: "Bubbles", min: 1, max: 24, step: 1, default: 9 },
    speed: { type: "number", label: "Rise speed", min: 0.03, max: 0.5, step: 0.01, default: 0.12 },
    size: { type: "number", label: "Bubble size", min: 0.05, max: 0.3, step: 0.01, default: 0.13 },
    wobble: { type: "number", label: "Wobble", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
};

// Every bubble rises a whole number of times per loop.
const CYCLES = 6;

export function loop(params) {
  return CYCLES / params.speed;
}

function gapOf(a, n, spacing) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.round(a[i] * 500);
  v.sort();
  let d = 0;
  for (let i = 1; i < n; i++) if (v[i] !== v[i - 1]) d++;
  return d === 0 ? 0 : Math.max(spacing, 1 / d);
}

export function setup(ctx) {
  const { n, x, y, spacing, aspect } = ctx;
  const gx = gapOf(x, n, spacing), gy = gapOf(y, n, spacing);
  const flat = gy === 0;
  // On a straight string the bubbles rise along it.
  const hx = new Float32Array(n), vy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hx[i] = flat ? 0.5 : x[i];
    vy[i] = flat ? x[i] : y[i];
  }
  return {
    flat, hx, vy,
    gx: flat ? 0 : gx,
    gy: flat ? gx : gy,
    asp: flat ? 1 : clamp(aspect || 1, 0.3, 3),
  };
}

export function render(ctx, s) {
  const { n, out, params, colors, t } = ctx;
  const water = colors[0] || [0.01, 0.17, 0.29];
  const body = colors[1] || [0.56, 0.89, 1];
  const rim = colors[2] || [1, 1, 1];
  const { hx, vy } = s;
  // Shimmer noise sampled on a circle, so it loops with the bubbles.
  const la = (TAU * t * params.speed) / CYCLES;
  const cz = Math.cos(la) * 1.5, sz = Math.sin(la) * 1.5;
  // Water: a gentle vertical gradient with slow caustic shimmer.
  for (let i = 0; i < n; i++) {
    const k = 0.3 + 0.55 * vy[i] + 0.12 * noise(hx[i] * 3 + cz, vy[i] * 2, sz);
    out[i * 3] = water[0] * k;
    out[i * 3 + 1] = water[1] * k;
    out[i * 3 + 2] = water[2] * k;
  }
  const count = Math.round(params.bubbles);
  for (let b = 0; b < count; b++) {
    const turns = CYCLES + (b % 5) - 2;
    const q = (t * params.speed * turns) / CYCLES + hash(b, 1);
    const cyc = Math.floor(q) % turns;
    const p = fract(q);
    const seed = b * 31 + cyc;
    // Bubbles pop somewhere near the top.
    const top = 0.85 + 0.25 * hash(seed, 2);
    const h = -0.35 + p * 1.55;
    if (h > top + 0.05) continue;
    const pop = smoothstep(top + 0.05, top - 0.03, h);
    const r0 = params.size * (0.6 + 0.5 * hash(seed, 3)) * (0.8 + 0.3 * p);
    const wob = Math.sin(TAU * (p * 3 + hash(seed, 4)));
    const cx = 0.1 + 0.8 * hash(seed, 5) + wob * params.wobble * 0.06;
    // The bubble squashes and stretches a little as it wobbles.
    const st = 1 + wob * params.wobble * 0.12;
    const ry = r0 * st + s.gy * 0.5;
    const rx = (r0 / st) / s.asp + s.gx * 0.5;
    const iry = 1 / ry, irx = s.flat ? 0 : 1 / rx;
    // Soft edge a LED or so wide (wider on a string, where bubbles glide along it).
    const soft = Math.min(0.9, Math.max(s.gx * irx, s.gy * iry) * (s.flat ? 3 : 1));
    for (let i = 0; i < n; i++) {
      const dy = (vy[i] - h) * iry;
      if (dy > 1 || dy < -1) continue;
      const dx = (hx[i] - cx) * irx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const edge = smoothstep(1, 1 - soft, d);
      // A thin film: faint inside, brighter towards the rim.
      const ringK = smoothstep(0.2, 0.85, d);
      const k = edge * (0.25 + 0.75 * ringK) * pop;
      const c = ringK > 0.6 ? rim : body;
      const m = Math.min(1, k * 1.15);
      const o = i * 3;
      out[o] += (c[0] * 0.5 + body[0] * 0.5 - out[o]) * m;
      out[o + 1] += (c[1] * 0.5 + body[1] * 0.5 - out[o + 1]) * m;
      out[o + 2] += (c[2] * 0.5 + body[2] * 0.5 - out[o + 2]) * m;
    }
  }
}
