export const meta = {
  name: "Wipe",
  description: "A soft edge sweeps across, revealing the new look.",
  params: {
    direction: {
      type: "select",
      label: "Direction",
      options: ["up", "down", "left", "right", "along", "back"],
      labels: ["Upwards", "Downwards", "Right to left", "Left to right", "Along the string", "Back along the string"],
      default: "up",
    },
    softness: { type: "number", label: "Edge softness", min: 0.01, max: 0.5, step: 0.01, default: 0.15 },
  },
};
export function render(ctx) {
  const { n, x, y, u, a, b, out, progress, params } = ctx;
  const p = ease.inOut(progress);
  const s = params.softness;
  for (let i = 0; i < n; i++) {
    let v;
    switch (params.direction) {
      case "down": v = 1 - y[i]; break;
      case "left": v = 1 - x[i]; break;
      case "right": v = x[i]; break;
      case "along": v = u[i]; break;
      case "back": v = 1 - u[i]; break;
      default: v = y[i];
    }
    const k = smoothstep(v, v + s, p * (1 + s));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = a[i * 3 + c] + (b[i * 3 + c] - a[i * 3 + c]) * k;
  }
}
