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
  await page.goto(`${origin}/effects/snowfall`);
  await page.getByText("Try settings").waitFor();
  await page.getByRole("button", { name: "View the code" }).waitFor();
  await page.screenshot({ path: `${shots}/editor-phone.png`, fullPage: true });
  await page.goto(`${origin}/effects`);
  await delay(1500);
  await page.screenshot({ path: `${shots}/effects-phone.png`, fullPage: true });

  assert.deepEqual(errors, [], "no browser errors");
  console.log(
    "UI checks passed: add string, stream, effects, presets, editor preview, new script, movie upload, power off.",
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
