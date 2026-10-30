# Writing effects and transitions

Effects and transitions are small JavaScript (ES2023) modules. The server runs them in a sandboxed QuickJS runtime, once per frame, typically 20–30 times a second. There is no DOM, no `fetch`, no timers and no imports: a script only reads its inputs and writes colours.

## Effects

An effect exports `meta` and `render(ctx)`, and optionally `setup(ctx)` and `loop(params, colors)`.

```js
export const meta = {
  name: "Aurora",
  description: "Slow northern-lights curtains drifting sideways.",
  // Where the app lists it; one of the categories below.
  category: "Nature",
  // Optional: render at sub-LED offsets and average (see Smooth edges).
  antialias: false,
  // Colour slots the user (and homectl) can change. Defaults are "#rrggbb".
  colors: [
    { id: "glow", label: "Glow", default: "#2bff88" },
    { id: "edge", label: "Edge", default: "#7b2ff7" },
  ],
  // Settings shown as controls in the app.
  params: {
    speed: {
      type: "number",
      label: "Speed",
      min: 0,
      max: 2,
      step: 0.01,
      default: 0.25,
    },
    mirror: { type: "boolean", label: "Mirror", default: false },
    axis: {
      type: "select",
      label: "Direction",
      options: ["x", "y"],
      labels: ["Horizontal", "Vertical"],
      default: "x",
    },
  },
};

// Optional: seconds after which the effect repeats exactly. Export it only
// when rendering is a pure function of ctx.t (no state kept between frames);
// it lets the app store the effect on the string as a looping movie.
export function loop(params, colors) {
  return 20 / params.speed;
}

// Optional: runs once; its return value is passed to render as `state`.
export function setup(ctx) {
  return { drops: [] };
}

export function render(ctx, state) {
  const { n, x, y, out, colors, params, t } = ctx;
  for (let i = 0; i < n; i++) {
    out.set(mix(colors[0], colors[1], y[i]), i * 3);
  }
}
```

### `ctx`

| Field         | Meaning                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `n`           | Number of LEDs in the fixture.                                                                                                                                                   |
| `x`, `y`, `z` | `Float32Array`s of LED positions, each normalised to 0..1 across the fixture: `x` left→right, `y` bottom→top, `z` back→front. Flat or unmapped fixtures have 0.5 on unused axes. |
| `u`           | `Float32Array`, position along the wire, 0 at the first LED and 1 at the last.                                                                                                   |
| `aspect`      | Width / height of the fixture before normalisation.                                                                                                                              |
| `spacing`     | Typical distance between neighbouring LEDs in the same 0..1 units, e.g. for edges one LED wide.                                                                                  |
| `t`           | Seconds since the effect started.                                                                                                                                                |
| `dt`          | Seconds since the previous frame.                                                                                                                                                |
| `params`      | Current parameter values (defaults filled in).                                                                                                                                   |
| `colors`      | Current colours, `[r, g, b]` arrays in 0..1, one per slot in `meta.colors`.                                                                                                      |
| `out`         | `Float32Array` of length `n * 3` to fill with `r, g, b` per LED, 0..1. It is cleared to black before every call.                                                                 |

Values are perceptual (like CSS colours); the app applies brightness, gamma, white balance and the RGBW white channel afterwards. Keep `render` fast: a frame should take well under a millisecond for a few hundred LEDs. Allocate arrays in `setup`, not per frame. A script that runs longer than 250 ms is stopped.

Prefer smooth motion and gentle colour, avoid harsh full-brightness strobing, and make every parameter visibly change something. Use `ctx.t` rather than counting frames so the speed doesn't depend on the frame rate. Use `ctx.dt` only for simulations that keep state.

### Categories

Set `meta.category` to one of: `Basics`, `Gradients & patterns`, `Plasma & flow`, `Nature`, `Particles & physics`, `Simulations & games`, `Fractals`, `Seasonal`, `Images`.

### Smooth edges

LEDs are few and far apart, so anything sharp (a comet's head, a bar's edge, a dot) jumps from LED to LED and steps visibly as it moves. There are two ways to avoid that:

- Draw soft shapes yourself: fade brightness over about one `ctx.spacing` (or one LED along `u`, which is `1 / (n - 1)`), for example `smoothstep(edge - ctx.spacing, edge + ctx.spacing, x[i])` instead of `x[i] > edge`.
- Or set `meta.antialias: true`. The app then renders every frame four times with the LED positions (`x`, `y`, `u`) moved slightly within each LED's area and averages the results, so a hard edge covers an LED partially as it moves. This costs four renders per frame. Only use it for effects whose `render` is a pure function of `ctx` (no state changed between frames).

### Simulations and state

Effects that simulate (particles, fluids, cellular automata, games) keep their state in the object returned by `setup(ctx)` and advance it in `render` using `ctx.dt` (seconds since the previous frame, which varies). Step at a fixed rate when the rules need it, e.g. accumulate `dt` and run one game tick every 0.15 s. Don't export `loop` or set `antialias` for such effects. Map the simulation onto LEDs by position (`x`, `y`), not by index, so it suits any layout. A grid of about 10 × 20 cells usually matches a curtain.

### Images

`image(id)` returns an uploaded image or GIF (`width`, `height`, `frames`, `delays`, `duration` in seconds), `imageFrame(img, t)` picks the frame for a time, and `sampleImage(img, frame, x, y)` returns its colour at a position (0..1, y up). Effects made with "Create from GIF" use these; the id is fixed in the generated script.

### Parameter types

- `number`: `min`, `max`, `step`, `default`, optional `label` and `unit`.
- `boolean`: `default`, `label`.
- `select`: `options` (values), optional `labels`, `default`.

## Transitions

A transition blends from one picture to the next. It exports `meta` (with `params`, no colours) and `render(ctx)`. The `ctx` has everything above (without `colors`), plus:

| Field      | Meaning                                                            |
| ---------- | ------------------------------------------------------------------ |
| `a`        | `Float32Array` (`n * 3`): the old picture, black when turning on.  |
| `b`        | `Float32Array` (`n * 3`): the new picture, black when turning off. |
| `progress` | 0 at the start, 1 at the end (linear; apply easing yourself).      |
| `t`        | Seconds since the transition started.                              |

At `progress` 0 the output must equal `a`, and at 1 it must equal `b`.

```js
export const meta = {
  name: "Crossfade",
  description: "Blends smoothly.",
  params: {},
};
export function render(ctx) {
  const { a, b, out, progress } = ctx;
  const p = ease.inOut(progress);
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * p;
}
```

## Helpers (globals)

- `PI`, `TAU`
- `clamp(v, lo = 0, hi = 1)`, `fract(v)`, `lerp(a, b, t)`, `smoothstep(e0, e1, v)`
- `mix(c1, c2, t)`, `scale(c, k)`: colours as `[r, g, b]`
- `hsv(h, s = 1, v = 1)`: hue 0..1 (wraps); returns `[r, g, b]`
- `hex("#rrggbb")` → `[r, g, b]`
- `palette(colors, t, cyclic = false)`: samples a gradient through a list of colours
- `hash(i, seed = 0)`: deterministic pseudo-random number in 0..1 for an integer
- `noise(x, y = 0, z = 0)`: smooth Perlin noise, roughly -1..1
- `ease.linear`, `ease.in`, `ease.out`, `ease.inOut`

`Math.random()` works, but `hash` gives repeatable patterns and keeps loops seamless.
