export const meta = {
  name: "Christmas gingerbread glow",
  description: "A cosy gingerbread house with white icing, candy trim and warm candle-lit windows on a snowy night.",
  category: "Seasonal",
  colors: [
    { id: "gingerbread", label: "Gingerbread", default: "#9a4a14" },
    { id: "icing", label: "Icing", default: "#fff6ec" },
    { id: "window", label: "Window light", default: "#ffb030" },
    { id: "candy", label: "Candy", default: "#ff1e3c" },
    { id: "candy2", label: "Candy 2", default: "#20c050" },
    { id: "sky", label: "Sky", default: "#040a26" },
  ],
  params: {
    flicker: { type: "number", label: "Candle flicker", min: 0, max: 1, step: 0.01, default: 0.5 },
    speed: { type: "number", label: "Speed", min: 0.1, max: 3, step: 0.01, default: 1 },
    sparkle: { type: "number", label: "Icing sparkle", min: 0, max: 1, step: 0.01, default: 0.4 },
  },
  looks: [
    { name: "Candlelit", params: { flicker: 0.8, speed: 0.7 }, colors: ["#a04010", "#fff0d8", "#ff9010", "#ff1e2a", "#20c050", "#030618"] },
    { name: "Frosted", params: { sparkle: 0.9 }, colors: ["#b05a20", "#ffffff", "#ffe0a0", "#ff3a8a", "#40d0ff", "#020c28"] },
    { name: "Candyland", params: { speed: 1.3 }, colors: ["#d06020", "#fff0f8", "#ffb040", "#ff40c0", "#a0ff20", "#0a0420"] },
    { name: "Cosy", params: { flicker: 0.3, sparkle: 0.2 }, colors: ["#8a3a10", "#ffe8d0", "#ff8020", "#ff2010", "#10a040", "#06040e"] },
  ],
};

const PERIOD = 40;
const SLOTS = 40;

export function loop(params) {
  return PERIOD / params.speed;
}

// Part of the picture each LED shows, worked out once: weights for
// gingerbread, icing, window, candy (0/1/2 = none/first/second) and snow.
export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = {
    wide,
    wall: new Float32Array(n),
    ice: new Float32Array(n),
    win: new Float32Array(n),
    winId: new Uint8Array(n),
    candy: new Uint8Array(n),
    snow: new Float32Array(n),
    off: new Float32Array(n),
    flick: new Float32Array(8),
  };
  for (let i = 0; i < n; i++) {
    s.off[i] = hash(i, 3) * SLOTS;
    if (wide) {
      // A row of little houses, 12 LEDs each: icing at the corners, a window
      // in the middle, candy buttons in between.
      const led = Math.round(u[i] * (n - 1));
      const k = led % 12;
      const house = Math.floor(led / 12);
      s.wall[i] = 1;
      s.winId[i] = house % 8;
      if (k === 0 || k === 11) s.ice[i] = 1;
      else if (k >= 4 && k <= 7) s.win[i] = k === 4 || k === 7 ? 0.65 : 1;
      else if (k === 2) s.candy[i] = 1 + (house % 2);
      continue;
    }
    const xi = x[i], yi = y[i];
    const dx = Math.abs(xi - 0.5);
    const ax = dx * aspect;
    // Walls and roof (a gable from 0.5 to 0.86), with soft edges.
    const wall = smoothstep(0.43, 0.39, dx) * smoothstep(0.08, 0.12, yi) * smoothstep(0.54, 0.5, yi);
    const roofEdge = 0.86 - (ax / 0.5) * 0.4; // height of the roofline
    const roof = smoothstep(0.03, -0.03, yi - roofEdge) * smoothstep(0.46, 0.5, yi) * smoothstep(0.52, 0.47, dx);
    const roofIce = Math.exp(-Math.pow((yi - roofEdge) / 0.035, 2)) * smoothstep(0.55, 0.47, dx) * smoothstep(0.44, 0.5, yi);
    s.wall[i] = Math.max(wall, roof);
    // Icing: along the roofline, the eaves and the base, piped in scallops.
    const eaves = Math.exp(-Math.pow((yi - 0.52) / 0.03, 2)) * smoothstep(0.47, 0.42, dx);
    const base = Math.exp(-Math.pow((yi - 0.1) / 0.03, 2)) * smoothstep(0.47, 0.42, dx);
    s.ice[i] = clamp(Math.max(roofIce, eaves * 0.9, base * 0.7));
    // Two windows and a door.
    const wx = Math.abs(dx - 0.22);
    const winA = smoothstep(0.1, 0.07, wx) * smoothstep(0.08, 0.06, Math.abs(yi - 0.33));
    const door = smoothstep(0.08, 0.04, dx) * smoothstep(0.3, 0.26, yi) * smoothstep(0.1, 0.13, yi);
    s.win[i] = Math.max(winA, door * 0.45);
    s.winId[i] = xi < 0.5 ? 0 : 1;
    // Candy buttons where icing meets the walls.
    if (eaves > 0.5 && Math.round(xi * 9) % 2 === 0) s.candy[i] = 1 + (Math.round(xi * 9) % 4 === 0 ? 1 : 0);
    // A gumdrop on the roof's peak.
    if (yi > 0.88 && yi < 0.97 && ax < 0.07) s.candy[i] = 1;
    s.snow[i] = smoothstep(0.07, 0.02, yi);
  }
  return s;
}

