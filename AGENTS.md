Use the locked Nix environment (`nix develop --command ...`) for every build, test and npm command.

Layout: `backend/` is the Rust server (axum, rusqlite, rquickjs, rumqttc); `src/` is the React UI (Vite, Tailwind v4, Radix); `backend/js/` holds the built-in effects and transitions and the QuickJS prelude; `docs/effects.md` is the scripting guide, which is also the AI's system prompt, so keep it accurate when the script API changes.

Architecture: `engine.rs` runs one render thread per enabled string (with its own QuickJS runtime) and one control thread for the slow HTTP calls; frames go out over UDP with protocol v3. `app.rs` holds the state shared by the web API and MQTT. A string that is disabled in the app must never be contacted.

Checks before committing: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` (all with `--manifest-path backend/Cargo.toml`), `npm run typecheck`, `npm run format:check`, `npm run build`, then `npm run test:ui`. The last one builds nothing itself: it needs the debug backend binary and `dist/`, and it runs the real server against `scripts/fake-twinkly.mjs`, which listens on UDP 7777. Look at the screenshots in `test-results/` after visual changes, at both desktop and phone width.

Testing against real strings changes what the household sees. Don't stream to strings without the owner's go-ahead; when you do, put each string back in the mode it was in (`led/mode`, and `movies/current` for movies). The firmware can only erase all stored movies at once, so test uploads stay on the device.

The repository is public: use example.com and 192.0.2.x in docs and fixtures, and keep real IPs in the deployment's secret seed, not in Git.

Firmware facts verified on Gen II firmware 2.11 (they differ from the xled docs in places):

- The current movie is set with `POST /xled/v1/movies/current`, not `led/movies/current` (which returns 404).
- `movies/full` makes the uploaded movie the current one.
- Realtime mode didn't time out within 45 s of the last UDP frame.
- `gestalt`'s `frame_rate`/`measured_frame_rate` (about 13 fps on the curtains) describe the string's own effects, not the realtime limit. Streams at 30–40 fps are accepted without errors, but nobody has yet checked by eye whether every frame is shown.
