export const meta = {
  name: "Comets",
  description: "Bright heads with fading tails racing along the string.",
  category: "Particles & physics",
  antialias: true,
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
};
export function loop(params) {
  return 1 / params.speed;
}
export function render(ctx) {
  const { n, u, out, colors, params, t } = ctx;
  const head = colors[0] || [1, 1, 1];
  const tail = colors[1] || [1, 0.2, 0.4];
  const bg = colors[2] || [0, 0, 0];
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let c = 0; c < params.count; c++) {
      const pos = fract(t * params.speed + c / params.count);
      const behind = fract(pos - u[i]);
      if (behind < params.tail) best = Math.max(best, 1 - behind / params.tail);
    }
    const col = best > 0.92 ? head : tail;
    out.set(mix(bg, col, best * best), i * 3);
  }
}
