import type { ScriptKind } from "../api";

export const TEMPLATES: Record<ScriptKind, string> = {
  effect: `export const meta = {
  name: "My effect",
  description: "A soft wave of colour.",
  colors: [
    { id: "a", label: "First", default: "#ff6b6b" },
    { id: "b", label: "Second", default: "#4d96ff" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0, max: 2, step: 0.01, default: 0.3 },
    waves: { type: "number", label: "Waves", min: 0.5, max: 6, step: 0.5, default: 2 },
  },
};

export function loop(params) {
  return params.speed > 0 ? 1 / params.speed : 10;
}

export function render(ctx) {
  const { n, x, out, colors, params, t } = ctx;
  for (let i = 0; i < n; i++) {
    const k = 0.5 + 0.5 * Math.sin(TAU * (x[i] * params.waves - t * params.speed));
    out.set(mix(colors[0], colors[1], k), i * 3);
  }
}
`,
  transition: `export const meta = {
  name: "My transition",
  description: "Fades from the bottom up.",
  params: {
    softness: { type: "number", label: "Edge softness", min: 0.01, max: 0.5, step: 0.01, default: 0.2 },
  },
};

export function render(ctx) {
  const { n, y, a, b, out, progress, params } = ctx;
  const p = ease.inOut(progress) * (1 + params.softness);
  for (let i = 0; i < n; i++) {
    const k = smoothstep(y[i], y[i] + params.softness, p);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[i * 3 + c] + (b[i * 3 + c] - a[i * 3 + c]) * k;
  }
}
`,
};
