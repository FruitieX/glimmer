// Helpers available to every effect and transition as globals.
// Colours are [r, g, b] arrays of perceptual (sRGB-like) values in 0..1.

var PI = Math.PI;
var TAU = Math.PI * 2;

function clamp(v, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}
function fract(v) {
  return v - Math.floor(v);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function smoothstep(e0, e1, v) {
  const t = clamp((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Mixes two colours. */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function scale(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}
/** Hue 0..1 (wraps), saturation and value 0..1. */
function hsv(h, s = 1, v = 1) {
  h = fract(h) * 6;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}
/** Parses "#rrggbb". */
function hex(s) {
  const n = parseInt(String(s).replace("#", ""), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** Samples a gradient through `colors` at t in 0..1 (wraps when `cyclic`). */
function palette(colors, t, cyclic = false) {
  const n = colors.length;
  if (n === 0) return [0, 0, 0];
  if (n === 1) return colors[0];
  if (cyclic) {
    const p = fract(t) * n;
    const i = Math.floor(p);
    return mix(colors[i % n], colors[(i + 1) % n], p - i);
  }
  const p = clamp(t) * (n - 1);
  const i = Math.min(Math.floor(p), n - 2);
  return mix(colors[i], colors[i + 1], p - i);
}
/** Deterministic pseudo-random number in 0..1 for an integer (and optional seed). */
function hash(i, seed = 0) {
  let h = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const __perm = new Uint8Array(512);
{
  const p = [];
  for (let i = 0; i < 256; i++) p.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(hash(i, 7) * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) __perm[i] = p[i & 255];
}
function __grad(h, x, y, z) {
  const u = (h & 15) < 8 ? x : y;
  const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
/** Smooth 3D Perlin noise, roughly -1..1. */
function noise(x, y = 0, z = 0) {
  const X = Math.floor(x) & 255,
    Y = Math.floor(y) & 255,
    Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = x * x * x * (x * (x * 6 - 15) + 10),
    v = y * y * y * (y * (y * 6 - 15) + 10),
    w = z * z * z * (z * (z * 6 - 15) + 10);
  const P = __perm;
  const A = P[X] + Y,
    AA = P[A] + Z,
    AB = P[A + 1] + Z,
    B = P[X + 1] + Y,
    BA = P[B] + Z,
    BB = P[B + 1] + Z;
  return lerp(
    lerp(
      lerp(__grad(P[AA], x, y, z), __grad(P[BA], x - 1, y, z), u),
      lerp(__grad(P[AB], x, y - 1, z), __grad(P[BB], x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(__grad(P[AA + 1], x, y, z - 1), __grad(P[BA + 1], x - 1, y, z - 1), u),
      lerp(__grad(P[AB + 1], x, y - 1, z - 1), __grad(P[BB + 1], x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}
var ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
};

// ---- Host side: called from Rust, not part of the effect API. ----
globalThis.__host = (() => {
  const modules = new Map();
  const layouts = new Map();
  const instances = new Map();

  function defaults(meta) {
    const params = {};
    for (const [k, p] of Object.entries((meta && meta.params) || {})) params[k] = p.default;
    return params;
  }

  function ctxFor(layoutId) {
    const l = layouts.get(layoutId);
    if (!l) throw new Error("unknown layout " + layoutId);
    return {
      n: l.n,
      x: l.x,
      y: l.y,
      z: l.z,
      u: l.u,
      aspect: l.aspect,
      t: 0,
      dt: 0,
      params: {},
      colors: [],
      out: new Float32Array(l.n * 3),
    };
  }

  return {
    register(key, ns) {
      if (typeof ns.render !== "function") throw new Error("the script must export a render(ctx) function");
      modules.set(key, ns);
      return JSON.stringify({ meta: ns.meta || {}, loops: typeof ns.loop === "function" });
    },
    unregister(key) {
      modules.delete(key);
    },
    layout(id, xs, ys, zs, aspect) {
      const n = xs.length;
      const u = new Float32Array(n);
      for (let i = 0; i < n; i++) u[i] = n > 1 ? i / (n - 1) : 0;
      layouts.set(id, {
        n,
        x: Float32Array.from(xs),
        y: Float32Array.from(ys),
        z: Float32Array.from(zs),
        u,
        aspect,
      });
    },
    create(id, key, layoutId, params, colors) {
      const ns = modules.get(key);
      if (!ns) throw new Error("unknown script " + key);
      const ctx = ctxFor(layoutId);
      ctx.params = Object.assign(defaults(ns.meta), params || {});
      ctx.colors = colors || [];
      const inst = { ns, ctx, state: undefined };
      instances.set(id, inst);
      if (typeof ns.setup === "function") inst.state = ns.setup(ctx);
    },
    update(id, params, colors) {
      const inst = instances.get(id);
      if (!inst) return;
      inst.ctx.params = Object.assign(defaults(inst.ns.meta), params || {});
      inst.ctx.colors = colors || [];
    },
    drop(id) {
      instances.delete(id);
    },
    // Seconds after which the instance repeats exactly, or null.
    loopOf(id) {
      const inst = instances.get(id);
      if (!inst || typeof inst.ns.loop !== "function") return null;
      const v = inst.ns.loop(inst.ctx.params, inst.ctx.colors);
      return typeof v === "number" && isFinite(v) && v > 0 ? v : null;
    },
    render(id, t, dt) {
      const inst = instances.get(id);
      const ctx = inst.ctx;
      ctx.t = t;
      ctx.dt = dt;
      ctx.out.fill(0);
      const r = inst.ns.render(ctx, inst.state);
      if (r !== undefined && inst.state === undefined) inst.state = r;
      return ctx.out;
    },
    // a and b are rendered frames (Float32Array) or null for black.
    blend(id, a, b, progress, t, dt) {
      const inst = instances.get(id);
      const ctx = inst.ctx;
      const black = (ctx.__black ||= new Float32Array(ctx.n * 3));
      ctx.a = a === null ? black : a;
      ctx.b = b === null ? black : b;
      ctx.progress = progress;
      ctx.t = t;
      ctx.dt = dt;
      ctx.out.fill(0);
      inst.ns.render(ctx, inst.state);
      return ctx.out;
    },
  };
})();
