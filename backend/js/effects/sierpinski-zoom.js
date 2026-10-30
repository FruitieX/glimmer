export const meta = {
  name: "Sierpinski Zoom",
  description: "An endless zoom into the Sierpinski triangle or carpet, where every corner hides smaller copies of the whole.",
  category: "Fractals",
  antialias: true,
  colors: [
    { id: "lattice", label: "Lattice", default: "#ffc96b" },
    { id: "a", label: "Large holes", default: "#1a2290" },
    { id: "b", label: "Small holes", default: "#d4246e" },
    { id: "background", label: "Background", default: "#020206" },
  ],
  params: {
    shape: { type: "select", label: "Shape", options: ["triangle", "carpet"], labels: ["Triangle", "Carpet"], default: "triangle" },
    speed: { type: "number", label: "Zoom speed", min: 0.02, max: 0.5, step: 0.01, default: 0.12 },
    glow: { type: "number", label: "Lattice brightness", min: 0, max: 1, step: 0.01, default: 0.65 },
  },
};

// One loop zooms in by the shape's own scale factor (2 or 3), after which
// the picture is exactly the same again.
export function loop(params) {
  return 1 / params.speed;
}

const H3 = Math.sqrt(3) / 2;
const K = 7;

// Triangle: depth of the hole containing (px, py), K if in the set, -1 outside.
function triDepth(px, py) {
  let v = py / H3, u = px - 0.5 * v;
  if (u < 0 || v < 0 || u + v > 1) return -1;
  for (let k = 0; k < K; k++) {
    u *= 2; v *= 2;
    if (u >= 1) u -= 1;
    else if (v >= 1) v -= 1;
    else if (u + v > 1) return k;
  }
  return K;
}

// Carpet: depth of the square hole containing (px, py).
function carpetDepth(px, py) {
  if (px < 0 || py < 0 || px > 1 || py > 1) return -1;
  for (let k = 0; k < K; k++) {
    px *= 3; py *= 3;
    const ix = px >= 2 ? 2 : px | 0, iy = py >= 2 ? 2 : py | 0;
    if (ix === 1 && iy === 1) return k;
    px -= ix; py -= iy;
  }
  return K;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const carpet = params.shape === "carpet";
  const ph = fract(t * params.speed);
  const f = carpet ? 3 : 2;
  // Zoom towards a point that one of the shape's smaller copies maps onto
  // itself (the triangle's apex, the carpet's bottom middle); the view starts
  // out showing exactly that copy, so after one loop the picture repeats.
  const S = (carpet ? 1 / 3 : 0.45) * Math.pow(f, -ph);
  const zx = 0.5, zy = carpet ? 0 : H3;
  const yOff = carpet ? 0.5 : -0.45;
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i += Math.max(1, (n / 16) | 0)) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const line = hi - lo < 0.02;
  const sx = line || aspect >= 1 ? 1 : aspect, sy = line ? 0 : aspect >= 1 ? 1 / aspect : 1;
  const lat = colors[0] || [1, 0.9, 0.7];
  const pal = [colors[1] || [0.3, 0.1, 0.6], colors[2] || [0.05, 0.7, 0.65]];
  const bg = colors[3] || [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const X = (x[i] - 0.5) * sx, Y = (line ? (carpet ? -0.1 : -0.25) : (y[i] - 0.5) * sy) + yOff;
    const px = zx + X * S, py = zy + Y * S;
    const d = carpet ? carpetDepth(px, py) : triDepth(px, py);
    const o = i * 3;
    if (d < 0) { out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; continue; }
    // Colour follows a hole's size on screen (depth minus zoom phase), so the
    // loop is seamless; the tiniest holes blend into the lattice.
    const e = d - ph;
    const deep = clamp((K - 1 - e) / 3);
    const c = palette(pal, clamp((e - 0.5) / 3.5));
    const holeK = (0.2 + 0.55 * clamp(1 - (e - 0.5) / 5)) * deep;
    const latK = params.glow * (1 - deep) * (carpet ? 0.5 : 1);
    for (let ch = 0; ch < 3; ch++) out[o + ch] = bg[ch] + c[ch] * holeK + lat[ch] * latK;
  }
}
