export const meta = {
  name: "Autumn falling leaves",
  description: "Red, orange and golden leaves tumbling down on the wind.",
  category: "Seasonal",
  colors: [
    { id: "red", label: "Red leaves", default: "#d8240a" },
    { id: "orange", label: "Orange leaves", default: "#ff6e0a" },
    { id: "gold", label: "Golden leaves", default: "#ffb81c" },
    { id: "ground", label: "Background", default: "#2a0f02" },
  ],
  params: {
    count: { type: "number", label: "Leaves", min: 2, max: 30, step: 1, default: 10 },
    speed: { type: "number", label: "Fall speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    wind: { type: "number", label: "Wind", min: -1, max: 1, step: 0.01, default: 0.35 },
    size: { type: "number", label: "Leaf size", min: 0.03, max: 0.2, step: 0.01, default: 0.07 },
  },
  looks: [
    { name: "Maple", params: { count: 14 }, colors: ["#ff1a0a", "#ff4a00", "#ff8a10", "#200802"] },
    { name: "Golden birch", params: { count: 18 }, colors: ["#ff9000", "#ffb000", "#ffd030", "#1a0c02"] },
    { name: "Windy", params: { count: 16, speed: 1.8, wind: 0.9 }, colors: ["#e8300a", "#ff7a1a", "#ffc030", "#200a02"] },
    { name: "Twilight", params: { speed: 0.6, wind: 0.1, size: 0.1 }, colors: ["#c0102a", "#ff5020", "#ff9a20", "#0a0418"] },
  ],
};

const PERIOD = 30;

export function loop(params) {
  return PERIOD / params.speed;
}

export function render(ctx) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const ground = colors[3] || [0.16, 0.06, 0.01];
  const leafCols = 3;
  const wide = aspect > 2.5;
  const p = (t * params.speed) / PERIOD;
  // A dim, warm background glowing a little more near the ground.
  for (let i = 0; i < n; i++) {
    const k = wide ? 0.35 : 0.15 + 0.4 * (1 - y[i]);
    const o = i * 3;
    out[o] = ground[0] * k;
    out[o + 1] = ground[1] * k;
    out[o + 2] = ground[2] * k;
  }
  const r = params.size;
  const wind = params.wind;
  for (let l = 0; l < params.count; l++) {
    const laps = 4 + Math.floor(hash(l, 1) * 4);
    const life = fract(p * laps + hash(l, 2));
    const swayPh = TAU * (p * (laps * 3) + hash(l, 3));
    const sway = Math.sin(swayPh);
    // Tumbling: the leaf flips over, showing its edge and darker underside.
    const flip = Math.cos(TAU * (p * (laps * 5) + hash(l, 4)));
    const shade = 0.45 + 0.55 * Math.abs(flip);
    const ci = Math.floor(hash(l, 5) * leafCols);
    const col = colors[ci] || [1, 0.4, 0.05];
    const col2 = colors[(ci + 1) % leafCols] || col;
    const tint = hash(l, 6) * 0.5;
    let lx, ly, fade, rx, ry;
    if (wide) {
      // Along a line the leaves are carried by the wind, fading in and out.
      lx = fract(hash(l, 7) + (wind >= 0 ? 1 : -1) * life * (0.15 + Math.abs(wind) * 0.3) + sway * 0.02);
      ly = 0.5;
      fade = Math.sin(PI * life);
      rx = r * 0.45;
      ry = 1;
    } else {
      ly = 1.15 - life * 1.3;
      lx = fract(hash(l, 7) + wind * life * 0.5 + sway * 0.07 * (0.6 + 0.4 * Math.abs(wind)));
      fade = 1;
      rx = r * 1.5 * (0.6 + 0.4 * Math.abs(flip));
      ry = r;
    }
    const amp = fade;
    if (amp < 0.01) continue;
    const cr = col[0] + (col2[0] - col[0]) * tint;
    const cg = col[1] + (col2[1] - col[1]) * tint;
    const cb = col[2] + (col2[2] - col[2]) * tint;
    for (let i = 0; i < n; i++) {
      let dx = x[i] - lx;
      dx -= Math.round(dx);
      const ex = dx / rx;
      if (ex > 3 || ex < -3) continue;
      const ey = wide ? 0 : (y[i] - ly) / ry;
      const d2 = ex * ex + ey * ey;
      if (d2 > 9) continue;
      const k = Math.exp(-d2 * 2.2);
      const a = k * amp;
      const o = i * 3;
      out[o] += (cr * shade - out[o]) * a;
      out[o + 1] += (cg * shade - out[o + 1]) * a;
      out[o + 2] += (cb * shade - out[o + 2]) * a;
    }
  }
}
