export const meta = {
  name: "Twinkle",
  description: "A soft base colour with stars that fade in and out.",
  category: "Nature",
  colors: [
    { id: "base", label: "Base", default: "#1b2a6b" },
    { id: "star", label: "Stars", default: "#fff4d6" },
  ],
  params: {
    density: { type: "number", label: "Stars", min: 0, max: 1, step: 0.01, default: 0.35 },
    speed: { type: "number", label: "Twinkle speed", min: 0.05, max: 3, step: 0.01, default: 0.6 },
    base: { type: "number", label: "Base brightness", min: 0, max: 1, step: 0.01, default: 0.35 },
  },
  looks: [
    { name: "Midnight", params: { density: 0.25, base: 0.2 }, colors: ["#060a30", "#ffffff"] },
    { name: "Candlelight", params: {}, colors: ["#6a2000", "#ffe0a0"] },
    { name: "Frost", params: { density: 0.5, speed: 1.2 }, colors: ["#003a6a", "#e0f8ff"] },
    { name: "Disco", params: { density: 0.6, speed: 2 }, colors: ["#2a006a", "#00ffe0"] },
  ],
};
export function loop(params) {
  return 16 / params.speed;
}
export function render(ctx) {
  const { n, out, colors, params, t } = ctx;
  const base = scale(colors[0] || [0.1, 0.15, 0.4], params.base);
  const star = colors[1] || [1, 0.95, 0.85];
  const cycles = 16; // every LED blinks on a whole number of cycles per loop
  for (let i = 0; i < n; i++) {
    const phase = fract((t * params.speed) / cycles + hash(i)) * cycles;
    const k = Math.floor(phase);
    const lit = hash(i * 31 + k, 3) < params.density;
    const f = lit ? Math.pow(Math.sin(fract(phase) * PI), 3) : 0;
    out.set(mix(base, star, f), i * 3);
  }
}