export function render(ctx, s) {
  const { n, out, colors, params, t } = ctx;
  const gb = colors[0] || [0.6, 0.29, 0.08];
  const ice = colors[1] || [1, 0.96, 0.92];
  const win = colors[2] || [1, 0.69, 0.19];
  const c1 = colors[3] || [1, 0.12, 0.24];
  const c2 = colors[4] || [0.13, 0.75, 0.31];
  const sky = colors[5] || [0.02, 0.04, 0.15];
  const p = (t * params.speed) / PERIOD;
  const fl = params.flicker;
  const thr = params.sparkle * 0.25;
  // Candle flicker per window: a few slow and quick wobbles.
  const flick = s.flick;
  for (let w = 0; w < 8; w++) {
    const a = Math.sin(TAU * (p * (23 + w * 3) + hash(w, 1)));
    const b = Math.sin(TAU * (p * (61 + w * 5) + hash(w, 2)));
    const c = Math.sin(TAU * (p * 7 + hash(w, 3)));
    flick[w] = 1 - fl * (0.18 + 0.12 * a + 0.08 * b + 0.06 * c);
  }
  for (let i = 0; i < n; i++) {
    let r = sky[0], g = sky[1], b = sky[2];
    const wall = s.wall[i];
    if (wall > 0) {
      const k = 0.55 * wall;
      r += (gb[0] * 0.55 - r) * wall;
      g += (gb[1] * 0.55 - g) * wall;
      b += (gb[2] * 0.55 - b) * wall;
      // The walls catch a little of the window light.
      r += win[0] * 0.08 * k;
      g += win[1] * 0.08 * k;
    }
    const w = s.win[i];
    if (w > 0) {
      const k = w * flick[s.winId[i]];
      r += (win[0] * k - r) * w;
      g += (win[1] * k * k - g) * w;
      b += (win[2] * k * k - b) * w;
    }
    let ik = s.ice[i];
    if (s.snow[i] > ik) ik = s.snow[i] * 0.55;
    if (ik > 0) {
      // Icing sparkles now and then like sugar.
      const q = p * SLOTS + s.off[i];
      const slot = Math.floor(q);
      let sp = 0;
      if (hash(i * 37 + (slot % SLOTS), 4) < thr) sp = Math.sin(PI * (q - slot)) * 0.35;
      const lv = 0.7 + sp;
      r += (ice[0] * lv - r) * ik;
      g += (ice[1] * lv - g) * ik;
      b += (ice[2] * lv - b) * ik;
    }
    if (s.candy[i]) {
      const c = s.candy[i] === 1 ? c1 : c2;
      const k = 0.75 + 0.15 * Math.sin(TAU * (p * 4 + i * 0.13));
      r = c[0] * k;
      g = c[1] * k;
      b = c[2] * k;
    }
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
