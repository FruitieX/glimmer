// Run with `npm test` (Node's test runner, which strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundaries,
  drawPositions,
  findOutliers,
  fixOutlier,
  mappedPoints,
  moveBoundary,
  owners,
  rangeProblem,
  type Point3,
  type Range,
} from "./ranges.ts";

/** Two flights of 10 LEDs each with a landing between them. */
function staircase(): Point3[] {
  const lower = Array.from(
    { length: 10 },
    (_, i) => [i * 0.1, i * 0.1, 0] as Point3,
  );
  const upper = Array.from(
    { length: 10 },
    (_, i) => [1.5 - i * 0.1, 1.2 + i * 0.1, 0] as Point3,
  );
  return [...lower, ...upper];
}

const split = (at: number, n = 20): Range[] => [
  { id: "lower", name: "Lower", start: 0, count: at },
  { id: "upper", name: "Upper", start: at, count: n - at },
];

test("a split at the landing has no outliers", () => {
  assert.deepEqual(findOutliers(staircase(), split(10)), []);
});

test("a split one LED early leaves the lower flight's last LED in upper", () => {
  const ranges = split(9);
  const found = findOutliers(staircase(), ranges);
  assert.deepEqual(found, [{ light: 1, leds: [9], neighbour: 0 }]);
  const fixed = fixOutlier(ranges, found[0]);
  assert.deepEqual(
    fixed.map((r) => [r.start, r.count]),
    [
      [0, 10],
      [10, 10],
    ],
  );
  assert.deepEqual(findOutliers(staircase(), fixed), []);
});

test("a split two LEDs late hands both back in one go", () => {
  const ranges = split(12);
  const found = findOutliers(staircase(), ranges);
  assert.deepEqual(found, [{ light: 0, leds: [10, 11], neighbour: 1 }]);
  assert.deepEqual(
    fixOutlier(ranges, found[0]).map((r) => r.start),
    [0, 10],
  );
});

test("a stray mapping point with no neighbour is reported without a fix", () => {
  const points = staircase().slice(0, 10);
  points[0] = [5, 5, 0];
  const ranges: Range[] = [{ id: "a", name: "A", start: 0, count: 10 }];
  const found = findOutliers(points, ranges);
  assert.deepEqual(found, [{ light: 0, leds: [0], neighbour: null }]);
  assert.equal(fixOutlier(ranges, found[0]), ranges);
});

test("curtain strands split between columns are not outliers", () => {
  // 4 strands of 10 LEDs, 0.1 apart down a strand and 0.2 between strands.
  const points = Array.from(
    { length: 40 },
    (_, i) => [Math.floor(i / 10) * 0.2, 1 - (i % 10) * 0.1, 0] as Point3,
  );
  assert.deepEqual(findOutliers(points, split(21, 40)), []);
});

test("boundaries only join touching lights and moves keep one LED each", () => {
  const ranges: Range[] = [
    { id: "a", name: "A", start: 0, count: 5 },
    { id: "c", name: "C", start: 12, count: 3 },
    { id: "b", name: "B", start: 5, count: 5 },
  ];
  const bs = boundaries(ranges);
  assert.deepEqual(bs, [{ before: 0, after: 2, at: 5 }]);
  const moved = moveBoundary(ranges, bs[0], 100);
  assert.deepEqual(moved[0], { ...ranges[0], count: 9 });
  assert.deepEqual(moved[2], { ...ranges[2], start: 9, count: 1 });
  assert.deepEqual(moveBoundary(ranges, bs[0], -3)[0].count, 1);
  assert.deepEqual(
    owners(ranges, 16),
    [0, 0, 0, 0, 0, 2, 2, 2, 2, 2, -1, -1, 1, 1, 1, -1],
  );
});

test("range problems: overlaps, empty lights and LEDs past the end", () => {
  assert.equal(rangeProblem(split(10), 20), null);
  assert.match(
    rangeProblem(
      [
        { id: "a", name: "A", start: 0, count: 6 },
        { id: "b", name: "B", start: 5, count: 5 },
      ],
      20,
    ) ?? "",
    /A and B share LEDs 5–5/,
  );
  assert.match(rangeProblem(split(0), 20) ?? "", /at least one LED/);
  assert.match(rangeProblem(split(10, 21), 20) ?? "", /past/);
});

test("drawing positions", () => {
  const mapped = mappedPoints(
    {
      source: "2d",
      coordinates: [
        { x: -1, y: 1, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
    },
    2,
  );
  assert.deepEqual(drawPositions(mapped, 2), {
    xy: [
      [0, 0],
      [1, 1],
    ],
    aspect: 2,
  });
  assert.equal(mappedPoints({ source: "linear", coordinates: [] }, 2), null);
  assert.equal(mappedPoints({ source: "2d", coordinates: [{}] }, 2), null);
  const line = drawPositions(null, 120);
  assert.deepEqual(line.xy[50], [0, 0.5]);
});
