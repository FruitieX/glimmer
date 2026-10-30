export const meta = {
  name: "Fluid",
  description: "Coloured ink stirred into swirling water by drifting jets.",
  category: "Particles & physics",
  colors: [
    { id: "a", label: "Ink 1", default: "#ff2e88" },
    { id: "b", label: "Ink 2", default: "#21d4fd" },
    { id: "c", label: "Ink 3", default: "#ffb800" },
    { id: "background", label: "Water", default: "#020414" },
  ],
  params: {
    jets: { type: "number", label: "Jets", min: 1, max: 3, step: 1, default: 3 },
    stir: { type: "number", label: "Stirring", min: 0.2, max: 3, step: 0.05, default: 1.2 },
    swirl: { type: "number", label: "Swirliness", min: 0, max: 1, step: 0.01, default: 0.5 },
    fade: { type: "number", label: "Ink lifetime", min: 0.5, max: 8, step: 0.1, unit: "s", default: 2.5 },
  },
};

// A small "stable fluids" solver: semi-Lagrangian advection, a Jacobi pressure
// projection and vorticity confinement on a grid with a one-cell wall border.

export function setup(ctx) {
  const { n, x, y, aspect } = ctx;
  let flat = true;
  for (let i = 1; i < n; i++) if (Math.abs(y[i] - y[0]) > 1e-4) flat = false;
  const W = flat ? 36 : aspect > 1.5 ? 20 : 10;
  const H = flat ? 6 : aspect > 1.5 ? 10 : 20;
  const S = (W + 2) * (H + 2);
  const f = () => new Float32Array(S);
  // Bilinear sample points for every LED, in grid coordinates.
  const i00 = new Int32Array(n), wx = new Float32Array(n), wy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gx = 0.5 + clamp(x[i]) * (W - 1) + 0.5;
    const gy = flat ? 0.5 + H / 2 : 0.5 + clamp(y[i]) * (H - 1) + 0.5;
    const ix = Math.min(W - 1, Math.floor(gx)), iy = Math.min(H, Math.floor(gy));
    i00[i] = ix + (W + 2) * iy;
    wx[i] = gx - ix;
    wy[i] = gy - iy;
  }
  return {
    W, H, flat, i00, wx, wy,
    u: f(), v: f(), u0: f(), v0: f(), p: f(), div: f(), curl: f(),
    r: f(), g: f(), b: f(), r0: f(), g0: f(), b0: f(),
    time: 0,
  };
}

function bounds(s, d, kind) {
  const { W, H } = s;
  const R = W + 2;
  for (let j = 1; j <= H; j++) {
    d[j * R] = kind === 1 ? -d[1 + j * R] : d[1 + j * R];
    d[W + 1 + j * R] = kind === 1 ? -d[W + j * R] : d[W + j * R];
  }
  for (let i = 1; i <= W; i++) {
    d[i] = kind === 2 ? -d[i + R] : d[i + R];
    d[i + (H + 1) * R] = kind === 2 ? -d[i + H * R] : d[i + H * R];
  }
  d[0] = 0.5 * (d[1] + d[R]);
  d[(H + 1) * R] = 0.5 * (d[1 + (H + 1) * R] + d[H * R]);
  d[W + 1] = 0.5 * (d[W] + d[W + 1 + R]);
  d[W + 1 + (H + 1) * R] = 0.5 * (d[W + (H + 1) * R] + d[W + 1 + H * R]);
}

