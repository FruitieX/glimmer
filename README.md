# Glimmer

Live animations for [Twinkly](https://twinkly.com/) LED strings and [LIFX](https://www.lifx.com/) bulbs, controlled from a web app and from home automation over MQTT.

- **Effects are small JavaScript modules** run in a sandboxed QuickJS runtime on the server, 25–30 times a second. They see each LED's mapped position, so the same effect suits a curtain, a tree or a handrail. Built-in effects include aurora, plasma, fire, snowfall, twinkle and comets.
- **Write effects in the browser** with a live preview, version history, and an option to try a draft on a real string. Or describe one and let an AI write it.
- **An AI assistant** (optional) also names presets, suggests settings for an effect ("warmer and slower") and builds playlists from a description. Anything that changes more than one thing is shown for approval first; see [AI assistant](#ai-assistant).
- **Transitions are scripts too.** Settings holds the transitions for all lights for turning on, turning off, and changing effect, and any light can have its own instead (in its settings, the gear on the light): wipes, irises, blinds, curtains, burns, melts, ripples, mosaics, glitches, starbursts and more. Give a slot several and one is picked at random each time, never the same twice in a row; a playlist can bring its own for the changes between its entries.
- **Playlists** let effects take turns, each for its own time, in order or shuffled. A light plays one like an effect, and the string keeps streaming live (no movie per entry). Built-in seasonal playlists (Halloween, Christmas, Independence Day, New Year, Valentine's, Easter, Vappu, Juhannus and the four seasons) start by themselves on the first day of their window and hand back whatever the light showed before when it ends, unless someone picked something else meanwhile; shorter windows nest inside longer ones. Their schedule, dates, lights and effects can all be changed, and effects can be switched off one by one.
- **Twinkly strings and LIFX bulbs.** Strings stream over Twinkly's realtime protocol. LIFX bulbs are driven over the LAN protocol; a Candle Colour's 26 zones get their own layout, and near-white colours are sent as a temperature for the tunable white LEDs rather than approximated with RGB.
- **Split one string into several lights.** For example, the two handrails of a staircase curtain become separate lights with their own effects and their own MQTT device. The string's settings draw every LED where the Twinkly app mapped it, coloured by light, so boundaries can be moved LED by LED without lighting the string, and a light whose first or last LEDs sit apart from the rest gets a hint to move them to its neighbour.
- **Stored movies.** Effects that loop can be rendered once and uploaded to the string, which then plays them smoothly even on patchy Wi-Fi. Transitions are still streamed live, and the hand-over between the two is seamless.
- **MQTT** follows the topics of [twinkly-mqtt](https://github.com/FruitieX/twinkly-mqtt), with added presets and multiple colours (see below).

Twinkly: only Generation II strings (firmware 2.5.6 or later). The realtime and movie protocols are documented by the [xled project](https://xled-docs.readthedocs.io/). Stored movies are a Twinkly feature; LIFX bulbs always stream. LIFX: colour bulbs over the LAN protocol, with matrix support for the Candle Colour.

## Running locally

```sh
nix develop
npm ci && npm run build
cargo run --manifest-path backend/Cargo.toml  # GLIMMER_DEV_LOGIN=1 for a local sign-in button
npm run dev                                    # UI with hot reload at http://localhost:3110
```

`node scripts/fake-twinkly.mjs [port] [leds] [rgbw|rgb] [curtain|staircase]` simulates a string at `127.0.0.1:8099`; add it in the app under that address. `node scripts/fake-ai.mjs [port]` answers the AI prompts with canned replies (`GLIMMER_AI_URL=http://127.0.0.1:8097/v1`). `node scripts/fake-lifx.mjs [port]` simulates a LIFX Candle Colour, and `cargo run -- lifx 127.0.0.1:56700 [seconds] [fps]` paints a warm-to-cool test gradient on it. `npm test` runs the UI's unit tests and `npm run test:ui` the browser checks against both fakes. `cargo run -- probe <ip> [seconds] [fps]` streams a test pattern to a real string and reports timing.

## Configuration

| Variable                                                                      | Meaning                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GLIMMER_ORIGIN`                                                              | Address the app is opened at, e.g. `https://glimmer.example.com`.                                                                                                                                                                                         |
| `GLIMMER_BIND`                                                                | Listen address (default `127.0.0.1:3111`).                                                                                                                                                                                                                |
| `GLIMMER_DATA_DIR`                                                            | Where the SQLite database lives (default `data`).                                                                                                                                                                                                         |
| `GLIMMER_SQLITE_JOURNAL_MODE`                                                 | `WAL` (default) or `DELETE` (needed on NFS).                                                                                                                                                                                                              |
| `GLIMMER_OIDC_ISSUER`, `GLIMMER_OIDC_CLIENT_ID`, `GLIMMER_OIDC_CLIENT_SECRET` | OpenID Connect sign-in (e.g. Pocket ID). The callback is `<origin>/auth/callback`.                                                                                                                                                                        |
| `GLIMMER_OIDC_ALLOWED_GROUPS`                                                 | Comma-separated groups allowed to sign in.                                                                                                                                                                                                                |
| `GLIMMER_DEV_LOGIN=1`                                                         | Local development sign-in without a provider.                                                                                                                                                                                                             |
| `GLIMMER_MQTT_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD`, `_PREFIX`             | MQTT broker; prefix defaults to `home/lights/twinkly`.                                                                                                                                                                                                    |
| `GLIMMER_AI_URL`, `GLIMMER_AI_KEY`, `GLIMMER_AI_MODEL`                        | An OpenAI-compatible chat completions endpoint (e.g. a Hermes agent, model `hermes-agent`) for the AI assistant.                                                                                                                                          |
| `GLIMMER_SEED`                                                                | JSON (or a path to it) with devices to add on first start, e.g. `[{"name": "Curtain", "ip": "192.0.2.20"}]` or `[{"name": "Candle", "ip": "192.0.2.21", "kind": "lifx"}]`. Optional `"enabled": false` and `"fixtures": [{"id": "Upper", "start": 126}]`. |
| `GLIMMER_TZ`                                                                  | IANA time zone in which seasonal playlists start and end, e.g. `Europe/Helsinki`. Falls back to `TZ`, then UTC.                                                                                                                                           |
| `GLIMMER_FEEDBACK_HUB`                                                        | Origin of an injected feedback widget, allowed by the CSP.                                                                                                                                                                                                |

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
  "transitions": [
    { "scriptId": "starburst", "durationMs": 1500, "params": { "rays": 7 } },
    { "scriptId": "flash", "durationMs": 1200, "params": {} }
  ],
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

`season` is `null`, `MM-DD` dates (which may wrap over the new year), `{"easter": [-7, 1]}` (days around Easter Sunday) or `{"midsummer": [-1, 2]}` (days around Midsummer Eve, the Friday from 19 to 25 June). With `autoEnabled`, the playlist switches the chosen `lights` (all when `null`) to itself at the start of each window, without touching their power, and at the end puts back what they showed before, if they are still on it. Each light gets this once per window, and lights added during a window join from its next start. Set a light's playlist with `{"playlist": "<id or name>"}` on `/api/fixtures/<id>/state`; picking an effect or preset ends it. `transitions` (optional) are used between the entries instead of each light's changing-effect transitions; with several, one is picked at random each time.

## AI assistant

With `GLIMMER_AI_URL` set (`ai` is `true` in `/api/state`), the app offers:

- **Preset names.** A preset saved without a name is called "Preset N" (the lowest free number). "Name it with AI" saves it that way, closes the dialog and has the AI name it in the background from the effect's code, its settings and colours and, if the model takes pictures, a PNG contact sheet of the look. The new name (up to 30 characters, made unique) is saved and reaches the app and MQTT like any rename; if naming fails, or someone renamed the preset meanwhile, it keeps its name. If a request with a picture fails but the same request without one works, no more pictures are sent until the server restarts.
- **Ask AI for settings** on a light's effect settings and on an effect's page: up to four proposed looks, fitted to the effect's params and colour slots, shown with live previews. Nothing changes until you try one or save it as a preset.
- **Create with AI** on the Playlists page: the proposed playlist (its effects with existing presets, built-in looks or new presets) is checked against what exists and shown for review, with a box for the playlist, each of its effects and each new preset. "Create" saves only what is ticked, new presets first; a new playlist's schedule starts switched off.

The endpoints behind these are `POST /api/ai/name-preset/<id>` (returns at once), `POST /api/ai/suggest-looks` with `{"scriptId", "prompt", "params", "colors"}` (returns `{"looks": [...]}`) and `POST /api/ai/playlist` with `{"prompt"}` (returns a proposal). The last two save nothing; approved items are applied with `POST /api/presets` and `POST /api/playlists`.

## Transitions

The transitions for all lights are app settings: `GET`/`PUT /api/settings` (also in `/api/state` as `settings`) holds `{"transitions": {"on": [...], "off": [...], "change": [...]}}`, each slot a list of `{"scriptId", "durationMs", "params"}`. With several in a slot one is picked at random each time, never the one picked last; an empty list switches instantly. A single object instead of a list (the older format) is accepted as a list of one.

A light's `transitions` (in `/api/state` and `PUT /api/fixtures/<id>`) has the same slots, each either its own list or `null` to follow the list for all lights, which is looked up whenever a transition runs, so changing it applies to every following light right away. `POST /api/settings/follow` with `{"slot": "change"}` sets that slot to `null` on every light. A playlist's own `transitions` still replace the changing-effect slot between its entries, and a `transition` object or `transitionMs` in a state change (from the UI or MQTT) overrides the slots for that change.

Databases from before these settings start the lists for all lights from the built-in ones (wipe up, wipe down, crossfade); light slots still holding those follow them, and changed ones stay the light's own.

## Writing effects

See [docs/effects.md](docs/effects.md). The same guide is given to the AI when it writes effects.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Trademarks

Glimmer is an independent project and is not affiliated with or endorsed by Twinkly or LEDWORKS. "Twinkly" is used only to name the devices it works with.

## License

MIT, see [LICENSE](LICENSE).
