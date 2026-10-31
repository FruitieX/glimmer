export const meta = {
  name: "Falling Sand",
  description: "Coloured sand pouring from a wandering spout, piling up in layers, then draining away.",
  category: "Particles & physics",
  colors: [
    { id: "a", label: "Sand 1", default: "#f4a259" },
    { id: "b", label: "Sand 2", default: "#e63946" },
    { id: "c", label: "Sand 3", default: "#f1dca7" },
    { id: "background", label: "Background", default: "#0a0712" },
  ],
  params: {
    rate: { type: "number", label: "Pour rate", min: 2, max: 30, step: 1, default: 9 },
    wander: { type: "number", label: "Spout wander", min: 0, max: 1, step: 0.01, default: 0.6 },
    layers: { type: "number", label: "Layer length", min: 2, max: 30, step: 0.5, unit: "s", default: 8 },
    hold: { type: "number", label: "Pause when full", min: 0, max: 10, step: 0.5, unit: "s", default: 2 },
  },
  looks: [
    { name: "Desert", params: { rate: 14 }, colors: ["#ffb040", "#ff7020", "#ffe0a0", "#0a0602"] },
    { name: "Seaside", params: {}, colors: ["#ffd060", "#20c0ff", "#ffffff", "#000a14"] },
    { name: "Neon", params: { rate: 20, wander: 0.9 }, colors: ["#ff00a0", "#00ffd0", "#ffe000", "#050010"] },
    { name: "Hourglass", params: { rate: 4, wander: 0, layers: 15 }, colors: ["#ffc040", "#ff9020", "#ffe8a0", "#04030a"] },
  ],
};

const MAXG = 48;

function distinct(a, n) {
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.round(a[i] * 500);
  v.sort();
  let d = 1;
  for (let i = 1; i < n; i++) if (v[i] !== v[i - 1]) d++;
  return d;
}

export function setup(ctx) {
  const { n, x, y } = ctx;
  const flat = distinct(y, n) === 1;
  // Columns and rows of the sand grid; a straight string is one tall column.
  const C = flat ? 1 : clamp(distinct(x, n), 3, 24);
  const R = flat ? clamp(Math.round(distinct(x, n) / 1.5), 8, 150) : clamp(distinct(y, n), 8, 40);
  const hc = new Float32Array(n), vr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hc[i] = flat ? 0 : x[i] * (C - 1);
    vr[i] = (flat ? x[i] : y[i]) * (R - 1);
  }
  return {
    flat, C, R, hc, vr,
    cell: new Float32Array(C * R * 3),
    h: new Int32Array(C),
    gx: new Float32Array(MAXG), gy: new Float32Array(MAXG), vy: new Float32Array(MAXG),
    tc: new Int32Array(MAXG), on: new Uint8Array(MAXG),
    gc: new Float32Array(MAXG * 3),
    time: 0, acc: 0, phase: 0, wait: 0, drain: 0,
  };
}

function grainColour(s, colors, out, o) {
  const pal = [colors[0] || [0.96, 0.64, 0.35], colors[1] || [0.9, 0.22, 0.27], colors[2] || [0.95, 0.86, 0.65]];
  const c = palette(pal, s.time / s.layers, true);
  const k = 0.8 + 0.2 * Math.random();
  out[o] = c[0] * k;
  out[o + 1] = c[1] * k;
  out[o + 2] = c[2] * k;
}

