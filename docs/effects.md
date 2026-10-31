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
  // Named looks shown as one-tap choices next to the defaults (see Looks).
  looks: [
    { name: "Ember", params: { speed: 0.5 }, colors: ["#ff6a00", "#c0103a"] },
    {
      name: "Ice",
      params: { speed: 0.15, mirror: true },
      colors: ["#7fe8ff", "#2a4dff"],
    },
    { name: "Neon", params: { speed: 1.2 }, colors: ["#39ff14", "#ff00d4"] },
  ],
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

| Field         | Meaning                                                                                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `n`           | Number of LEDs in the fixture.                                                                                                                                                                                                                  |
| `x`, `y`, `z` | `Float32Array`s of LED positions, each normalised to 0..1 across the fixture: `x` left→right, `y` bottom→top, `z` back→front. Flat or unmapped fixtures have 0.5 on unused axes. With a light's effect size (below) they can reach beyond 0..1. |
| `u`           | `Float32Array`, position along the light, 0 at one end and 1 at the other: the LED order, or the physical order on lights laid out along their length (see below).                                                                              |
| `aspect`      | Width / height of the fixture before normalisation.                                                                                                                                                                                             |
| `spacing`     | Typical distance between neighbouring LEDs in the same units as `x`/`y`, e.g. for edges one LED wide.                                                                                                                                           |
| `t`           | Seconds since the effect started.                                                                                                                                                                                                               |
| `dt`          | Seconds since the previous frame.                                                                                                                                                                                                               |
| `params`      | Current parameter values (defaults filled in).                                                                                                                                                                                                  |
| `colors`      | Current colours, `[r, g, b]` arrays in 0..1, one per slot in `meta.colors`.                                                                                                                                                                     |
| `out`         | `Float32Array` of length `n * 3` to fill with `r, g, b` per LED, 0..1. It is cleared to black before every call.                                                                                                                                |

### Lights of every shape and size

Size features relative to `ctx.spacing` or to the 0..1 world, and don't assume a particular number or density of LEDs:

- A light set to "Along its length" (a string zigzagging up a banister, say) arrives as a clean strip: `x` and `u` are each LED's place along its main direction (bottom to top, or left to right when level), `y` and `z` are a flat 0.5, `aspect` is large, and neighbouring LEDs in `u` aren't neighbours in index. Work along `u` (or `x`) there, not along the LED index.
- Each light has an effect size (0.25–4) that zooms the positions about the centre: at 2, `x`, `y`, `z`, `u` and `spacing` are halved around 0.5 (features look twice as big); at 0.5 they double, so LEDs lie outside 0..1 and more of the effect shows. `aspect` stays. Effects that look things up by position (grids, cells, lookup tables) must clamp or wrap it, e.g. with `tile`. Transitions always see the light at size 1.

Values are perceptual (like CSS colours); the app applies brightness, gamma, white balance and the RGBW white channel afterwards. Keep `render` fast: a frame should take well under a millisecond for a few hundred LEDs. Allocate arrays in `setup`, not per frame. A script that runs longer than 250 ms is stopped.

Prefer smooth motion and gentle colour, avoid harsh full-brightness strobing, and make every parameter visibly change something. Use `ctx.t` rather than counting frames so the speed doesn't depend on the frame rate. Use `ctx.dt` only for simulations that keep state.

### Categories

Set `meta.category` to one of: `Basics`, `Gradients & patterns`, `Plasma & flow`, `Nature`, `Particles & physics`, `Simulations & games`, `Fractals`, `Seasonal`, `Images`.

### Looks

`meta.looks` lists named variations of the effect that the app offers as one-tap choices, next to "Default" (the defaults themselves). Each look has:

- `name`: short and evocative, one or two words ("Ember", "Deep sea", "Pastel"), unique within the effect and not "Default".
- `params`: only the settings that differ from their defaults; picking the look resets every other setting to its default. Values must be allowed by the parameter (within `min`..`max`, one of a select's `options`, `true`/`false`).
- `colors`: one `"#rrggbb"` per colour slot, in the order of `meta.colors` (`[]` when the effect has none).

A look that doesn't fit the params or colour slots makes the check fail with a message saying why. Give every effect with colours or settings 3–4 looks that clearly differ from the defaults and from each other: change the palette to suit the effect (a fire look in reds and oranges, an ocean look in blues and teals; seasonal effects keep their season's colours) and vary speed, size or density where that makes the look distinct (a slow, calm look and a lively one). LEDs are additive and saturated: keep foreground colours vivid and bright, and backgrounds dark; muddy dark colours and pale greys look dim on LEDs.

