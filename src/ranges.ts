// How a string's LEDs are split into lights: drawing positions, validation and
// hints for split points that look off. Pure functions, unit-tested in
// ranges.test.ts.

export type Point3 = [number, number, number];

/** A light's LED range on its string. */
export interface Range {
  id: string;
  name: string;
  start: number;
  count: number;
}

/** Distinct colours for the lights on one string, in LED order. */
export const LIGHT_COLORS = [
  "#ffb547",
  "#7cc7ff",
  "#ff5f8a",
  "#4ade80",
  "#c084fc",
  "#facc15",
  "#2dd4bf",
  "#fb923c",
];

/**
 * The string's mapped LED positions, or null when it has no usable mapping
 * (none read yet, a "linear" one, or fewer points than LEDs).
 */
export function mappedPoints(
  layout: { source: string; coordinates: unknown[] } | null | undefined,
  ledCount: number,
): Point3[] | null {
  if (!layout || layout.source === "linear") return null;
  if (layout.coordinates.length < ledCount || ledCount === 0) return null;
  const points: Point3[] = [];
  for (const c of layout.coordinates.slice(0, ledCount)) {
    const p = c as { x?: unknown; y?: unknown; z?: unknown };
    if (typeof p?.x !== "number" || typeof p?.y !== "number") return null;
    points.push([p.x, p.y, typeof p.z === "number" ? p.z : 0]);
  }
  return points;
}

/**
 * 2D drawing positions for every LED, x right and y down in 0..1 of a box
 * whose width / height is `aspect`. Mapped strings are seen from the front;
 * without a mapping the LEDs run in rows like text.
 */
export function drawPositions(
  points: Point3[] | null,
  ledCount: number,
  perRow = 50,
): { xy: [number, number][]; aspect: number } {
  if (!points) {
    const cols = Math.max(1, Math.min(perRow, ledCount));
    const rows = Math.max(1, Math.ceil(ledCount / cols));
    const xy: [number, number][] = [];
    for (let i = 0; i < ledCount; i++)
      xy.push([
        cols > 1 ? (i % cols) / (cols - 1) : 0.5,
        rows > 1 ? Math.floor(i / cols) / (rows - 1) : 0.5,
      ]);
    return { xy, aspect: rows > 1 ? cols / (rows * 1.6) : 6 };
  }
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const w = x1 - x0;
  const h = y1 - y0;
  const xy = points.map(
    ([x, y]) =>
      [w > 1e-6 ? (x - x0) / w : 0.5, h > 1e-6 ? (y1 - y) / h : 0.5] as [
        number,
        number,
      ],
  );
  const aspect = w > 1e-6 && h > 1e-6 ? w / h : w > 1e-6 ? 6 : 0.25;
  return { xy, aspect };
}

/** Index into `ranges` of the light owning each LED, -1 when none does. */
export function owners(ranges: Range[], ledCount: number): number[] {
  const out = new Array<number>(ledCount).fill(-1);
  ranges.forEach((r, i) => {
    for (let j = r.start; j < r.start + r.count && j < ledCount; j++)
      if (j >= 0 && out[j] === -1) out[j] = i;
  });
  return out;
}

/** What is wrong with a set of ranges, or null when they can be saved. */
export function rangeProblem(ranges: Range[], ledCount: number): string | null {
  for (const r of ranges) {
    if (!Number.isInteger(r.start) || !Number.isInteger(r.count))
      return `${r.name} needs whole LED numbers.`;
    if (r.count < 1) return `${r.name} needs at least one LED.`;
    if (r.start < 0 || (ledCount > 0 && r.start + r.count > ledCount))
      return `${r.name} goes past the string's last LED (${ledCount - 1}).`;
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (b.start < a.start + a.count)
      return `${a.name} and ${b.name} share LEDs ${b.start}–${Math.min(a.start + a.count, b.start + b.count) - 1}.`;
  }
  return null;
}

/** A boundary between two lights whose ranges touch: `before` ends where `after` starts. */
export interface Boundary {
  before: number;
  after: number;
  /** First LED of `after`. */
  at: number;
}

