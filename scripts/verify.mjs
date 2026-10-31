// End-to-end check: the real server and UI against a fake Twinkly string.
// Needs `npm run build` and a built backend (GLIMMER_BIN, default backend/target/debug/glimmer).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { startFakeTwinkly } from "./fake-twinkly.mjs";

const port = 3190;
const origin = `http://127.0.0.1:${port}`;
const bin = process.env.GLIMMER_BIN ?? "backend/target/debug/glimmer";
const data = mkdtempSync(join(tmpdir(), "glimmer-verify-"));
const shots = "test-results";
mkdirSync(shots, { recursive: true });

const fake = startFakeTwinkly({ port: 8099, leds: 210, rgbw: true });
const server = spawn(bin, [], {
  env: {
    ...process.env,
    GLIMMER_DATA_DIR: data,
    GLIMMER_DEV_LOGIN: "1",
    GLIMMER_ORIGIN: origin,
    GLIMMER_BIND: `127.0.0.1:${port}`,
    GLIMMER_STATIC_DIR: "dist",
    RUST_LOG: "glimmer=warn",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
// Never leave the server behind (it would keep this script's output open).
process.on("exit", () => server.kill());

async function until(what, f, ms = 15000) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await f();
      if (v) return v;
    } catch {}
    if (Date.now() - start > ms)
      throw new Error(`Timed out waiting for ${what}`);
    await delay(150);
  }
}