### Smooth edges

LEDs are few and far apart, so anything sharp (a comet's head, a bar's edge, a dot) jumps from LED to LED and steps visibly as it moves. There are two ways to avoid that:

- Draw soft shapes yourself: fade brightness over about one `ctx.spacing` (or one LED along `u`, about `1 / (n - 1)` at effect size 1), for example `smoothstep(edge - ctx.spacing, edge + ctx.spacing, x[i])` instead of `x[i] > edge`.
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

At `progress` 0 the output must equal `a`, and at 1 it must equal `b`, so glows, flashes and distortions must fade to nothing at both ends (multiply them by `Math.sin(PI * progress)`, for example).

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

A transition may also export `setup(ctx)` (with `ctx.params` already filled in) to precompute per-LED values; its return value is passed to `render` as the second argument. A new instance runs for every transition, so `setup` sees the settings it is used with.

Transitions run on curtains and on plain strings alike. On a string `y` doesn't vary (or `x` doesn't, when it hangs), so a wipe upwards or a circle from the middle would do nothing or everything at once: when `sampler(ctx).line` is true, work along `u` instead. Soften every moving edge over at least about one LED (`ctx.spacing * 1.5`, or `s.su` along `u`) with `smoothstep`, rather than using `meta.antialias`.

To move, zoom or warp the pictures themselves (slide the old look out, ripple it), read `a` and `b` between LEDs with `sampler(ctx)` (see Helpers), created once in `setup`:

```js
export function setup(ctx) {
  return { s: sampler(ctx), rgb: [0, 0, 0] };
}
export function render(ctx, st) {
  const { n, x, y, u, a, b, out, progress } = ctx;
  const soft = ctx.spacing * 1.5;
  const p = ease.inOut(progress) * (1 + soft);
  for (let i = 0; i < n; i++) {
    // The old look slides out to the left; the new one stays put behind it.
    const from = (st.s.line ? u[i] : x[i]) + p;
    const k = smoothstep(1, 1 + soft, from);
    if (st.s.line) st.s.along(a, from, st.rgb);
    else st.s.at(a, from, y[i], st.rgb);
    for (let c = 0; c < 3; c++)
      out[i * 3 + c] = st.rgb[c] + (b[i * 3 + c] - st.rgb[c]) * k;
  }
}
```

Each light picks its transitions in the app; a slot (turning on, turning off, changing effect, or a playlist's changes) can hold several, and one of them is picked at random each time.

## Helpers (globals)

- `PI`, `TAU`
- `clamp(v, lo = 0, hi = 1)`, `fract(v)`, `lerp(a, b, t)`, `smoothstep(e0, e1, v)`
- `tile(v)`: a position outside 0..1 wrapped back into it (0..1 itself unchanged), for repeating a grid beyond the edges
- `mix(c1, c2, t)`, `scale(c, k)`: colours as `[r, g, b]`
- `hsv(h, s = 1, v = 1)`: hue 0..1 (wraps); returns `[r, g, b]`
- `hex("#rrggbb")` → `[r, g, b]`
- `palette(colors, t, cyclic = false)`: samples a gradient through a list of colours
- `hash(i, seed = 0)`: deterministic pseudo-random number in 0..1 for an integer
- `noise(x, y = 0, z = 0)`: smooth Perlin noise, roughly -1..1
- `ease.linear`, `ease.in`, `ease.out`, `ease.inOut`
- `sampler(ctx)`: reads a frame (an `n * 3` array, such as a transition's `a` or `b`) at any position by blending the nearby LEDs; at an LED's own position it gives exactly that LED. Create it in `setup`; it returns `{ line, sx, sy, su, at(frame, x, y, rgb), along(frame, u, rgb) }`. `at` and `along` write the colour into `rgb` (an `[r, g, b]` array you reuse) and return it; positions outside the light are clamped. `line` is true when the fixture is a line, `sx`/`sy` are the typical gaps between neighbouring LEDs sideways and up/down, and `su` is one LED along `u` (`along` blends the LEDs nearest in `u`, whatever their index). Each read costs about as much as a few dozen arithmetic operations, so read each frame at most two or three times per LED.

`Math.random()` works, but `hash` gives repeatable patterns and keeps loops seamless.
