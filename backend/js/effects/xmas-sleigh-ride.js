export const meta = {
  name: "Christmas sleigh ride",
  description: "Santa's sleigh and a red-nosed reindeer sweeping across the starry sky, trailing golden sparkles.",
  category: "Seasonal",
  colors: [
    { id: "sky", label: "Sky", default: "#030a24" },
    { id: "trail", label: "Sparkle trail", default: "#ffd070" },
    { id: "sleigh", label: "Sleigh", default: "#ff2418" },
    { id: "reindeer", label: "Reindeer", default: "#b06a30" },
    { id: "stars", label: "Stars", default: "#d8e4ff" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    trail: { type: "number", label: "Trail length", min: 0.3, max: 4, step: 0.01, unit: "s", default: 2.2 },
    stars: { type: "number", label: "Stars", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Golden night", params: { trail: 3.5, stars: 0.7 }, colors: ["#020616", "#ffb030", "#ff1a10", "#d07a30", "#fff0c0"] },
    { name: "Frosty", params: { speed: 0.7 }, colors: ["#020a20", "#a0e0ff", "#ff2020", "#c08040", "#e0f4ff"] },
    { name: "Express", params: { speed: 2, trail: 1.2 }, colors: ["#040820", "#40ff80", "#ff2418", "#d08040", "#ffffff"] },
    { name: "Ruby trail", params: { stars: 0.8, speed: 0.6 }, colors: ["#010412", "#ff2a40", "#ffd040", "#a06030", "#c0d0ff"] },
  ],
};

// Two crossings per loop: left to right high up, then back lower down.
const PERIOD = 16;
const TRAVEL = 0.55; // share of each crossing spent moving; the rest lets the trail fade
const X0 = -0.35, X1 = 1.35;
const NOSE = [1, 0.05, 0.02];

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const n = ctx.n;
  const s = { pick: new Float32Array(n), phase: new Float32Array(n), cyc: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    s.pick[i] = hash(i, 1);
    s.phase[i] = hash(i, 2);
    s.cyc[i] = 3 + Math.floor(hash(i, 3) * 6);
  }
  return s;
}

function pathY(c, x) {
  return c === 0 ? 0.5 + 0.28 * Math.sin(PI * x) : 0.62 - 0.2 * Math.sin(PI * x) - 0.12 * x;
}

export function render(ctx, s) {
  const { n, x, y, u, out, colors, params, t, aspect } = ctx;
  const sky = colors[0] || [0.01, 0.04, 0.14];
  const trail = colors[1] || [1, 0.82, 0.44];
  const sleigh = colors[2] || [1, 0.14, 0.1];
  const deer = colors[3] || [0.7, 0.42, 0.19];
  const starC = colors[4] || [0.85, 0.9, 1];
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  const q2 = p * 2;
  const c = Math.floor(q2) % 2;
  const q = q2 - Math.floor(q2); // 0..1 through this crossing
  const secs = PERIOD / 2 / params.speed; // seconds per crossing
  const travel = clamp(q / TRAVEL);
  const sx = X0 + (X1 - X0) * travel;
  const dir = c === 0 ? 1 : -1;
  const sy = pathY(c, sx);
  const fade = 1 / params.trail;
  const starThr = params.stars * 0.16;
  // Size of the sleigh: about 1.5 LEDs on a string, a little more on a curtain.
  const span = wide ? Math.max(1, n - 1) : 1;
  const unit = wide ? 1 / span : 0.05;
  for (let i = 0; i < n; i++) {
    // Position along the flight, mirrored when flying right to left.
    const xi = wide ? u[i] : x[i];
    const fx = dir > 0 ? xi : 1 - xi;
    let r = sky[0], g = sky[1], b = sky[2];
    if (s.pick[i] < starThr) {
      const k = 0.25 + 0.35 * Math.pow(0.5 + 0.5 * Math.cos(TAU * (p * s.cyc[i] + s.phase[i])), 2);
      r += (starC[0] - r) * k;
      g += (starC[1] - g) * k;
      b += (starC[2] - b) * k;
    }
    // Trail: how long ago the sleigh passed this spot.
    const passed = ((fx - X0) / (X1 - X0)) * TRAVEL;
    const age = (q - passed) * secs;
    if (age > 0 && age < params.trail * 4) {
      let near;
      if (wide) near = 1;
      else {
        // The sparkles drift down a little as they fade.
        const d = (y[i] - pathY(c, fx) + 0.04 * age) / (0.045 + 0.025 * age);
        near = Math.exp(-d * d);
      }
      // A dim glow with sparkles flashing in it.
      const w = 0.5 + 0.5 * Math.cos(TAU * (age * (1.5 + 2.5 * s.phase[i]) + s.pick[i] * 7));
      const w2 = w * w;
      const tw = 0.3 + 0.9 * w2 * w2 * w2;
      const k = clamp(Math.exp(-age * fade) * near * tw);
      r += (trail[0] - r) * k;
      g += (trail[1] - g) * k;
      b += (trail[2] - b) * k;
    }
    if (travel > 0 && travel < 1) {
      // Sleigh, reindeer ahead of it and the red nose leading the way.
      const ax = ((fx - sx) * (wide ? 1 : aspect)) / unit;
      if (ax > -4 && ax < 9) {
        const ay = wide ? 0 : (y[i] - sy) / unit;
        const bs = Math.exp(-(ax * ax + ay * ay) / 1.4);
        const dx2 = ax - 3.2, dy2 = wide ? 0 : (y[i] - pathY(c, sx + (3.2 * unit) / (wide ? 1 : aspect))) / unit - 0.3;
        const ds = Math.exp(-(dx2 * dx2 + dy2 * dy2) / 1.1) * 0.85;
        const nx2 = ax - 5, ny2 = dy2 - 0.4;
        const ns = Math.exp(-(nx2 * nx2 + ny2 * ny2) / 0.5);
        const sk = clamp(bs), dk = clamp(ds), nk = clamp(ns);
        r += (sleigh[0] - r) * sk;
        g += (sleigh[1] - g) * sk;
        b += (sleigh[2] - b) * sk;
        r += (deer[0] - r) * dk;
        g += (deer[1] - g) * dk;
        b += (deer[2] - b) * dk;
        r += (NOSE[0] - r) * nk;
        g += (NOSE[1] - g) * nk;
        b += (NOSE[2] - b) * nk;
        // A warm glow from the sleigh's lantern.
        const gl = Math.exp(-(ax * ax + ay * ay) / 10) * 0.3;
        r += trail[0] * gl;
        g += trail[1] * gl;
        b += trail[2] * gl;
      }
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