/** Fraction of a canvas's pixels that are lit. */
async function litFraction(page, selector) {
  return page.$eval(selector, (canvas) => {
    const ctx = canvas.getContext("2d");
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] + data[i + 1] + data[i + 2] > 120) lit++;
    return lit / (data.length / 4);
  });
}

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
let failed = false;
try {
  await until(
    "the server",
    async () => (await fetch(`${origin}/api/ready`)).ok,
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on(
    "console",
    (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)),
  );
  page.on(
    "response",
    (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`),
  );

  await page.goto(origin);
  await page.getByRole("button", { name: "Sign in for development" }).click();
  await page.getByText("No lights yet").waitFor();

  // Add the fake string.
  await page.getByRole("button", { name: "Add a string" }).click();
  await page.getByLabel("Name").fill("Test curtain");
  await page.getByLabel("IP address").fill("127.0.0.1:8099");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("switch", { name: "Test curtain power" }).waitFor();

  // The gear opens the string's settings.
  await page.getByRole("button", { name: "Test curtain settings" }).click();
  await page.getByText("210 RGBW LEDs").waitFor();
  await page.screenshot({ path: `${shots}/settings.png` });
  await page.keyboard.press("Escape");

  // Turn it on from the overview.
  await page.getByRole("switch", { name: "Test curtain power" }).click();
  await until("realtime frames", () => fake.state.frames > 20);
  assert.equal(fake.state.mode, "rt");
  await until(
    "a lit mirror",
    async () => (await litFraction(page, "main canvas:nth-of-type(2)")) > 0.01,
  );
  await page.screenshot({ path: `${shots}/lights.png`, fullPage: true });

  // Pick an effect and change a setting on the light's page.
  await page.getByRole("link", { name: "Test curtain" }).first().click();
  await page.getByRole("button", { name: /^Rainbow/ }).click();
  await page.getByText("Rainbow settings").waitFor();
  await delay(1500);
  await page.screenshot({ path: `${shots}/light.png`, fullPage: true });
  const lit = fake.state.lastFrame;
  assert.ok(lit && lit.some((b) => b > 0), "frames carry colour");

  // Save a preset and apply it.
  await page.getByRole("button", { name: "Save current look" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Party");
  await page.getByRole("button", { name: "Save preset" }).click();
  await page.getByRole("button", { name: "Party", exact: true }).waitFor();

  // Editor: the preview renders server-side.
  await page.goto(`${origin}/effects/plasma`);
  await page.getByText("Try settings").waitFor();
  await until(
    "a lit preview",
    async () => (await litFraction(page, "main canvas:nth-of-type(2)")) > 0.01,
  );
  await page.screenshot({ path: `${shots}/editor.png`, fullPage: true });

  // Create an effect from the template and save it.
  await page.goto(`${origin}/effects`);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("button", { name: "Start from code" }).click();
  await page.getByText("version 1").waitFor();

  // A picture becomes an effect that samples it.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64",
  );
  const uploaded = await page.request.post(`${origin}/api/images?name=Dots`, {
    headers: { Origin: origin, "Content-Type": "image/png" },
    data: png,
  });
  assert.ok(
    uploaded.ok(),
    `image upload: ${uploaded.status()} ${await uploaded.text()}`,
  );
  const imageEffect = await uploaded.json();
  assert.equal(imageEffect.meta.category, "Images");
  await page.goto(`${origin}/effects/${imageEffect.id}`);
  await page.getByText("Try settings").waitFor();

  // Movies: a looping effect is uploaded and played from the string.
  const state = await (await page.request.get(`${origin}/api/state`)).json();
  const device = state.devices[0];
  await page.request.put(`${origin}/api/devices/${device.id}`, {
    headers: { Origin: origin },
    data: { ...device, preferMovies: true },
  });
  await until(
    "a movie",
    () => fake.state.movies.length === 1 && fake.state.mode === "movie",
    20000,
  );

  // Playlists: two short entries take turns, streamed live even though the
  // string prefers movies (no movie per entry).
  const created = await page.request.post(`${origin}/api/playlists`, {
    headers: { Origin: origin },
    data: {
      name: "Test loop",
      shuffle: false,
      entries: [
        { scriptId: "rainbow", durationS: 2 },
        { scriptId: "plasma", durationS: 2 },
      ],
    },
  });
  assert.ok(
    created.ok(),
    `playlist: ${created.status()} ${await created.text()}`,
  );
  const playlist = await created.json();
  const fixtureUrl = `${origin}/api/fixtures/${encodeURIComponent("Test curtain")}`;
  const picked = await page.request.post(`${fixtureUrl}/state`, {
    headers: { Origin: origin },
    data: { playlist: playlist.id, power: true },
  });
  assert.ok(picked.ok(), `pick playlist: ${await picked.text()}`);
  assert.equal((await picked.json()).look.scriptId, "rainbow");
  const light = async () =>
    (await (await page.request.get(`${origin}/api/state`)).json()).fixtures[0];
  await until("live frames for the playlist", () => fake.state.mode === "rt");
  const framesBefore = fake.state.frames;
  await until("the next entry", async () => {
    const l = await light();
    return l.state.look.scriptId === "plasma" && l.playing?.entry === 1;
  });
  await until(
    "the first entry again",
    async () => (await light()).state.look.scriptId === "rainbow",
  );
  assert.equal((await light()).state.playlistId, playlist.id);
  assert.ok(fake.state.frames > framesBefore + 50, "the playlist streams");
  assert.equal(fake.state.mode, "rt", "still live");
  assert.equal(fake.state.movies.length, 1, "no movie uploaded per entry");
  const status = (await (await page.request.get(`${origin}/api/state`)).json())
    .status[device.id];
  assert.equal(status.output, "live");

  await page.goto(`${origin}/lights/Test%20curtain`);
  await page.getByText("Test loop").first().waitFor();
  await page.getByRole("button", { name: /^Playlists/ }).click();
  await page.getByRole("button", { name: /^Halloween/ }).waitFor();
  await delay(1500);
  await page.screenshot({
    path: `${shots}/light-playlist.png`,
    fullPage: true,
  });
  await page.goto(`${origin}/playlists`);
  await page.getByRole("button", { name: /^Christmas/ }).waitFor();
  await delay(1500);
  await page.screenshot({ path: `${shots}/playlists.png`, fullPage: true });
  await page.getByRole("button", { name: /^Test loop/ }).click();
  await page.getByRole("dialog").getByText("Rainbow").waitFor();
  await page.getByRole("button", { name: "Add effect" }).click();
  await delay(1500);
  await page.screenshot({ path: `${shots}/playlist-editor.png` });
  await page.keyboard.press("Escape");

  // Picking an effect ends the playlist.
  const effect = await page.request.post(`${fixtureUrl}/state`, {
    headers: { Origin: origin },
    data: { scriptId: "rainbow" },
  });
  assert.equal((await effect.json()).playlistId, null);

  // Turning off fades out live and switches the string off.
  await page.goto(origin);
  await page.getByRole("switch", { name: "Test curtain power" }).click();
  await until("off", () => fake.state.mode === "off");

  // Phone layout.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/lights-phone.png`, fullPage: true });
  await page.goto(`${origin}/lights/Test%20curtain`);
  await page.getByText("Rainbow settings").waitFor();
  await page.screenshot({ path: `${shots}/light-phone.png`, fullPage: true });
  await page
    .getByRole("heading", { name: "Effect", exact: true })
    .evaluate((h) => h.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: `${shots}/light-phone-effects.png` });
  await page.goto(`${origin}/effects/snowfall`);
  await page.getByText("Try settings").waitFor();
  await page.getByRole("button", { name: "View the code" }).waitFor();
  await page.screenshot({ path: `${shots}/editor-phone.png`, fullPage: true });
  await page.goto(`${origin}/playlists`);
  await page.getByRole("button", { name: /^Christmas/ }).waitFor();
  await delay(1500);
  await page.screenshot({ path: `${shots}/playlists-phone.png` });
  await page.getByRole("button", { name: /^Christmas/ }).click();
  await page.getByRole("dialog").getByText("Start by itself").waitFor();
  await delay(800);
  await page.screenshot({ path: `${shots}/playlist-editor-phone.png` });
  await page.getByRole("dialog").evaluate((d) => d.scrollTo(0, d.scrollHeight));
  await page.screenshot({ path: `${shots}/playlist-editor-phone-2.png` });
  await page.keyboard.press("Escape");
  // Installed from the browser, the app opens in its own window.
  const manifest = await page.request.get(`${origin}/manifest.webmanifest`);
  assert.equal((await manifest.json()).display, "standalone");
  assert.ok(
    (await page.request.get(`${origin}/icon-512.png`)).ok(),
    "app icon",
  );

  // Only cards on screen get thumbnails streamed.
  const thumbs = new Set();
  page.on("websocket", (ws) => {
    if (!ws.url().endsWith("/api/gallery")) return;
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") return;
      thumbs.add(payload.subarray(1, 1 + payload[0]).toString());
    });
  });
  await page.goto(`${origin}/effects`);
  await delay(1500);
  thumbs.clear();
  await delay(1000);
  const effectCount = state.scripts.filter((s) => s.kind === "effect").length;
  assert.ok(
    thumbs.size > 0 && thumbs.size < effectCount / 2,
    `streamed ${thumbs.size} of ${effectCount} thumbnails`,
  );
  await page.screenshot({ path: `${shots}/effects-phone.png` });

  assert.deepEqual(errors, [], "no browser errors");
  console.log(
    "UI checks passed: add string, stream, effects, presets, editor preview, new script, movie upload, playlists, power off.",
  );
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
  fake.close();
  rmSync(data, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
