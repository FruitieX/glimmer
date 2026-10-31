# Glimmer

Live animations for [Twinkly](https://twinkly.com/) LED strings, controlled from a web app and from home automation over MQTT.

- **Effects are small JavaScript modules** run in a sandboxed QuickJS runtime on the server, 25–30 times a second. They see each LED's mapped position, so the same effect suits a curtain, a tree or a handrail. Built-in effects include aurora, plasma, fire, snowfall, twinkle and comets.
- **Write effects in the browser** with a live preview, version history, and an option to try a draft on a real string. Or describe one and let an AI write it.
- **Transitions are scripts too.** Each light has its own transition for turning on, turning off, and changing effect: wipes, blooms, dissolves, sparkles.
- **Playlists** let effects take turns, each for its own time, in order or shuffled. A light plays one like an effect, and the string keeps streaming live (no movie per entry). Built-in seasonal playlists (Halloween, Christmas, Independence Day, New Year, Valentine's, Easter, Vappu, Juhannus and the four seasons) start by themselves on the first day of their window and hand back whatever the light showed before when it ends, unless someone picked something else meanwhile; shorter windows nest inside longer ones. Their schedule, dates, lights and effects can all be changed, and effects can be switched off one by one.
- **Split one string into several lights.** For example, the two handrails of a staircase curtain become separate lights with their own effects and their own MQTT device.
- **Stored movies.** Effects that loop can be rendered once and uploaded to the string, which then plays them smoothly even on patchy Wi-Fi. Transitions are still streamed live, and the hand-over between the two is seamless.
- **MQTT** follows the topics of [twinkly-mqtt](https://github.com/FruitieX/twinkly-mqtt), with added presets and multiple colours (see below).

Only Generation II strings (firmware 2.5.6 or later) are supported. The realtime and movie protocols are documented by the [xled project](https://xled-docs.readthedocs.io/).

## Running locally

```sh
nix develop
npm ci && npm run build
cargo run --manifest-path backend/Cargo.toml  # GLIMMER_DEV_LOGIN=1 for a local sign-in button
npm run dev                                    # UI with hot reload at http://localhost:3110
```

`node scripts/fake-twinkly.mjs` simulates a string at `127.0.0.1:8099`; add it in the app under that address. `npm run test:ui` runs the browser checks against it. `cargo run -- probe <ip> [seconds] [fps]` streams a test pattern to a real string and reports timing.

## Configuration

| Variable                                                                      | Meaning                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GLIMMER_ORIGIN`                                                              | Address the app is opened at, e.g. `https://glimmer.example.com`.                                                                                                                           |
| `GLIMMER_BIND`                                                                | Listen address (default `127.0.0.1:3111`).                                                                                                                                                  |
| `GLIMMER_DATA_DIR`                                                            | Where the SQLite database lives (default `data`).                                                                                                                                           |
| `GLIMMER_SQLITE_JOURNAL_MODE`                                                 | `WAL` (default) or `DELETE` (needed on NFS).                                                                                                                                                |
| `GLIMMER_OIDC_ISSUER`, `GLIMMER_OIDC_CLIENT_ID`, `GLIMMER_OIDC_CLIENT_SECRET` | OpenID Connect sign-in (e.g. Pocket ID). The callback is `<origin>/auth/callback`.                                                                                                          |
| `GLIMMER_OIDC_ALLOWED_GROUPS`                                                 | Comma-separated groups allowed to sign in.                                                                                                                                                  |
| `GLIMMER_DEV_LOGIN=1`                                                         | Local development sign-in without a provider.                                                                                                                                               |
| `GLIMMER_MQTT_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `_PREFIX`             | MQTT broker; prefix defaults to `home/lights/twinkly`.                                                                                                                                      |
| `GLIMMER_AI_URL`, `GLIMMER_AI_KEY`, `GLIMMER_AI_MODEL`                        | An OpenAI-compatible chat completions endpoint (e.g. a Hermes agent, model `hermes-agent`) that writes effects.                                                                             |
| `GLIMMER_SEED`                                                                | JSON (or a path to it) with strings to add on first start, e.g. `[{"name": "Curtain", "ip": "192.0.2.20"}]`. Optional `"enabled": false` and `"fixtures": [{"id": "Upper", "start": 126}]`. |
| `GLIMMER_TZ`                                                                  | IANA time zone in which seasonal playlists start and end, e.g. `Europe/Helsinki`. Falls back to `TZ`, then UTC.                                                                             |
| `GLIMMER_FEEDBACK_HUB`                                                        | Origin of an injected feedback widget, allowed by the CSP.                                                                                                                                  |

Strings, lights, presets, playlists and effects are all edited in the app.

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
  "presets": ["Aurora", "Fire", "Playlist: Christmas", "Playlist: Everyday"],
  "effect": "aurora"
}
```

Commands go to `<prefix>/<light id>/set` and may contain any of these fields:

- `power`
- `brightness` (0–1)
- `color`: in any of homectl's forms (`{h,s}`, `{x,y}`, `{r,g,b}`, `{ct}`)
- `colors`: one per colour slot of the effect
- `preset`: a preset name, or `Playlist: <name>` to play a playlist (`preset` in the state then names the playlist)
- `transition_ms` or `transition` (in seconds)

The available preset and playlist names are also published on `<prefix>/<light id>/presets`.

## Playlists

Playlists are managed under `/api/playlists` (`GET`, `POST`, and `PUT`/`DELETE` on `/api/playlists/<id>`) and included in `/api/state`:

```json
{
  "name": "Christmas",
  "shuffle": true,
  "season": { "from": "12-01", "to": "12-27" },
  "autoEnabled": true,
  "lights": null,
  "entries": [
    {
      "scriptId": "xmas-classic-lights",
      "presetId": null,
      "params": {},
      "colors": [],
      "durationS": 150,
      "enabled": true
    }
  ]
}
```

`season` is `null`, `MM-DD` dates (which may wrap over the new year), `{"easter": [-7, 1]}` (days around Easter Sunday) or `{"midsummer": [-1, 2]}` (days around Midsummer Eve, the Friday from 19 to 25 June). With `autoEnabled`, the playlist switches the chosen `lights` (all when `null`) to itself at the start of each window, without touching their power, and at the end puts back what they showed before, if they are still on it. Each light gets this once per window, and lights added during a window join from its next start. Set a light's playlist with `{"playlist": "<id or name>"}` on `/api/fixtures/<id>/state`; picking an effect or preset ends it.

## Writing effects

See [docs/effects.md](docs/effects.md). The same guide is given to the AI when it writes effects.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Trademarks

Glimmer is an independent project and is not affiliated with or endorsed by Twinkly or LEDWORKS. "Twinkly" is used only to name the devices it works with.

## License

MIT, see [LICENSE](LICENSE).