function step(s, dt, p, colors) {
  const { C, R, h, cell } = s;
  s.time += dt;
  s.layers = p.layers;
  const grav = 2.2 * R; // rows per second²
  if (s.phase === 0) {
    s.acc += dt * p.rate;
    while (s.acc >= 1) {
      s.acc -= 1;
      for (let g = 0; g < MAXG; g++) {
        if (s.on[g]) continue;
        const w = 0.5 + 0.48 * p.wander * Math.sin(s.time * 0.5) * Math.cos(s.time * 0.23 + 1);
        const col = Math.round(w * (C - 1));
        s.on[g] = 1;
        s.gx[g] = col;
        s.tc[g] = col;
        s.gy[g] = R + 0.5;
        s.vy[g] = 0;
        grainColour(s, colors, s.gc, g * 3);
        break;
      }
    }
  }
  for (let g = 0; g < MAXG; g++) {
    if (!s.on[g]) continue;
    s.vy[g] = Math.min(s.vy[g] + grav * dt, R * 1.1);
    s.gy[g] -= s.vy[g] * dt;
    const c = s.tc[g];
    const dx = c - s.gx[g];
    s.gx[g] += Math.sign(dx) * Math.min(Math.abs(dx), 6 * dt);
    if (s.phase !== 0) {
      if (s.gy[g] < -2) s.on[g] = 0;
      continue;
    }
    if (Math.abs(c - s.gx[g]) < 1e-3 && s.gy[g] <= h[c]) {
      // Roll down the slope when a neighbouring column is clearly lower.
      const l = c > 0 && h[c - 1] <= h[c] - 2, r = c < C - 1 && h[c + 1] <= h[c] - 2;
      if (l || r) {
        s.tc[g] = l && r ? (Math.random() < 0.5 ? c - 1 : c + 1) : l ? c - 1 : c + 1;
        continue;
      }
      if (h[c] < R) {
        const o = (c * R + h[c]) * 3;
        cell[o] = s.gc[g * 3];
        cell[o + 1] = s.gc[g * 3 + 1];
        cell[o + 2] = s.gc[g * 3 + 2];
        h[c]++;
      }
      s.on[g] = 0;
      if (h[c] >= R - 1) {
        s.phase = 1;
        s.wait = p.hold;
      }
    }
  }
  if (s.phase === 1) {
    s.wait -= dt;
    if (s.wait <= 0) s.phase = 2;
  } else if (s.phase === 2) {
    // The whole pile slides out of the bottom.
    s.drain += dt * R * 0.35;
    if (s.drain > R + 1) {
      s.drain = 0;
      s.phase = 0;
      cell.fill(0);
      h.fill(0);
    }
  }
}

export function render(ctx, s) {
  const { n, out, params, colors } = ctx;
  let dt = Math.min(ctx.dt, 0.5);
  while (dt > 1e-4) {
    const st = Math.min(dt, 1 / 40);
    step(s, st, params, colors);
    dt -= st;
  }
  const bg = colors[3] || [0.04, 0.03, 0.07];
  const { C, R, cell, hc, vr } = s;
  const off = s.drain;
  for (let i = 0; i < n; i++) {
    // Bilinear sample of the sand grid (empty cells are transparent).
    const fx = hc[i], fy = vr[i] + off;
    const c0 = Math.floor(fx), r0 = Math.floor(fy);
    const ax = fx - c0, ay = fy - r0;
    let cr = 0, cg = 0, cb = 0, cover = 0;
    for (let k = 0; k < 4; k++) {
      const c = c0 + (k & 1), r = r0 + (k >> 1);
      if (c < 0 || c >= C || r < 0 || r >= R) continue;
      const w = (k & 1 ? ax : 1 - ax) * (k >> 1 ? ay : 1 - ay);
      if (w <= 0) continue;
      const o = (c * R + r) * 3;
      if (cell[o] + cell[o + 1] + cell[o + 2] === 0) continue;
      cr += cell[o] * w;
      cg += cell[o + 1] * w;
      cb += cell[o + 2] * w;
      cover += w;
    }
    out[i * 3] = bg[0] * (1 - cover) + cr;
    out[i * 3 + 1] = bg[1] * (1 - cover) + cg;
    out[i * 3 + 2] = bg[2] * (1 - cover) + cb;
  }
  // Falling grains, with the same tent weighting so landing is seamless.
  for (let g = 0; g < MAXG; g++) {
    if (!s.on[g]) continue;
    const gx = s.gx[g], gy = s.gy[g];
    for (let i = 0; i < n; i++) {
      const dy = Math.abs(vr[i] - gy);
      if (dy >= 1.3) continue;
      const dx = Math.abs(hc[i] - gx);
      if (dx >= 1) continue;
      // Slightly stretched along the fall, like a streak.
      const w = (1 - dx) * (1 - dy / 1.3);
      const o = i * 3;
      out[o] += (s.gc[g * 3] - out[o]) * w;
      out[o + 1] += (s.gc[g * 3 + 1] - out[o + 1]) * w;
      out[o + 2] += (s.gc[g * 3 + 2] - out[o + 2]) * w;
    }
  }
}
