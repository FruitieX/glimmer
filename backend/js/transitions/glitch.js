export const meta = {
  name: "Glitch",
  description: "Digital glitches: bands tear sideways, colours split and blocks flicker between the old and new look.",
  params: {
    strength: { type: "number", label: "Strength", min: 0, max: 1, step: 0.01, default: 0.6 },
    rate: { type: "number", label: "Glitches per second", min: 3, max: 30, step: 1, default: 12 },
    split: { type: "boolean", label: "Colour split", default: true },
  },
};

export function setup(ctx) {
  return { s: sampler(ctx), rgb: [0, 0, 0], tmp: [0, 0, 0] };
}

function read(s, frame, along, y, rgb) {
  return s.line ? s.along(frame, along, rgb) : s.at(frame, along, y, rgb);
}

export function render(ctx, st) {
  const { n, x, y, u, a, b, out, progress, params, t } = ctx;
  const { s, rgb, tmp } = st;
  const g = params.strength * Math.pow(Math.sin(PI * progress), 0.7);
  const tick = Math.floor(t * params.rate);
  // Which picture a block shows switches over (with some back and forth).
  const share = smoothstep(0.1, 0.9, progress);
  const bands = s.line ? 12 : 7;
  const gap = s.line ? s.su : s.sx;
  for (let i = 0; i < n; i++) {
    // Bands across the picture (lengths of the wire on a line), redrawn every tick.
    const along = s.line ? u[i] : x[i];
    const across = s.line ? u[i] : 1 - y[i];
    const band = Math.floor(across * bands + hash(tick, 1) * 0.999);
    const torn = hash(band, tick * 7 + 3) < g * 0.7;
    const shift = torn ? (hash(band, tick * 7 + 4) - 0.5) * 0.5 * g : 0;
    const block = band * 16 + Math.floor(along * (s.line ? 1 : 4));
    const pick = hash(block, Math.floor(t * params.rate * 0.5) * 13 + 5);
    const src = pick < share ? b : a;
    // Torn bands wrap around sideways.
    const pos = torn ? fract(along + shift) : along;
    read(s, src, pos, y[i], rgb);
    if (params.split && torn) {
      // In torn bands red and blue drift apart by up to a couple of LEDs.
      const d = g * gap * 2;
      rgb[0] = read(s, src, clamp(pos + d), y[i], tmp)[0];
      rgb[2] = read(s, src, clamp(pos - d), y[i], tmp)[2];
    }
    // Now and then a band flashes in a false colour.
    const tint = hash(band, tick * 7 + 6) < g * 0.12 ? 1 : 0;
    const j = i * 3;
    out[j] = rgb[0] * (1 - tint * 0.6);
    out[j + 1] = rgb[1] + (1 - rgb[1]) * tint * 0.35;
    out[j + 2] = rgb[2] + (1 - rgb[2]) * tint * 0.35;
  }
}
