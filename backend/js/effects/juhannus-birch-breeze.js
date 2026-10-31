export const meta = {
  name: "Juhannus birch breeze",
  description: "White birch trunks under fresh green leaves fluttering in a light midsummer breeze, sunlight dappling through.",
  category: "Seasonal",
  colors: [
    { id: "leaves", label: "Leaves", default: "#48c832" },
    { id: "sun", label: "Sunlight", default: "#fff0a0" },
    { id: "bark", label: "Bark", default: "#eceee4" },
    { id: "sky", label: "Sky", default: "#9cc8ff" },
  ],
  params: {
    breeze: { type: "number", label: "Breeze", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    sun: { type: "number", label: "Sun flecks", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
  looks: [
    { name: "Golden hour", params: { sun: 0.8, breeze: 0.3 }, colors: ["#80d020", "#ffc050", "#fff0d8", "#ff80c0"] },
    { name: "Windy", params: { breeze: 0.9, speed: 1.6 }, colors: ["#50e040", "#fff8c0", "#f0f4ec", "#80c0ff"] },
    { name: "Midnight", params: { sun: 0.2, speed: 0.6 }, colors: ["#30d070", "#ffb0d0", "#e0e4ff", "#8070ff"] },
    { name: "Fresh spring", params: { sun: 0.6 }, colors: ["#90ff40", "#ffffc0", "#ffffff", "#b0e0ff"] },
  ],
};

const PERIOD = 30;
const TRUNKS = [0.22, 0.78];

export function loop(params) {
  return PERIOD / params.speed;
}

export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { wide, trunk: new Float32Array(n), mark: new Float32Array(n), canopy: new Float32Array(n), ph: new Float32Array(n), cyc: new Uint8Array(n), pos: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    s.ph[i] = hash(i, 1);
    s.cyc[i] = 6 + Math.floor(hash(i, 2) * 10);
    s.pos[i] = wide ? u[i] * (n - 1) : x[i] * 9;
    if (wide) continue;
    let tk = 0;
    for (const tx of TRUNKS) tk = Math.max(tk, smoothstep(0.08, 0.04, Math.abs((x[i] - tx) * aspect)));
    s.trunk[i] = tk * smoothstep(0.62, 0.5, y[i]);
    // Birch bark: dark marks here and there.
    s.mark[i] = hash(i, 3) < 0.22 ? 1 : 0;
    // The canopy: a ragged leafy edge above.
    const edge = 0.5 + 0.06 * Math.sin(x[i] * 13) + 0.04 * Math.sin(x[i] * 29 + 1);
    s.canopy[i] = smoothstep(edge - 0.05, edge + 0.05, y[i]);
  }
  return s;
}

export function render(ctx, s) {
  const { n, x, y, out, colors, params, t } = ctx;
  const leaf = colors[0] || [0.28, 0.78, 0.2];
  const sun = colors[1] || [1, 0.94, 0.63];
  const bark = colors[2] || [0.93, 0.93, 0.89];
  const sky = colors[3] || [0.61, 0.78, 1];
  const p = (t * params.speed) / PERIOD;
  const br = params.breeze;
  const sk = params.sun;
  // Gusts: the breeze swells and settles.
  const gust = 0.6 + 0.4 * Math.sin(TAU * p * 3) * Math.sin(TAU * p * 5 + 1);
  for (let i = 0; i < n; i++) {
    const pos = s.pos[i];
    // Each leaf flutters on its own, faster in the gusts.
    const fl = Math.sin(TAU * (p * s.cyc[i] * (1 + br * 3) + s.ph[i]));
    const flick = 0.5 + 0.5 * fl * br * gust;
    // Sun flecks wander through the leaves.
    const dap = 0.5 + 0.5 * Math.sin(TAU * (pos / 7 - p * 4) + 2 * Math.sin(TAU * (pos / 17 + p * 3)));
    const fleck = Math.pow(dap, 4) * sk * (0.6 + 0.4 * flick);
    const lv = 0.35 + 0.35 * flick;
    let r = leaf[0] * lv, g = leaf[1] * lv, b = leaf[2] * lv;
    if (s.wide) {
      r += (sun[0] - r) * fleck;
      g += (sun[1] - g) * fleck;
      b += (sun[2] - b) * fleck;
    } else {
      const yi = y[i];
      // Pale summer-night sky below the canopy, meadow at the bottom.
      const meadow = smoothstep(0.18, 0.05, yi);
      const can = s.canopy[i];
      let br2 = sky[0] * 0.35, bg2 = sky[1] * 0.35, bb2 = sky[2] * 0.35;
      br2 += (leaf[0] * 0.3 - br2) * meadow;
      bg2 += (leaf[1] * 0.3 - bg2) * meadow;
      bb2 += (leaf[2] * 0.3 - bb2) * meadow;
      // Light through the leaves near the top.
      const thin = smoothstep(0.75, 1, yi) * (0.3 + 0.7 * flick);
      r = br2 + (r - br2) * can * (1 - thin * 0.4);
      g = bg2 + (g - bg2) * can * (1 - thin * 0.4);
      b = bb2 + (b - bb2) * can * (1 - thin * 0.4);
      const fk = fleck * (0.4 + 0.6 * can);
      r += (sun[0] - r) * fk;
      g += (sun[1] - g) * fk;
      b += (sun[2] - b) * fk;
      const tk = s.trunk[i];
      if (tk > 0) {
        const lit = 0.55 + 0.35 * dap;
        const m = s.mark[i] ? 0.15 : 1;
        r += (bark[0] * lit * m - r) * tk;
        g += (bark[1] * lit * m - g) * tk;
        b += (bark[2] * lit * m - b) * tk;
      }
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