// Moves fields a, b, c (from a0, b0, c0) along the velocity field, tracing
// each cell back to where its contents came from.
function advect(s, u, v, dt, a, a0, b, b0, c, c0, kind) {
  const { W, H } = s;
  const R = W + 2;
  for (let j = 1; j <= H; j++) {
    for (let i = 1; i <= W; i++) {
      const k = i + j * R;
      let xx = i - dt * u[k], yy = j - dt * v[k];
      xx = xx < 0.5 ? 0.5 : xx > W + 0.5 ? W + 0.5 : xx;
      yy = yy < 0.5 ? 0.5 : yy > H + 0.5 ? H + 0.5 : yy;
      const i0 = Math.floor(xx), j0 = Math.floor(yy);
      const sx = xx - i0, sy = yy - j0;
      const k0 = i0 + j0 * R;
      const w00 = (1 - sx) * (1 - sy), w10 = sx * (1 - sy), w01 = (1 - sx) * sy, w11 = sx * sy;
      a[k] = w00 * a0[k0] + w10 * a0[k0 + 1] + w01 * a0[k0 + R] + w11 * a0[k0 + R + 1];
      b[k] = w00 * b0[k0] + w10 * b0[k0 + 1] + w01 * b0[k0 + R] + w11 * b0[k0 + R + 1];
      if (c) c[k] = w00 * c0[k0] + w10 * c0[k0 + 1] + w01 * c0[k0 + R] + w11 * c0[k0 + R + 1];
    }
  }
  if (kind) {
    bounds(s, a, 1);
    bounds(s, b, 2);
  } else {
    bounds(s, a, 0);
    bounds(s, b, 0);
    bounds(s, c, 0);
  }
}

function project(s) {
  const { W, H, u, v, p, div } = s;
  const R = W + 2;
  for (let j = 1; j <= H; j++) {
    for (let i = 1; i <= W; i++) {
      const k = i + j * R;
      div[k] = -0.5 * (u[k + 1] - u[k - 1] + v[k + R] - v[k - R]);
      p[k] = 0;
    }
  }
  bounds(s, div, 0);
  bounds(s, p, 0);
  for (let it = 0; it < 6; it++) {
    for (let j = 1; j <= H; j++) {
      for (let i = 1; i <= W; i++) {
        const k = i + j * R;
        p[k] += ((div[k] + p[k - 1] + p[k + 1] + p[k - R] + p[k + R]) * 0.25 - p[k]) * 1.5;
      }
    }
    bounds(s, p, 0);
  }
  for (let j = 1; j <= H; j++) {
    for (let i = 1; i <= W; i++) {
      const k = i + j * R;
      u[k] -= 0.5 * (p[k + 1] - p[k - 1]);
      v[k] -= 0.5 * (p[k + R] - p[k - R]);
    }
  }
  bounds(s, u, 1);
  bounds(s, v, 2);
}

function vorticity(s, eps, dt) {
  const { W, H, u, v, curl } = s;
  const R = W + 2;
  for (let j = 1; j <= H; j++) {
    for (let i = 1; i <= W; i++) {
      const k = i + j * R;
      curl[k] = 0.5 * (v[k + 1] - v[k - 1] - u[k + R] + u[k - R]);
    }
  }
  for (let j = 2; j < H; j++) {
    for (let i = 2; i < W; i++) {
      const k = i + j * R;
      const nx = 0.5 * (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1]));
      const ny = 0.5 * (Math.abs(curl[k + R]) - Math.abs(curl[k - R]));
      const len = Math.sqrt(nx * nx + ny * ny) + 1e-5;
      const w = curl[k];
      u[k] += (eps * (ny / len) * w) * dt;
      v[k] -= (eps * (nx / len) * w) * dt;
    }
  }
}

// Adds a soft splat of velocity (fx, fy) and dye c around grid point (gx, gy).
function inject(s, gx, gy, fx, fy, c, amount, rad) {
  const { W, H, u, v, r, g, b } = s;
  const R = W + 2;
  const i0 = Math.max(1, Math.floor(gx - rad)), i1 = Math.min(W, Math.ceil(gx + rad));
  const j0 = Math.max(1, Math.floor(gy - rad)), j1 = Math.min(H, Math.ceil(gy + rad));
  const ir2 = 1 / (rad * rad);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = i - gx, dy = j - gy;
      const d = (dx * dx + dy * dy) * ir2;
      if (d >= 1) continue;
      const w = (1 - d) * (1 - d);
      const k = i + j * R;
      u[k] += fx * w;
      v[k] += fy * w;
      const a = amount * w;
      r[k] = Math.min(1.5, r[k] + c[0] * a);
      g[k] = Math.min(1.5, g[k] + c[1] * a);
      b[k] = Math.min(1.5, b[k] + c[2] * a);
    }
  }
}

