# Deployment

The app is one container (`ghcr.io/fruitiex/glimmer`, built by `nix build .#container`) that serves the UI and API on port 8080 as UID 10001 with a read-only root filesystem. It keeps its SQLite database in `/data`.

- **One replica only.** The server owns the realtime streams to the strings, and two copies would fight over them. Use the `Recreate` strategy.
- **Network:** the pod sends UDP to port 7777 and HTTP to port 80 on each string, so it needs plain outbound access to the LAN the strings are on. Ordinary pod networking with NAT works; no host networking is needed.
- **Storage:** on NFS, set `GLIMMER_SQLITE_JOURNAL_MODE=DELETE`, because SQLite's WAL doesn't work on network filesystems.
- **Time zone:** seasonal playlists start and end at local midnight. The image has no local time zone, so set `GLIMMER_TZ` (an IANA name such as `Europe/Helsinki`); without it, `TZ` is used if it names a zone, else UTC. The schedule's state is kept in the database, so windows that start or end while the app is down are caught up on the next start.
- **Health:** `/api/health` reports liveness and `/api/ready` checks the database.
- **Backups:** `glimmer --backup <file>` writes a consistent copy of the database.
- **Shutdown:** on SIGTERM the server stops streaming. Strings showing a live effect keep their last frame until their realtime timeout, then go back to their own movie. Strings playing an uploaded movie keep playing it.

CI (`.github/workflows/build.yml`) runs the Rust checks, the frontend build and the browser checks against a fake string, builds and smoke-tests the container, and on `main` publishes the image and asks the [homelab](https://github.com/FruitieX/homelab) repository to deploy the new digest.
