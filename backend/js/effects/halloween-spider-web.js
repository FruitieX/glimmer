export const meta = {
  name: "Halloween spider web",
  description: "A dewy spider web glinting in the moonlight while a red-eyed spider lowers itself on a thread and climbs back up.",
  category: "Seasonal",
  colors: [
    { id: "web", label: "Web", default: "#b4a8ff" },
    { id: "dew", label: "Dew", default: "#f0f4ff" },
    { id: "eyes", label: "Spider eyes", default: "#ff2a00" },
    { id: "night", label: "Night", default: "#0e0220" },
  ],
  params: {
    speed: { type: "number", label: "Speed", min: 0.2, max: 3, step: 0.01, default: 1 },
    spokes: { type: "number", label: "Spokes", min: 4, max: 12, step: 1, default: 6 },
    dew: { type: "number", label: "Dew", min: 0, max: 1, step: 0.01, default: 0.5 },
  },
};

const PERIOD = 24;
const SLOTS = 24;

export function loop(params) {
  return PERIOD / params.speed;
}

// Polar coordinates around the web's hub don't change: work them out once.
export function setup(ctx) {
  const { n, x, y, u, aspect } = ctx;
  const wide = aspect > 2.5;
  const s = { wide, r: new Float32Array(n), a: new Float32Array(n), off: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    if (wide) {
      s.r[i] = u[i] * (n - 1);
    } else {
      const dx = (x[i] - 0.45) * aspect, dy = y[i] - 0.58;
      s.r[i] = Math.sqrt(dx * dx + dy * dy);
      s.a[i] = Math.atan2(dy, dx);
    }
    s.off[i] = hash(i, 2) * SLOTS;
  }
  return s;
}

export function render(ctx, s) {
  const { n, x, y, out, colors, params, t, aspect } = ctx;
  const web = colors[0] || [0.7, 0.66, 1];
  const dew = colors[1] || [0.94, 0.96, 1];
  const eyes = colors[2] || [1, 0.16, 0];
  const night = colors[3] || [0.05, 0.01, 0.12];
  const p = (t * params.speed) / PERIOD;
  const spokes = params.spokes;
  const thr = params.dew * 0.3;
  // The spider drops, dangles and climbs back once per loop.
  const drop = smoothstep(0.05, 0.35, p) * (1 - smoothstep(0.65, 0.95, p));
  const bob = 0.02 * Math.sin(TAU * p * 6) * drop;
  // Moonlight slowly circles, lighting one side of the web then another.
  const lightA = TAU * p * 2;
  if (s.wide) {
    // Along a string: strands crossing every few LEDs, brightest where the
    // moonlight sweeps; the spider walks along on its thread and back.
    const span = Math.max(1, n - 1);
    const spos = 0.15 * span + drop * 0.7 * span + bob * span;
    for (let i = 0; i < n; i++) {
      const led = s.r[i];
      const v = Math.cos((TAU * led) / 7);
      const strand = Math.pow(0.5 + 0.5 * v, 6);
      const sweep = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.cos(TAU * (led / span) * 2 - lightA), 2);
      let k = 0.08 + strand * 0.55 * sweep;
      let r = night[0] + web[0] * k, g = night[1] + web[1] * k, b = night[2] + web[2] * k;
      if (strand > 0.6) {
        const q = p * SLOTS + s.off[i];
        const slot = Math.floor(q);
        if (hash(i * 43 + (slot % SLOTS), 9) < thr * 2) {
          const f = Math.sin(PI * (q - slot));
          const gk = f * f * f * 0.9;
          r += (dew[0] - r) * gk;
          g += (dew[1] - g) * gk;
          b += (dew[2] - b) * gk;
        }
      }
      // The thread behind the spider and the spider itself.
      if (led < spos) {
        r += web[0] * 0.12;
        g += web[1] * 0.12;
        b += web[2] * 0.12;
      }
      const d = led - spos;
      const body = Math.exp(-d * d * 0.35);
      r *= 1 - body * 0.9;
      g *= 1 - body * 0.9;
      b *= 1 - body * 0.9;
      const e = Math.exp(-(d - 1.6) * (d - 1.6) * 1.5);
      r += eyes[0] * e;
      g += eyes[1] * e;
      b += eyes[2] * e;
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  const sx = 0.78, sy = 1.02 - drop * 0.62 + bob;
  const ring = 0.16;
  for (let i = 0; i < n; i++) {
    const r0 = s.r[i], a = s.a[i];
    // Spokes: distance to the nearest radial line.
    const sa = fract((a * spokes) / TAU + 0.5) - 0.5;
    const dSpoke = r0 * Math.abs(Math.sin((sa * TAU) / spokes));
    // Rings: a spiral, so they meet the spokes at a slight angle.
    const sp = r0 / ring - a / TAU;
    const dRing = Math.abs(fract(sp + 0.5) - 0.5) * ring;
    const fade = smoothstep(0.6, 0.4, r0);
    const line = Math.max(Math.exp(-(dSpoke * dSpoke) / 0.0006), Math.exp(-(dRing * dRing) / 0.0005) * smoothstep(0.05, 0.12, r0)) * fade;
    const lit = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.cos(a - lightA), 2);
    const k = 0.03 + line * 0.65 * lit;
    let r = night[0] + web[0] * k, g = night[1] + web[1] * k, b = night[2] + web[2] * k;
    if (line > 0.5) {
      const q = p * SLOTS + s.off[i];
      const slot = Math.floor(q);
      if (hash(i * 43 + (slot % SLOTS), 9) < thr) {
        const f = Math.sin(PI * (q - slot));
        const gk = f * f * f * 0.9 * lit;
        r += (dew[0] - r) * gk;
        g += (dew[1] - g) * gk;
        b += (dew[2] - b) * gk;
      }
    }
    // The spider's thread and its dark body with two glowing eyes.
    const tx = (x[i] - sx) * aspect;
    const yi = y[i];
    if (yi > sy) {
      const th = Math.exp(-(tx * tx) / 0.0015) * 0.25;
      r += web[0] * th;
      g += web[1] * th;
      b += web[2] * th;
    }
    const dy = yi - sy;
    const body = Math.exp(-(tx * tx + dy * dy * 0.8) / 0.004);
    r *= 1 - body * 0.95;
    g *= 1 - body * 0.95;
    b *= 1 - body * 0.95;
    const ey = dy + 0.035;
    const e = Math.exp(-(tx * tx * 0.5 + ey * ey) / 0.0012);
    r += eyes[0] * e;
    g += eyes[1] * e;
    b += eyes[2] * e;
    const o = i * 3;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
  }
}
