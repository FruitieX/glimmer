export const meta = {
  name: "Halloween witch flyby",
  description: "A witch on her broomstick sweeps across a big orange moon, leaving a trail of green magic sparkles.",
  category: "Seasonal",
  colors: [
    { id: "moon", label: "Moon", default: "#ff9a2a" },
    { id: "magic", label: "Magic", default: "#6aff3a" },
    { id: "sky", label: "Sky", default: "#16052c" },
    { id: "stars", label: "Stars", default: "#c8b8ff" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    moon: { type: "number", label: "Moon size", min: 0.15, max: 0.45, step: 0.01, default: 0.24 },
    magic: { type: "number", label: "Magic trail", min: 0, max: 1, step: 0.01, default: 0.7 },
  },
  looks: [
    { name: "Blood moon", params: { moon: 0.32 }, colors: ["#ff3a1a", "#ffb020", "#1a0410", "#ffc8a0"] },
    { name: "Pale moon", params: { speed: 0.7, magic: 0.5 }, colors: ["#f0f0ff", "#c040ff", "#060820", "#a0c0ff"] },
    { name: "Hex trail", params: { speed: 1.6, magic: 1 }, colors: ["#ffa020", "#ff30d0", "#12042a", "#d0a0ff"] },
    { name: "Harvest", params: { moon: 0.4, speed: 0.5 }, colors: ["#ffd040", "#40ffa0", "#0a1430", "#ffe0b0"] },
  ],
};

const PERIOD = 14;
const TRAVEL = 0.6;
const X0 = -0.4, X1 = 1.4;

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const s = { pick: new Float32Array(n), phase: new Float32Array(n), crater: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    s.pick[i] = hash(i, 1);
    s.phase[i] = hash(i, 2);
    s.crater[i] = 0.82 + 0.18 * hash(i, 3);
  }
  return s;
}

// Flight path: right to left with a gentle swoop.
function pathY(fx) {
  return 0.6 + 0.14 * Math.sin(PI * fx * 1.2 + 0.3);
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect, spacing } = ctx;
  const moon = colors[0] || [1, 0.6, 0.16];
  const magic = colors[1] || [0.42, 1, 0.23];
  const sky = colors[2] || [0.09, 0.02, 0.17];
  const starC = colors[3] || [0.78, 0.72, 1];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const secs = PERIOD / params.speed;
  const travel = clamp(p / TRAVEL);
  const wx = X1 + (X0 - X1) * travel; // witch position (flies right to left)
  const wy = pathY(wx);
  const R = params.moon;
  const soft = Math.max(spacing, 0.03);
  const amt = params.magic;
  const span = Math.max(1, n - 1);
  // Witch size: about 2 LEDs on a string.
  const unit = wide ? 1 / span : 0.055;
  const flying = travel > 0 && travel < 1;
  for (let i = 0; i < n; i++) {
    const xi = wide ? u[i] : x[i];
    let r = sky[0], g = sky[1], b = sky[2];
    // The moon, with a soft glow and faint blotchy craters.
    let dm;
    if (wide) dm = Math.abs(xi - 0.5) * (span / 40);
    else {
      const dx = (xi - 0.5) * aspect, dy = y[i] - 0.64;
      dm = Math.sqrt(dx * dx + dy * dy);
    }
    const disc = smoothstep(R + soft, R - soft, dm);
    const halo = Math.exp(-Math.max(0, dm - R) * 7) * 0.3;
    const mk = disc * s.crater[i] + (1 - disc) * halo;
    r += (moon[0] - r) * mk;
    g += (moon[1] - g) * mk * (0.9 + 0.1 * disc);
    b += (moon[2] - b) * mk;
    if (disc < 0.5 && s.pick[i] < 0.08) {
      const tw = Math.pow(0.5 + 0.5 * Math.cos(TAU * (p * (3 + Math.floor(s.phase[i] * 4)) + s.phase[i])), 2) * 0.5;
      r += (starC[0] - r) * tw;
      g += (starC[1] - g) * tw;
      b += (starC[2] - b) * tw;
    }
    // Magic trail: sparkles left where the broom passed, fading.
    const passed = ((X1 - xi) / (X1 - X0)) * TRAVEL;
    const age = (p - passed) * secs;
    if (amt > 0 && age > 0 && age < 6) {
      let near = 1;
      if (!wide) {
        const d = (y[i] - pathY(xi) + 0.05 + 0.03 * age) / (0.05 + 0.02 * age);
        near = Math.exp(-d * d);
      }
      const w = 0.5 + 0.5 * Math.cos(TAU * (age * (1.2 + 2 * s.phase[i]) + s.pick[i] * 5));
      const w2 = w * w;
      const k = clamp(amt * near * Math.exp(-age * 0.9) * (0.15 + 1.1 * w2 * w2));
      r += (magic[0] - r) * k;
      g += (magic[1] - g) * k;
      b += (magic[2] - b) * k;
    }
    if (flying) {
      // The witch: a black silhouette (hat, body, broom) with a faint green rim.
      const ax = ((xi - wx) * (wide ? 1 : aspect)) / unit;
      if (ax > -3 && ax < 6) {
        let sil;
        if (wide) sil = smoothstep(1.4, 0.6, Math.abs(ax - 0.5)) + smoothstep(3.5, 2.5, ax) * smoothstep(0.5, 1.5, ax) * 0.8;
        else {
          const ay = (y[i] - wy) / unit;
          const body = Math.exp(-(ax * ax * 0.8 + (ay - 0.6) * (ay - 0.6) * 0.5));
          const hat = Math.exp(-((ax + 0.3) * (ax + 0.3) * 1.5 + (ay - 2.2) * (ay - 2.2) * 0.8));
          const broom = Math.exp(-(ay + 0.5) * (ay + 0.5) * 2) * smoothstep(-2, -1, ax) * smoothstep(5, 3.5, ax);
          sil = clamp(1.4 * Math.max(body, hat, broom));
        }
        sil = clamp(sil);
        // Bristles at the back glow faintly with magic.
        const rim = sil * (1 - sil) * 1.2 * amt;
        r = r * (1 - sil) + magic[0] * rim;
        g = g * (1 - sil) + magic[1] * rim;
        b = b * (1 - sil) + magic[2] * rim;
      }
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