function jet(s, e, t, stir) {
  // Each jet wanders on its own Lissajous path and points where it is heading.
  const ph = e * 2.1;
  const sp = 0.25 + 0.1 * e;
  const ex = 0.5 + 0.36 * Math.sin(t * sp * 1.3 + ph) + 0.06 * Math.sin(t * 0.9 + e);
  const ey = 0.5 + 0.36 * Math.sin(t * sp * 0.9 + ph * 1.7);
  const dx = 0.36 * sp * 1.3 * Math.cos(t * sp * 1.3 + ph);
  const dy = 0.36 * sp * 0.9 * Math.cos(t * sp * 0.9 + ph * 1.7);
  const turn = t * 0.6 * stir + e * 2;
  return [ex, ey, dx + 0.15 * Math.cos(turn), dy + 0.15 * Math.sin(turn)];
}

function step(s, dt, params, pal) {
  const { W, H, flat } = s;
  s.time += dt;
  const jets = Math.round(params.jets);
  for (let e = 0; e < jets; e++) {
    const [ex, ey, dx, dy] = jet(s, e, s.time, params.stir);
    const gx = 0.5 + ex * W;
    const gy = flat ? 0.5 + H / 2 : 0.5 + ey * H;
    const len = Math.sqrt(dx * dx + dy * dy) + 1e-6;
    const force = params.stir * 30 * dt;
    inject(s, gx, gy, (dx / len) * force * (flat ? 1.5 : 1), flat ? 0 : (dy / len) * force, pal[e], (flat ? 1.5 : 3) * dt, flat ? 2.5 : 2.2);
  }
  if (params.swirl > 0 && !flat) vorticity(s, params.swirl * 4, dt);
  const damp = Math.exp(-0.4 * dt);
  const { u, v, u0, v0 } = s;
  for (let k = 0; k < u.length; k++) {
    u0[k] = u[k] * damp;
    v0[k] = flat ? 0 : v[k] * damp;
  }
  advect(s, u0, v0, dt, u, u0, v, v0, null, null, 1);
  project(s);
  const fade = Math.exp(-dt / params.fade);
  const { r, g, b, r0, g0, b0 } = s;
  for (let k = 0; k < r.length; k++) {
    r0[k] = r[k] * fade;
    g0[k] = g[k] * fade;
    b0[k] = b[k] * fade;
  }
  advect(s, u, v, dt, r, r0, g, g0, b, b0, 0);
}

export function render(ctx, s) {
  const { n, out, params, colors } = ctx;
  const pal = [colors[0] || [1, 0.18, 0.53], colors[1] || [0.13, 0.83, 0.99], colors[2] || [1, 0.72, 0]];
  const bg = colors[3] || [0.01, 0.02, 0.08];
  let dt = Math.min(ctx.dt, 0.5);
  while (dt > 1e-4) {
    const h = Math.min(dt, 0.08);
    step(s, h, params, pal);
    dt -= h;
  }
  const { i00, wx, wy, r, g, b, W } = s;
  const R = W + 2;
  for (let i = 0; i < n; i++) {
    const k = i00[i], sx = wx[i], sy = wy[i];
    const w00 = (1 - sx) * (1 - sy), w10 = sx * (1 - sy), w01 = (1 - sx) * sy, w11 = sx * sy;
    const cr = r[k] * w00 + r[k + 1] * w10 + r[k + R] * w01 + r[k + R + 1] * w11;
    const cg = g[k] * w00 + g[k + 1] * w10 + g[k + R] * w01 + g[k + R + 1] * w11;
    const cb = b[k] * w00 + b[k + 1] * w10 + b[k + R] * w01 + b[k + R + 1] * w11;
    const ink = Math.min(1, Math.max(cr, cg, cb));
    out[i * 3] = bg[0] * (1 - ink) + cr;
    out[i * 3 + 1] = bg[1] * (1 - ink) + cg;
    out[i * 3 + 2] = bg[2] * (1 - ink) + cb;
  }
}
