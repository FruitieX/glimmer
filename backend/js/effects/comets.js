export const meta = {
  name: "Comets",
  description: "Bright heads with fading tails racing along the string.",
  category: "Particles & physics",
  colors: [
    { id: "head", label: "Head", default: "#ffffff" },
    { id: "tail", label: "Tail", default: "#ff2a6d" },
    { id: "background", label: "Background", default: "#000000" },
  ],
  params: {
    count: { type: "number", label: "Comets", min: 1, max: 8, step: 1, default: 3 },
    speed: { type: "number", label: "Speed", min: 0.02, max: 1, step: 0.01, default: 0.15 },
    tail: { type: "number", label: "Tail length", min: 0.02, max: 0.5, step: 0.01, default: 0.15 },
  },
  looks: [
    { name: "Ice", params: {}, colors: ["#ffffff", "#20a0ff", "#000208"] },
    { name: "Fireball", params: { speed: 0.25, tail: 0.25 }, colors: ["#fff0a0", "#ff3000", "#000000"] },
    { name: "Meteors", params: { count: 8, speed: 0.4, tail: 0.08 }, colors: ["#ffffff", "#ffb040", "#01020a"] },
    { name: "Slow drift", params: { count: 1, speed: 0.05, tail: 0.4 }, colors: ["#e0ffe0", "#20ff80", "#000000"] },
    { name: "Neon", params: { count: 5 }, colors: ["#ffe0ff", "#c000ff", "#000000"] },
  ],
};
export function loop(params) {
  return 1 / params.speed;
}
export function render(ctx) {
  const { n, u, out, colors, params, t } = ctx;
  const head = colors[0] || [1, 1, 1];
  const tail = colors[1] || [1, 0.2, 0.4];
  const bg = colors[2] || [0, 0, 0];
  // One LED along the wire; the head's leading edge fades across it, so the
  // comet glides between LEDs instead of stepping.
  const du = n > 1 ? 1 / (n - 1) : 1;
  const len = params.tail;
  // The head colour takes over near full brightness, blended over one LED too.
  const hw = Math.min(0.5 * (du / len), 0.08);
  for (let i = 0; i < n; i++) {
    let best = 0, along = 0;
    for (let c = 0; c < params.count; c++) {
      const pos = fract(t * params.speed + c / params.count);
      // Distance behind the head along the loop, -0.5..0.5.
      const behind = fract(pos - u[i] + 0.5) - 0.5;
      if (behind > len || behind < -du) continue;
      // How much of this LED the comet covers, and how far down the tail it is.
      const cover = clamp(0.5 + behind / du);
      const k = Math.min(1, 1 - behind / len);
      const v = cover * k * k;
      if (v > best) {
        best = v;
        along = k;
      }
    }
    const o = i * 3;
    if (best <= 0) {
      out[o] = bg[0];
      out[o + 1] = bg[1];
      out[o + 2] = bg[2];
      continue;
    }
    const h = smoothstep(0.92 - hw, 0.92 + hw, along);
    for (let ch = 0; ch < 3; ch++) {
      const col = tail[ch] + (head[ch] - tail[ch]) * h;
      out[o + ch] = bg[ch] + (col - bg[ch]) * best;
    }
  }
}
