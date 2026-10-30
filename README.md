# Twinkly

Live animations for [Twinkly](https://twinkly.com/) LED strings, controlled from a web app and from home automation over MQTT.

- **Effects are small JavaScript modules** run in a sandboxed QuickJS runtime on the server, 25–30 times a second. They see each LED's mapped position, so the same effect suits a curtain, a tree or a handrail. Built-in effects include aurora, plasma, fire, snowfall, twinkle and comets.
- **Write effects in the browser** with a live preview, version history, and an option to try a draft on a real string. Or describe one and let Claude write it.
- **Transitions are scripts too.** Each light has its own transition for turning on, turning off, and changing effect: wipes, blooms, dissolves, sparkles.
- **Split one string into several lights.** For example, the two handrails of a staircase curtain become separate lights with their own effects and their own MQTT device.
- **Stored movies.** Effects that loop can be rendered once and uploaded to the string, which then plays them smoothly even on patchy Wi-Fi. Transitions are still streamed live, and the hand-over between the two is seamless.
- **MQTT** follows the topics of [twinkly-mqtt](https://github.com/FruitieX/twinkly-mqtt), with added presets and multiple colours (see below).

Only Generation II strings (firmware 2.5.6 or later) are supported. The realtime and movie protocols are documented by the [xled project](https://xled-docs.readthedocs.io/).

## Running locally

```sh
nix develop
npm ci && npm run build
cargo run --manifest-path backend/Cargo.toml  # TWINKLY_DEV_LOGIN=1 for a local sign-in button
npm run dev                                    # UI with hot reload at http://localhost:3110
```

`node scripts/fake-twinkly.mjs` simulates a string at `127.0.0.1:8099`; add it in the app under that address. `npm run test:ui` runs the browser checks against it. `cargo run -- probe <ip> [seconds] [fps]` streams a test pattern to a real string and reports timing.

## Configuration

| Variable                                                                      | Meaning                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TWINKLY_ORIGIN`                                                              | Address the app is opened at, e.g. `https://twinkly.example.com`.                                                                                                                           |
| `TWINKLY_BIND`                                                                | Listen address (default `127.0.0.1:3111`).                                                                                                                                                  |
| `TWINKLY_DATA_DIR`                                                            | Where the SQLite database lives (default `data`).                                                                                                                                           |
| `TWINKLY_SQLITE_JOURNAL_MODE`                                                 | `WAL` (default) or `DELETE` (needed on NFS).                                                                                                                                                |
| `TWINKLY_OIDC_ISSUER`, `TWINKLY_OIDC_CLIENT_ID`, `TWINKLY_OIDC_CLIENT_SECRET` | OpenID Connect sign-in (e.g. Pocket ID). The callback is `<origin>/auth/callback`.                                                                                                          |
| `TWINKLY_OIDC_ALLOWED_GROUPS`                                                 | Comma-separated groups allowed to sign in.                                                                                                                                                  |
| `TWINKLY_DEV_LOGIN=1`                                                         | Local development sign-in without a provider.                                                                                                                                               |
| `TWINKLY_MQTT_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `_PREFIX`             | MQTT broker; prefix defaults to `home/lights/twinkly`.                                                                                                                                      |
| `ANTHROPIC_API_KEY`                                                           | Enables writing effects with Claude.                                                                                                                                                        |
| `TWINKLY_SEED`                                                                | JSON (or a path to it) with strings to add on first start, e.g. `[{"name": "Curtain", "ip": "192.0.2.20"}]`. Optional `"enabled": false` and `"fixtures": [{"id": "Upper", "start": 126}]`. |
| `TWINKLY_FEEDBACK_HUB`                                                        | Origin of an injected feedback widget, allowed by the CSP.                                                                                                                                  |

Strings, lights, presets and effects are all edited in the app.

## MQTT

Each light publishes its state, retained, on `<prefix>/<light id>`:

```json
{
  "id": "Curtain",
  "name": "Curtain",
  "power": true,
  "brightness": 0.6,
  "color": { "h": 30, "s": 0.58 },
  "colors": [
    { "h": 30, "s": 0.58 },
    { "h": 270, "s": 0.8 }
  ],
  "preset": "Aurora",
  "presets": ["Aurora", "Fire"],
  "effect": "aurora"
}
```

Commands go to `<prefix>/<light id>/set` and may contain any of these fields:

- `power`
- `brightness` (0–1)
- `color`: in any of homectl's forms (`{h,s}`, `{x,y}`, `{r,g,b}`, `{ct}`)
- `colors`: one per colour slot of the effect
- `preset`: a preset name
- `transition_ms` or `transition` (in seconds)

The available preset names are also published on `<prefix>/<light id>/presets`.

## Writing effects

See [docs/effects.md](docs/effects.md). The same guide is given to Claude when it writes effects.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## License

MIT, see [LICENSE](LICENSE).
