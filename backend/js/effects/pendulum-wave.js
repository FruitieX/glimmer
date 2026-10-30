export const meta = {
  name: "Pendulum Wave",
  description: "A row of pendulums of slowly changing length drifting in and out of step.",
  category: "Particles & physics",
  colors: [
    { id: "a", label: "First", default: "#ff4f79" },
    { id: "b", label: "Middle", default: "#ffb238" },
    { id: "c", label: "Last", default: "#38c6ff" },
    { id: "background", label: "Background", default: "#05040c" },
  ],
  params: {
    pendulums: { type: "number", label: "Pendulums", min: 4, max: 24, step: 1, default: 10 },
    cycle: { type: "number", label: "Pattern length", min: 15, max: 120, step: 1, unit: "s", default: 40 },
    swing: { type: "number", label: "Swing", min: 0.1, max: 1, step: 0.01, default: 0.8 },
    trail: { type: "number", label: "Trail", min: 0, max: 1, step: 0.01, default: 0.4 },
  },
};

// The slowest pendulum swings BASE times per pattern, the next one BASE + 1, ...
const BASE = 18;

export function loop(params) {
  return params.cycle;
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
  return { flat: gy === 0, gx, gy, lanesFor: 0, lanes: [] };
}

// The LEDs close enough to each pendulum's lane to show its bob.
function lanes(s, x, n, N, rx) {
  if (s.lanesFor === N) return s.lanes;
  s.lanes = [];
  for (let k = 0; k < N; k++) {
    const bx = N > 1 ? k / (N - 1) : 0.5;
    const ids = [];
    for (let i = 0; i < n; i++) if (Math.abs(x[i] - bx) < rx) ids.push(i);
    s.lanes.push(Int32Array.from(ids));
  }
  s.lanesFor = N;
  return s.lanes;
}

export function render(ctx, s) {
  const { n, x, y, out, params, colors, t } = ctx;
  const bg = colors[3] || [0.02, 0.02, 0.05];
  const pal = [colors[0] || [1, 0.31, 0.47], colors[1] || [1, 0.7, 0.22], colors[2] || [0.22, 0.78, 1]];
  const N = Math.round(params.pendulums);
  const amp = params.swing * 0.4;
  const trail = params.trail;
  for (let i = 0; i < n; i++) out.set(bg, i * 3);
  if (s.flat) {
    // Straight string: each pendulum gets its own stretch and swings within it.
    const lane = 1 / N;
    const r = Math.max(s.gx * 1.6, lane * 0.18);
    for (let i = 0; i < n; i++) {
      const k = Math.min(N - 1, Math.floor(x[i] * N));
      const ph = TAU * (BASE + k) * (t / params.cycle);
      const bx = (k + 0.5) * lane + Math.sin(ph) * amp * lane;
      const v = Math.cos(ph) * amp * lane; // bob speed direction, for the trail
      const d = (x[i] - bx) / r;
      let w = d * d < 1 ? (1 - d * d) * (1 - d * d) : 0;
      // A faint smear behind the moving bob.
      const behind = (bx - x[i]) * Math.sign(v);
      if (behind > 0 && behind < lane * 0.5) w = Math.max(w, trail * 0.35 * (1 - behind / (lane * 0.5)) * Math.min(1, Math.abs(v) / (amp * lane + 1e-6)));
      const c = palette(pal, N > 1 ? k / (N - 1) : 0);
      const o = i * 3;
      out[o] += (c[0] - out[o]) * w;
      out[o + 1] += (c[1] - out[o + 1]) * w;
      out[o + 2] += (c[2] - out[o + 2]) * w;
    }
    return;
  }
  // Curtain: pendulums side by side, seen from the end, bobs moving up and down.
  const lane = N > 1 ? 1 / (N - 1) : 1;
  const rx = Math.max(s.gx, lane) * 0.95;
  const ry = Math.max(s.gy * 1.6, 0.06);
  const near = lanes(s, x, n, N, rx);
  for (let k = 0; k < N; k++) {
    const ids = near[k];
    const bx = N > 1 ? k / (N - 1) : 0.5;
    const c = palette(pal, N > 1 ? k / (N - 1) : 0);
    for (let j = 0; j < 4; j++) {
      // The bob plus a few fading echoes of where it just was.
      const lag = j * 0.06;
      const a = j === 0 ? 1 : trail * (0.5 - j * 0.12);
      if (a <= 0) continue;
      const ph = TAU * (BASE + k) * ((t - lag) / params.cycle);
      const by = 0.5 + Math.sin(ph) * amp;
      for (let m = 0; m < ids.length; m++) {
        const i = ids[m];
        const dx = (x[i] - bx) / rx;
        const dy = (y[i] - by) / ry;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const w = (1 - d) * (1 - d) * a;
        const o = i * 3;
        out[o] = Math.max(out[o], bg[0] + (c[0] - bg[0]) * w);
        out[o + 1] = Math.max(out[o + 1], bg[1] + (c[1] - bg[1]) * w);
        out[o + 2] = Math.max(out[o + 2], bg[2] + (c[2] - bg[2]) * w);
      }
    }
  }
}
