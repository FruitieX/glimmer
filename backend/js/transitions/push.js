export const meta = {
  name: "Push",
  description: "The new look slides in and pushes the old one out (or slides over it, or the old one slides away).",
  params: {
    direction: {
      type: "select",
      label: "Direction",
      options: ["left", "right", "up", "down"],
      labels: ["To the left", "To the right", "Upwards", "Downwards"],
      default: "left",
    },
    mode: {
      type: "select",
      label: "Movement",
      options: ["push", "cover", "uncover"],
      labels: ["New pushes old out", "New slides over old", "Old slides away"],
      default: "push",
    },
  },
};

export function setup(ctx) {
  return { s: sampler(ctx), rgb: [0, 0, 0], rgb2: [0, 0, 0] };
}

export function render(ctx, st) {
  const { n, x, y, u, a, b, out, progress, params } = ctx;
  const { s, rgb, rgb2 } = st;
  const p = ease.inOut(progress);
  const dir = params.direction;
  const vertical = !s.line && (dir === "up" || dir === "down");
  // Coordinate along the movement, with the new look entering at 1.
  const back = dir === "right" || dir === "up";
  const gap = s.line ? s.su : vertical ? s.sy : s.sx;
  const soft = gap * 0.75;
  const seam = lerp(1 + soft, -soft, p);
  const moveA = params.mode !== "cover";
  const moveB = params.mode !== "uncover";
  for (let i = 0; i < n; i++) {
    const raw = s.line ? u[i] : vertical ? y[i] : x[i];
    const c = back ? 1 - raw : raw;
    const ca = moveA ? c + p : c;
    const cb = moveB ? c - (1 - p) : c;
    const pa = back ? 1 - ca : ca;
    const pb = back ? 1 - cb : cb;
    if (s.line) {
      s.along(a, pa, rgb);
      s.along(b, pb, rgb2);
    } else if (vertical) {
      s.at(a, x[i], pa, rgb);
      s.at(b, x[i], pb, rgb2);
    } else {
      s.at(a, pa, y[i], rgb);
      s.at(b, pb, y[i], rgb2);
    }
    const k = smoothstep(seam - soft, seam + soft, c);
    // A faint shadow where the moving picture overlaps the other.
    const shade = 1 - 0.35 * Math.sin(PI * progress) * Math.exp(-Math.abs(c - seam) / (gap * 2));
    const j = i * 3;
    for (let ch = 0; ch < 3; ch++) {
      const va = moveB && !moveA ? rgb[ch] * shade : rgb[ch];
      const vb = moveA && !moveB ? rgb2[ch] * shade : rgb2[ch];
      out[j + ch] = va + (vb - va) * k;
    }
  }
}