export function boundaries(ranges: Range[]): Boundary[] {
  const order = ranges
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.start - b.r.start);
  const out: Boundary[] = [];
  for (let k = 1; k < order.length; k++) {
    const a = order[k - 1];
    const b = order[k];
    if (a.r.start + a.r.count === b.r.start)
      out.push({ before: a.i, after: b.i, at: b.r.start });
  }
  return out;
}

/** Moves a boundary so `after` starts at `at`, keeping one LED in each light. */
export function moveBoundary(
  ranges: Range[],
  boundary: Boundary,
  at: number,
): Range[] {
  const a = ranges[boundary.before];
  const b = ranges[boundary.after];
  const end = b.start + b.count;
  const clamped = Math.min(end - 1, Math.max(a.start + 1, Math.round(at)));
  return ranges.map((r, i) =>
    i === boundary.before
      ? { ...r, count: clamped - a.start }
      : i === boundary.after
        ? { ...r, start: clamped, count: end - clamped }
        : r,
  );
}

/** LEDs at the edge of a light that sit apart from the rest of it. */
export interface Outlier {
  /** Index into the ranges of the light they are in. */
  light: number;
  /** The stray LEDs, in LED order. */
  leds: number[];
  /** The touching light they are probably part of, if they are nearer to it. */
  neighbour: number | null;
}

const dist = (a: Point3, b: Point3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Shortest distance from any LED in `group` to any in `rest`. */
function gap(points: Point3[], group: number[], rest: number[]) {
  let best = Infinity;
  for (const g of group)
    for (const r of rest) best = Math.min(best, dist(points[g], points[r]));
  return best;
}

/**
 * Finds lights whose first or last few LEDs (up to `maxGroup`) sit far from
 * the rest of the light: further than `factor` times the light's median
 * nearest-neighbour distance. That usually means the split point is off by
 * that many LEDs, or the mapping has a stray point. The smallest such group
 * at each end is reported.
 */
export function findOutliers(
  points: Point3[],
  ranges: Range[],
  { factor = 4, maxGroup = 4 } = {},
): Outlier[] {
  const out: Outlier[] = [];
  const touching = boundaries(ranges);
  ranges.forEach((r, light) => {
    if (r.count < 4 || r.start < 0 || r.start + r.count > points.length) return;
    const leds = Array.from({ length: r.count }, (_, i) => r.start + i);
    const nearest = leds.map((i) => {
      let best = Infinity;
      for (const j of leds)
        if (j !== i) best = Math.min(best, dist(points[i], points[j]));
      return best;
    });
    const typical = median(nearest);
    if (!(typical > 0)) return;
    for (const end of ["first", "last"] as const) {
      // Keep at least twice as many LEDs as the group in the rest.
      const most = Math.min(maxGroup, Math.floor((r.count - 1) / 3));
      for (let k = 1; k <= most; k++) {
        const group = end === "first" ? leds.slice(0, k) : leds.slice(-k);
        const rest = end === "first" ? leds.slice(k) : leds.slice(0, -k);
        const apart = gap(points, group, rest);
        if (apart <= factor * typical) continue;
        const b = touching.find((t) =>
          end === "first" ? t.after === light : t.before === light,
        );
        let neighbour: number | null = null;
        if (b) {
          const other = end === "first" ? b.before : b.after;
          const o = ranges[other];
          const theirs = Array.from({ length: o.count }, (_, i) => o.start + i);
          if (o.count > k && gap(points, group, theirs) < apart)
            neighbour = other;
        }
        out.push({ light, leds: group, neighbour });
        break;
      }
    }
  });
  return out;
}

/** Ranges with an outlier group handed to its neighbour. */
export function fixOutlier(ranges: Range[], o: Outlier): Range[] {
  if (o.neighbour === null) return ranges;
  const b = boundaries(ranges).find(
    (t) =>
      (t.before === o.neighbour && t.after === o.light) ||
      (t.before === o.light && t.after === o.neighbour),
  );
  if (!b) return ranges;
  const k = o.leds.length;
  return moveBoundary(ranges, b, b.after === o.light ? b.at + k : b.at - k);
}

/** "LED 137" or "LEDs 136–137". */
export function ledsLabel(leds: number[]) {
  return leds.length === 1
    ? `LED ${leds[0]}`
    : `LEDs ${leds[0]}–${leds[leds.length - 1]}`;
}
