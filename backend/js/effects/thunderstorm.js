export const meta = {
  name: "Thunderstorm",
  description: "Heavy clouds rolling past, lit from within by lightning and the odd bolt to the ground.",
  category: "Nature",
  colors: [
    { id: "flash", label: "Lightning", default: "#dfe8ff" },
    { id: "clouds", label: "Clouds", default: "#46526e" },
    { id: "night", label: "Night", default: "#05070d" },
  ],
  params: {
    strikes: { type: "number", label: "Strikes per minute", min: 2, max: 40, step: 1, default: 12 },
    flash: { type: "number", label: "Flash brightness", min: 0.1, max: 1, step: 0.01, default: 0.75 },
    bolts: { type: "number", label: "Bolts to ground", min: 0, max: 1, step: 0.01, default: 0.4 },
    wind: { type: "number", label: "Cloud speed", min: 0, max: 1, step: 0.01, default: 0.3 },
  },
  looks: [
    { name: "Distant", params: { strikes: 4, flash: 0.4, bolts: 0.1 }, colors: ["#c8d0ff", "#30385a", "#03040a"] },
    { name: "Supercell", params: { strikes: 30, flash: 1, bolts: 0.8, wind: 0.7 }, colors: ["#ffffff", "#3a4a7a", "#04060e"] },
    { name: "Violet", params: {}, colors: ["#e0b0ff", "#4a2a7a", "#06020e"] },
    { name: "Eerie", params: { strikes: 18 }, colors: ["#e0ffb0", "#2a5a3a", "#020804"] },
  ],
};

// Time is cut into slots, each holding at most one strike; SLOTS slots make a loop.
const SLOTS = 24;

export function loop(params) {
  return SLOTS * (60 / params.strikes);
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
  const { n, x, y, spacing } = ctx;
  const gx = gapOf(x, n, spacing), gy = gapOf(y, n, spacing);
  return { flat: gy === 0, gx: gx || spacing };
}

// Brightness of a strike `age` seconds after it starts: a few quick
// flickers, each fading out rather than blinking off.
function pulses(seed, age) {
  if (age < 0 || age > 1.2) return 0;
  const count = 2 + Math.floor(hash(seed, 11) * 3);
  let v = 0;
  for (let k = 0; k < count; k++) {
    const at = k * (0.09 + 0.12 * hash(seed, 20 + k));
    const a = age - at;
    if (a < 0) continue;
    const peak = k === 0 ? 0.7 : 0.5 + 0.5 * hash(seed, 30 + k);
    v = Math.max(v, peak * Math.min(1, a / 0.06) * Math.exp(-a * 9));
  }
  return v;
}

// Horizontal position of a bolt at height h: a jagged line from the cloud down.
function boltX(seed, x0, h, top) {
  const seg = 0.09;
  const f = (top - h) / seg;
  const k = Math.floor(f);
  let p = x0;
  for (let j = 1; j <= k; j++) p += (hash(seed * 7 + j, 40) - 0.5) * 0.26;
  const next = (hash(seed * 7 + k + 1, 40) - 0.5) * 0.26;
  return p + next * (f - k);
}

export function render(ctx, s) {
  const { n, x, y, out, params, colors, t } = ctx;
  const flashC = colors[0] || [0.87, 0.91, 1];
  const cloudC = colors[1] || [0.23, 0.27, 0.38];
  const night = colors[2] || [0.02, 0.03, 0.05];
  const slot = 60 / params.strikes;
  const L = SLOTS * slot;
  const tt = ((t % L) + L) % L;
  const si = Math.floor(tt / slot);
  // The current and previous slot's strikes can both still be glowing.
  const strikes = [];
  for (let d = -1; d <= 0; d++) {
    const k = (si + d + SLOTS) % SLOTS;
    const start = (si + d) * slot + 0.1 * slot + hash(k, 1) * 0.6 * slot;
    const age = tt - start;
    const e = pulses(k, age) * params.flash;
    if (e <= 0.002) continue;
    strikes.push({
      e,
      x: 0.15 + 0.7 * hash(k, 2),
      y: 0.62 + 0.25 * hash(k, 3),
      r: 0.25 + 0.2 * hash(k, 4),
      bolt: hash(k, 5) < params.bolts,
      seed: k,
    });
  }
  // Clouds drift sideways: noise is sampled on a cylinder (x wraps around a
  // circle), which turns a whole number of times per loop.
  const turns = Math.round(params.wind * 10);
  const ph = (TAU * tt) / L;
  const R = 1.2;
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = s.flat ? 0.75 : y[i];
    const a = xi * 2.2 - ph * turns;
    const nn =
      noise(Math.cos(a) * R, yi * 3 + Math.sin(ph) * 0.3, Math.sin(a) * R) * 0.8 +
      0.12 * Math.sin(a * 6 + yi * 7 + Math.cos(ph) * 2);
    // Thick cloud up high, thinning towards the ground.
    const dens = clamp((0.45 + nn) * smoothstep(0.1, 0.65, yi) + 0.05);
    let r = night[0] + (cloudC[0] - night[0]) * dens;
    let g = night[1] + (cloudC[1] - night[1]) * dens;
    let b = night[2] + (cloudC[2] - night[2]) * dens;
    let light = 0, bolt = 0;
    for (const st of strikes) {
      // Light inside the cloud around the strike.
      const dx = (xi - st.x) / st.r, dy = (yi - st.y) / (st.r * 0.8);
      const d = s.flat ? dx * dx : dx * dx + dy * dy;
      light += st.e * Math.exp(-d * 1.4) * (0.5 + dens * 1.1);
      if (st.bolt && !s.flat && yi < st.y) {
        const bx = boltX(st.seed, st.x, yi, st.y);
        const w = Math.abs(xi - bx) / (s.gx * 0.9);
        if (w < 1) bolt = Math.max(bolt, st.e * 1.4 * (1 - w * w));
      }
    }
    const k = clamp(light + bolt);
    r += (flashC[0] - r) * k;
    g += (flashC[1] - g) * k;
    b += (flashC[2] - b) * k;
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
}
