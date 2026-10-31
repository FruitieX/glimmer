export const meta = {
  name: "Sierpinski Zoom",
  description: "An endless zoom into the Sierpinski triangle or carpet, where every corner hides smaller copies of the whole.",
  category: "Fractals",
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
  looks: [
    { name: "Ice carpet", params: { shape: "carpet", glow: 1 }, colors: ["#20a0ff", "#e0f8ff", "#6040ff", "#020612"] },
    { name: "Neon", params: { speed: 0.25 }, colors: ["#00ff9c", "#a000ff", "#ff0080", "#030008"] },
    { name: "Ember", params: { glow: 0.8 }, colors: ["#ffd060", "#c01000", "#ff6a00", "#0a0200"] },
    { name: "Jade", params: { shape: "carpet", speed: 0.06, glow: 1 }, colors: ["#00ff80", "#00a0ff", "#c0ff40", "#010604"] },
  ],
};

// One loop zooms in by the shape's own scale factor (2 or 3), after which
// the picture is exactly the same again.
export function loop(params) {
  return 1 / params.speed;
}

const H3 = Math.sqrt(3) / 2;
const K = 7;

// What the last lookup found (kept in variables so nothing is allocated per
// LED): the depth of the hole containing the point (K in the set, -1 outside
// the shape), its distance to that region's edge and the hole's size, and
// every hole the point lies just outside of (-1: the shape's outline), with
// how much of its colour spills onto this LED. Distances are in shape units.
let qDepth = 0, qIn = 0, qR = 0, qN = 0, qHw = 0;
const nearDepth = new Int8Array(K + 1);
const nearW = new Float32Array(K + 1);

function near(depth, d, r) {
  if (d >= qHw) return;
  nearDepth[qN] = depth;
  nearW[qN] = smoothstep(qHw, -qHw, d) * Math.min(1, (r * r) / (qHw * qHw));
  qN++;
}

function triDepth(px, py) {
  let v = py / H3, u = px - 0.5 * v;
  // World distance per unit of the triangle's own coordinates at this level.
  let sc = H3;
  qN = 0;
  const outside = Math.max(-u, -v, u + v - 1);
  if (outside > 0) {
    qDepth = -1;
    qIn = outside * sc;
    qR = 1e9;
    return;
  }
  near(-1, Math.min(u, v, 1 - u - v) * sc, 1e9);
  for (let k = 0; k < K; k++) {
    u *= 2;
    v *= 2;
    sc *= 0.5;
    let d;
    if (u >= 1) {
      u -= 1;
      d = u * sc;
    } else if (v >= 1) {
      v -= 1;
      d = v * sc;
    } else if (u + v > 1) {
      qDepth = k;
      qIn = Math.min(1 - u, 1 - v, u + v - 1) * sc;
      qR = sc / 3;
      return;
    } else d = (1 - u - v) * sc;
    near(k, d, sc / 3);
  }
  qDepth = K;
}

function carpetDepth(px, py) {
  qN = 0;
  const outside = Math.max(-px, -py, px - 1, py - 1);
  if (outside > 0) {
    qDepth = -1;
    qIn = outside;
    qR = 1e9;
    return;
  }
  near(-1, Math.min(px, py, 1 - px, 1 - py), 1e9);
  let sc = 1;
  for (let k = 0; k < K; k++) {
    px *= 3;
    py *= 3;
    sc /= 3;
    const ix = px >= 2 ? 2 : px | 0, iy = py >= 2 ? 2 : py | 0;
    if (ix === 1 && iy === 1) {
      qDepth = k;
      qIn = Math.min(px - 1, 2 - px, py - 1, 2 - py) * sc;
      qR = sc * 0.5;
      return;
    }
    const ex = px < 1 ? 1 - px : px > 2 ? px - 2 : 0;
    const ey = py < 1 ? 1 - py : py > 2 ? py - 2 : 0;
    const d = Math.max(ex, ey) * sc;
    near(k, d, sc * 0.5);
    px -= ix;
    py -= iy;
  }
  qDepth = K;
}

// Colour of a region of depth d, into cr/cg/cb.
let cr = 0, cg = 0, cb = 0;
function shade(d, ph, lat, p0, p1, bg, latGlow) {
  if (d < 0) {
    cr = bg[0];
    cg = bg[1];
    cb = bg[2];
    return;
  }
  // Colour follows a hole's size on screen (depth minus zoom phase), so the
  // loop is seamless; the tiniest holes blend into the lattice.
  const e = d - ph;
  const deep = clamp((K - 1 - e) / 3);
  const m = clamp((e - 0.5) / 3.5);
  const holeK = (0.2 + 0.55 * clamp(1 - (e - 0.5) / 5)) * deep;
  const latK = latGlow * (1 - deep);
  cr = bg[0] + (p0[0] + (p1[0] - p0[0]) * m) * holeK + lat[0] * latK;
  cg = bg[1] + (p0[1] + (p1[1] - p0[1]) * m) * holeK + lat[1] * latK;
  cb = bg[2] + (p0[2] + (p1[2] - p0[2]) * m) * holeK + lat[2] * latK;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect, spacing } = ctx;
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
  const p0 = colors[1] || [0.3, 0.1, 0.6];
  const p1 = colors[2] || [0.05, 0.7, 0.65];
  const bg = colors[3] || [0, 0, 0];
  const latGlow = params.glow * (carpet ? 0.5 : 1);
  // Edges fade over about one LED: half that, in shape units.
  const hw = 0.5 * spacing * Math.max(sx, sy) * S;
  qHw = hw;
  const lr = lat[0] * latGlow + bg[0], lg = lat[1] * latGlow + bg[1], lb = lat[2] * latGlow + bg[2];
  for (let i = 0; i < n; i++) {
    const X = (x[i] - 0.5) * sx, Y = (line ? (carpet ? -0.1 : -0.25) : (y[i] - 0.5) * sy) + yOff;
    const px = zx + X * S, py = zy + Y * S;
    if (carpet) carpetDepth(px, py);
    else triDepth(px, py);
    shade(qDepth, ph, lat, p0, p1, bg, latGlow);
    let r = cr, g = cg, b = cb;
    if (qDepth < K && qIn < hw) {
      // Near the edge of a hole (or of the shape): fade towards the lattice
      // beyond it; a hole smaller than an LED only tints it a little.
      const cover = smoothstep(-hw, hw, qIn) * Math.min(1, (qR * qR) / (hw * hw));
      r = lr + (r - lr) * cover;
      g = lg + (g - lg) * cover;
      b = lb + (b - lb) * cover;
    }
    // Just outside holes (or inside the outline): take on some of their colour.
    for (let j = 0; j < qN; j++) {
      const w = nearW[j];
      shade(nearDepth[j], ph, lat, p0, p1, bg, latGlow);
      r += (cr - r) * w;
      g += (cg - g) * w;
      b += (cb - b) * w;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
