// Smoke test for the published image: starts it the way the cluster does and checks it serves the app.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.GLIMMER_TEST_IMAGE ?? "ghcr.io/fruitiex/glimmer:main";
const name = `glimmer-check-${randomUUID().slice(0, 8)}`;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  docker(
    "run",
    "-d",
    "--name",
    name,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--tmpfs",
    "/data:rw,size=64m,uid=10001,gid=10001",
    "-p",
    "127.0.0.1::8080",
    "-e",
    "GLIMMER_ORIGIN=http://localhost:8080",
    "-e",
    "GLIMMER_SQLITE_JOURNAL_MODE=DELETE",
    image,
  );
  const port = JSON.parse(docker("inspect", name))[0].NetworkSettings.Ports[
    "8080/tcp"
  ][0].HostPort;
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${origin}/api/ready`)).ok) break;
    } catch {}
    if (i > 100)
      throw new Error(
        `Container did not become ready:\n${docker("logs", name)}`,
      );
    await delay(200);
  }
  assert.equal(docker("exec", name, "id", "-u"), "10001");
  for (const path of ["/", "/icon.svg", "/effects/plasma"])
    assert.equal((await fetch(origin + path)).status, 200, path);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  docker("exec", name, "glimmer", "--backup", "/data/backup.sqlite3");
  console.log(
    "Container checks passed: UID 10001, read-only root, static assets, auth required, backup.",
  );
} finally {
  try {
    docker("rm", "-f", name);
  } catch {}
}
