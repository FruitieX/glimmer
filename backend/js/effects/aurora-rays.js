export const meta = {
  name: "Aurora Rays",
  description: "Folded curtains of northern-light rays with pulses of light running along them.",
  category: "Nature",
  colors: [
    { id: "low", label: "Lower edge", default: "#3dff9a" },
    { id: "high", label: "Ray tops", default: "#b14cff" },
    { id: "sky", label: "Night sky", default: "#020612" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 0.6 },
    rays: { type: "number", label: "Rays", min: 2, max: 12, step: 0.5, default: 5 },
    height: { type: "number", label: "Ray length", min: 0.1, max: 1, step: 0.01, default: 0.45 },
    shimmer: { type: "number", label: "Shimmer", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Emerald", params: { speed: 0.4, rays: 7, height: 0.6 }, colors: ["#20ff60", "#20d0a0", "#010a08"] },
    { name: "Crimson", params: { shimmer: 0.8 }, colors: ["#ff3060", "#ff60c0", "#0a0210"] },
    { name: "Polar blue", params: { speed: 0.3, rays: 4 }, colors: ["#40e0ff", "#4060ff", "#01040e"] },
    { name: "Storm", params: { speed: 1.4, rays: 10, shimmer: 0.9 }, colors: ["#60ff40", "#20e0ff", "#020410"] },
  ],
};

// Everything moves at whole multiples of one slow cycle.
const BASE = 60;

export function loop(params) {
  return BASE / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, params, colors, t } = ctx;
  const low = colors[0] || [0.24, 1, 0.6];
  const high = colors[1] || [0.69, 0.3, 1];
  const sky = colors[2] || [0.01, 0.02, 0.07];
  const p = (t * params.speed) / BASE; // cycles of the loop
  const s = TAU * p;
  const len = params.height;
  const rays = params.rays;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    // The curtain's lower edge folds and sways.
    const edge =
      0.22 + 0.1 * Math.sin(TAU * xi * 1.1 + s * 2) + 0.05 * Math.sin(TAU * xi * 2.7 - s * 5 + 1) + 0.03 * Math.sin(s * 3);
    // Vertical rays, bunching up where the curtain folds.
    const warp = 0.35 * Math.sin(TAU * xi * 1.3 + s * 3 + 2) + 0.15 * Math.sin(TAU * xi * 3.1 - s * 4);
    const ray = 0.5 + 0.5 * Math.sin(TAU * (xi * rays + warp) + s * 7);
    const rayK = 0.35 + 0.65 * ray * ray;
    // Pulses of brightness racing sideways along the curtain.
    const pulse = 0.5 + 0.5 * Math.sin(TAU * xi * 2 - s * 23);
    const shim = 1 - params.shimmer * 0.6 * (1 - pulse * pulse);
    // Brightest just above the edge, fading upwards over the ray length.
    const above = y[i] - edge;
    const bottom = smoothstep(-0.07, 0.02, above);
    const fade = above > 0 ? Math.exp(-above / len) : 1;
    // Overall brightness breathes slowly.
    const breathe = 0.75 + 0.25 * Math.sin(s * 2 + xi * 2);
    const k = clamp(bottom * fade * rayK * shim * breathe * 1.15);
    const m = clamp(above / (len * 1.3));
    const r = low[0] + (high[0] - low[0]) * m;
    const g = low[1] + (high[1] - low[1]) * m;
    const b = low[2] + (high[2] - low[2]) * m;
    out[i * 3] = sky[0] + r * k;
    out[i * 3 + 1] = sky[1] + g * k;
    out[i * 3 + 2] = sky[2] + b * k;
  }
}
