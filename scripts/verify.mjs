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
  // Startup checks every built-in script, which takes a while on a busy
  // machine with a debug build.
  await until(
    "the server",
    async () => (await fetch(`${origin}/api/ready`)).ok,
    60000,
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

  // The gear opens the light's settings page, with its string's.
  await page.getByRole("link", { name: "Test curtain settings" }).click();
  await page.getByText("210 RGBW LEDs").waitFor();
  assert.equal(new URL(page.url()).pathname, "/lights/Test%20curtain/settings");
  await page.getByRole("slider", { name: "Effect size" }).waitFor();
  assert.ok(
    (
      await page.getByRole("combobox", { name: "Positions" }).textContent()
    ).includes("Along its length"),
    "positions offer along its length",
  );
  await page.screenshot({ path: `${shots}/settings.png`, fullPage: true });
  await page.goto(origin);

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
  await page.getByRole("heading", { name: "Test curtain" }).click();
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

  // A built-in look applies its params and colours as they are: settings
  // changed before go back to their defaults.
  {
    const lightUrl = `${origin}/api/fixtures/${encodeURIComponent("Test curtain")}/state`;
    const current = async () =>
      (await (await page.request.get(`${origin}/api/state`)).json()).fixtures[0]
        .state;
    const plasma = (
      await (await page.request.get(`${origin}/api/state`)).json()
    ).scripts.find((s) => s.id === "plasma");
    const [look] = plasma.meta.looks;
    assert.ok(look, "Plasma has looks");
    const tweaked = await page.request.post(lightUrl, {
      headers: { Origin: origin },
      data: {
        scriptId: "plasma",
        params: { speed: 1.9, scale: 7.5 },
        colors: ["#101010", "#202020", "#303030"],
      },
    });
    assert.ok(tweaked.ok(), "tweak a setting");
    await page.getByText("Plasma settings").waitFor();
    const looks = page.getByRole("group", { name: "Looks" });
    await looks.getByRole("button", { name: look.name, exact: true }).click();
    await until("the look", async () => {
      const s = await current();
      return JSON.stringify(s.look.params) === JSON.stringify(look.params);
    });
    assert.deepEqual((await current()).look.colors, look.colors);
    assert.equal((await current()).presetId, null);
    await until(
      "the look's chip to light up",
      async () =>
        (await looks
          .getByRole("button", { name: look.name, exact: true })
          .getAttribute("aria-pressed")) === "true",
    );
    await page
      .getByText("Plasma settings")
      .evaluate((h) => h.scrollIntoView({ block: "start" }));
    await delay(1000);
    await page.screenshot({ path: `${shots}/light-looks.png` });
    await looks.getByRole("button", { name: "Default", exact: true }).click();
    await until(
      "the defaults",
      async () => JSON.stringify((await current()).look.params) === "{}",
    );
    assert.deepEqual(
      (await current()).look.colors,
      plasma.meta.colors.map((c) => c.default),
    );
  }

  // Transitions: a slot can hold several, shuffled; old clients send one.
  const curtainUrl = `${origin}/api/fixtures/${encodeURIComponent("Test curtain")}`;
  const getFixture = async () =>
    (await (await page.request.get(`${origin}/api/state`)).json()).fixtures[0]
      .fixture;
  const getState = async () =>
    (await page.request.get(`${origin}/api/state`)).json();
  const fixture = await getFixture();
  // New lights follow the transitions for all lights.
  assert.deepEqual(fixture.transitions, { on: null, off: null, change: null });
  const settings = (await getState()).settings;
  assert.ok(Array.isArray(settings.transitions.on), "slots are lists");
  const single = await page.request.put(curtainUrl, {
    headers: { Origin: origin },
    data: {
      ...fixture,
      transitions: {
        ...fixture.transitions,
        on: { scriptId: "fade", durationMs: 500 },
      },
    },
  });
  assert.ok(single.ok(), `single transition: ${await single.text()}`);
  assert.deepEqual((await getFixture()).transitions.on, [
    { scriptId: "fade", durationMs: 500, params: null },
  ]);
  // Two shuffled transitions for every light changing effect.
  const twoChanges = [
    { scriptId: "iris", durationMs: 400, params: { rim: 0.8 } },
    { scriptId: "push", durationMs: 400, params: { direction: "up" } },
  ];
  const putSettings = (transitions) =>
    page.request.put(`${origin}/api/settings`, {
      headers: { Origin: origin },
      data: { ...settings, transitions },
    });
  const shuffled = await putSettings({
    ...settings.transitions,
    change: twoChanges,
  });
  assert.ok(shuffled.ok(), `two transitions: ${await shuffled.text()}`);
  const unknown = await putSettings({
    ...settings.transitions,
    change: [{ scriptId: "no-such", durationMs: 400 }],
  });
  assert.equal(unknown.status(), 400, "unknown transitions are refused");
  {
    const s = await getState();
    assert.deepEqual(s.settings.transitions.change, twoChanges);
    // The light follows them: it has no list of its own.
    assert.equal(s.fixtures[0].fixture.transitions.change, null);
    assert.deepEqual(
      (await (await page.request.get(`${origin}/api/settings`)).json())
        .transitions.change,
      twoChanges,
    );
  }
  const framesBeforeSwitching = fake.state.frames;
  for (const scriptId of ["plasma", "aurora", "fire", "plasma", "rainbow"]) {
    const r = await page.request.post(`${curtainUrl}/state`, {
      headers: { Origin: origin },
      data: { scriptId },
    });
    assert.ok(r.ok(), `switch to ${scriptId}`);
    await delay(450);
  }
  await until(
    "frames while switching",
    () => fake.state.frames > framesBeforeSwitching + 40,
  );
  const afterSwitching = (
    await (await page.request.get(`${origin}/api/state`)).json()
  ).status;
  for (const s of Object.values(afterSwitching))
    assert.deepEqual(s.fixtureErrors, {}, "no transition errors");

  // Laid out along its length at double effect size, the curtain is a flat
  // strip running left to right, and it keeps streaming.
  {
    const before = await getFixture();
    const tooBig = await page.request.put(curtainUrl, {
      headers: { Origin: origin },
      data: { ...before, scale: 5 },
    });
    assert.equal(tooBig.status(), 400, "effect size out of range");
    const r = await page.request.put(curtainUrl, {
      headers: { Origin: origin },
      data: { ...before, layout: { kind: "along" }, scale: 2 },
    });
    assert.ok(r.ok(), `along its length: ${await r.text()}`);
    const entry = (await (await page.request.get(`${origin}/api/state`)).json())
      .fixtures[0];
    assert.equal(entry.fixture.scale, 2);
    const pts = entry.layout.points;
    assert.ok(
      pts.every((p) => p[1] === 0.5),
      "flat along its length",
    );
    // Strands hang left to right, so the first strand is at the start.
    assert.ok(pts[0][0] < 0.05 && pts[pts.length - 1][0] > 0.95);
    const frames = fake.state.frames;
    await until(
      "frames along its length",
      () => fake.state.frames > frames + 20,
    );
    const restored = await page.request.put(curtainUrl, {
      headers: { Origin: origin },
      data: { ...before, layout: before.layout, scale: 1 },
    });
    assert.ok(restored.ok(), "back to the mapped layout");
  }

  // A light with its own list keeps it when the shared one changes.
  const ownChange = [{ scriptId: "fade", durationMs: 300, params: null }];
  const own = await page.request.put(curtainUrl, {
    headers: { Origin: origin },
    data: {
      ...(await getFixture()),
      transitions: { on: null, off: null, change: ownChange },
    },
  });
  assert.ok(own.ok(), `own transitions: ${await own.text()}`);
  assert.ok(
    (await putSettings({ ...settings.transitions, change: twoChanges })).ok(),
  );
  assert.deepEqual((await getFixture()).transitions.change, ownChange);

  // Settings: "Use these on every light" makes it follow again.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByText("Test curtain uses its own.").waitFor();
  await page
    .getByRole("button", {
      name: "Use these for changing effect on every light",
    })
    .click();
  await until(
    "the light to follow the shared list",
    async () => (await getFixture()).transitions.change === null,
  );
  await page.getByText("Every light uses these.").nth(2).waitFor();
  await delay(1200);
  await page.screenshot({ path: `${shots}/app-settings.png`, fullPage: true });

  // The light's own list starts as a copy of the shared one.
  await page.goto(`${origin}/lights/Test%20curtain/settings`);
  await page
    .getByRole("switch", { name: "Turning on: same as all lights" })
    .click();
  await until(
    "an own list",
    async () => (await getFixture()).transitions.on?.length === 1,
  );
  // Add two to the "Turning on" list at once with the picker.
  await page.getByRole("button", { name: "Add transition" }).first().click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("button", { name: /^Starburst/ }).click();
  await picker.getByRole("button", { name: /^Melt/ }).click();
  await picker.getByRole("button", { name: "Add 2 transitions" }).click();
  await until(
    "the added transitions",
    async () => (await getFixture()).transitions.on.length === 3,
  );
  await page.getByText(/Shuffles between these/).waitFor();
  await page
    .getByRole("heading", { name: "Transitions" })
    .evaluate((h) => h.scrollIntoView({ block: "center" }));
  await delay(1200);
  await page.screenshot({ path: `${shots}/transitions.png` });
  await page.getByRole("button", { name: "Add transition" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Melt/ })
    .waitFor();
  await delay(1200);
  await page.screenshot({ path: `${shots}/transition-picker.png` });
  await page.keyboard.press("Escape");
  // "Remove all" asks first; saying no keeps the list.
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Remove all" }).first().click();
  await delay(300);
  assert.equal((await getFixture()).transitions.on.length, 3);

  // Positions and effect size save from the light's settings page.
  {
    const before = await getFixture();
    await page
      .getByRole("combobox", { name: "Positions" })
      .selectOption("along");
    const size = page.getByRole("slider", { name: "Effect size" });
    await size.focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowRight");
    await page.getByText("2×", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Save", exact: true })
      .first()
      .click();
    await until("the layout and size to save", async () => {
      const f = await getFixture();
      return f.layout.kind === "along" && f.scale === 2;
    });
    assert.deepEqual(
      (await getFixture()).transitions.on.length,
      3,
      "saving the layout keeps the light's transitions",
    );
    const back = await page.request.put(curtainUrl, {
      headers: { Origin: origin },
      data: { ...(await getFixture()), layout: before.layout, scale: 1 },
    });
    assert.ok(back.ok(), "back to the mapped layout");
  }

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
      // Its own transition between entries, instead of the light's.
      transitions: [{ scriptId: "water-drop", durationMs: 700, params: {} }],
    },
  });
  assert.ok(
    created.ok(),
    `playlist: ${created.status()} ${await created.text()}`,
  );
  const playlist = await created.json();
  assert.equal(playlist.transitions[0].scriptId, "water-drop");
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
  // A playlist opens on its own page; it previews live on the light
  // playing it.
  await page.getByRole("button", { name: /^Test loop/ }).click();
  await page.getByText("Live: Test curtain is playing it.").waitFor();
  assert.equal(new URL(page.url()).pathname, `/playlists/${playlist.id}`);
  await page.locator("main").getByText("Rainbow").first().waitFor();
  await page.locator("main").getByText("Water drop").waitFor();
  await page.getByRole("button", { name: "Playing on Test curtain" }).waitFor();
  await delay(2000);
  await page.screenshot({ path: `${shots}/playlist.png`, fullPage: true });
  await page
    .getByText("Transitions between effects")
    .evaluate((h) => h.scrollIntoView({ block: "center" }));
  await delay(1000);
  await page.screenshot({ path: `${shots}/playlist-transitions.png` });
  await page.getByRole("button", { name: "Add effect" }).click();
  await delay(1500);
  await page.screenshot({ path: `${shots}/playlist-editor.png` });

  // "New" opens an empty playlist page; saving gives it its own.
  await page.goto(`${origin}/playlists`);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("heading", { name: "New playlist" }).waitFor();
  await page.getByLabel("Name").fill("Evening");
  await page.getByRole("button", { name: "Add effect" }).click();
  await page.getByRole("button", { name: /^Basics \d/ }).click();
  await page.getByRole("button", { name: /^Rainbow/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("heading", { name: "Evening" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/playlists/evening");
  assert.equal(
    (await getState()).playlists.find((p) => p.id === "evening").entries[0]
      .scriptId,
    "rainbow",
  );
  // An entry can use one of its effect's looks.
  {
    const rainbow = (await getState()).scripts.find((s) => s.id === "rainbow");
    const look = rainbow.meta.looks.at(-1);
    await page
      .getByRole("combobox", { name: "Rainbow preset" })
      .selectOption(`look:${look.name}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await until("the entry's look", async () => {
      const [e] = (await getState()).playlists.find(
        (p) => p.id === "evening",
      ).entries;
      return (
        e.presetId === null &&
        JSON.stringify(e.params) === JSON.stringify(look.params) &&
        JSON.stringify(e.colors) === JSON.stringify(look.colors)
      );
    });
    assert.equal(
      await page.getByRole("combobox", { name: "Rainbow preset" }).inputValue(),
      `look:${look.name}`,
    );
  }

  // "Stop playlist" keeps the effect on now, without the playlist.
  await page.goto(`${origin}/lights/Test%20curtain`);
  await page.getByRole("button", { name: "Stop playlist" }).click();
  await until(
    "the playlist to stop",
    async () => (await light()).state.playlistId === null,
  );
  // Picking an effect ends a playlist too.
  await page.request.post(`${fixtureUrl}/state`, {
    headers: { Origin: origin },
    data: { playlist: playlist.id },
  });
  const effect = await page.request.post(`${fixtureUrl}/state`, {
    headers: { Origin: origin },
    data: { scriptId: "rainbow" },
  });
  assert.equal((await effect.json()).playlistId, null);

  // "Play on" from the playlist's page puts it on the chosen light.
  await page.goto(`${origin}/playlists/evening`);
  await page.getByRole("button", { name: "Play on Test curtain" }).click();
  await until(
    "the playlist from its page",
    async () => (await light()).state.playlistId === "evening",
  );
  await page.getByRole("button", { name: "Playing on Test curtain" }).waitFor();

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
  await page.goto(`${origin}/lights/Test%20curtain/settings`);
  await page.getByText("210 RGBW LEDs").waitFor();
  await delay(1000);
  await page.screenshot({
    path: `${shots}/light-settings-phone.png`,
    fullPage: true,
  });
  await page
    .getByRole("heading", { name: "Transitions" })
    .evaluate((h) => h.scrollIntoView({ block: "start" }));
  await delay(1000);
  await page.screenshot({ path: `${shots}/transitions-phone.png` });
  await page.goto(`${origin}/settings`);
  await page.getByText("Transitions for all lights").waitFor();
  await delay(1000);
  await page.screenshot({
    path: `${shots}/app-settings-phone.png`,
    fullPage: true,
  });
  await page.goto(`${origin}/effects/snowfall`);
  await page.getByText("Try settings").waitFor();
  await page.getByRole("button", { name: "View the code" }).waitFor();
  await page.screenshot({ path: `${shots}/editor-phone.png`, fullPage: true });
  await page.goto(`${origin}/playlists`);
  await page.getByRole("button", { name: /^Christmas/ }).waitFor();
  await delay(1500);
  await page.screenshot({ path: `${shots}/playlists-phone.png` });
  await page.getByRole("button", { name: /^Christmas/ }).click();
  await page.getByText("Start by itself").waitFor();
  await delay(1500);
  await page.screenshot({ path: `${shots}/playlist-editor-phone.png` });
  await page.screenshot({
    path: `${shots}/playlist-editor-phone-full.png`,
    fullPage: true,
  });
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

  // Splitting a staircase string into lights: the map shows each light's LEDs
  // where they hang and points out a split that is one LED off, all without
  // touching the string. (It stays off, so its UDP port goes unused.)
  const stairs = startFakeTwinkly({
    port: 8098,
    leds: 210,
    rgbw: false,
    udpPort: 7778,
    layout: "staircase",
  });
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin);
    await page.getByRole("button", { name: "Add a string" }).click();
    await page.getByLabel("Name").fill("Staircase");
    await page.getByLabel("IP address").fill("127.0.0.1:8098");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("switch", { name: "Staircase power" }).waitFor();
    await page.getByRole("link", { name: "Staircase settings" }).click();
    const settings = page.locator("main");
    await settings.getByText("210 RGB LEDs").waitFor();
    await settings.getByRole("button", { name: "Split off a part" }).click();
    const split = page.getByRole("dialog", { name: "Split off a part" });
    // The suggested point (LED 105, the middle) is right; one lower leaves
    // the lower flight's last LED in the new light.
    await split.getByRole("button", { name: "Split point one lower" }).click();
    await split.getByLabel("Name of the new light").fill("Staircase upper");
    await split
      .getByText("LED 104 sits apart from the rest of Staircase upper")
      .waitFor();
    await page.screenshot({ path: `${shots}/split.png` });
    await split.getByRole("button", { name: "Split", exact: true }).click();
    await split.waitFor({ state: "detached" });

    const lights = async () =>
      Object.fromEntries(
        (await (await page.request.get(`${origin}/api/state`)).json()).fixtures
          .filter((f) => f.fixture.deviceId === "staircase")
          .map((f) => [f.fixture.id, [f.fixture.start, f.fixture.count]]),
      );
    assert.deepEqual(await lights(), {
      Staircase: [0, 104],
      "Staircase upper": [104, 106],
    });
    const hint = settings.getByText(
      "LED 104 sits apart from the rest of Staircase upper — it may belong to Staircase.",
    );
    await hint.waitFor();
    // Tapping an LED names it and its light.
    const led = settings.locator('[data-led="104"]');
    await led.scrollIntoViewIfNeeded();
    const box = await led.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settings.getByText("LED 104 · Staircase upper").waitFor();
    await page.screenshot({ path: `${shots}/split-hint.png` });

    // One tap moves the boundary back (shown before saving).
    await settings
      .getByRole("button", { name: "Move it to Staircase", exact: true })
      .click();
    await hint.waitFor({ state: "detached" });
    await settings.getByText("ends 104 · starts 105").waitFor();
    await settings.getByRole("button", { name: "Save split" }).click();
    await until(
      "the boundary at LED 105",
      async () =>
        JSON.stringify(await lights()) ===
        JSON.stringify({ Staircase: [0, 105], "Staircase upper": [105, 105] }),
    );
    await settings.getByRole("button", { name: "Save split" }).waitFor({
      state: "detached",
    });

    // Single-LED moves preview live and can be undone.
    await settings
      .getByRole("button", {
        name: "Move the boundary between Staircase and Staircase upper one LED up",
      })
      .click();
    await settings
      .getByText("LED 105 sits apart from the rest of Staircase")
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await delay(2600); // let the toasts fade
    await settings
      .getByText("LED 105 sits apart")
      .evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${shots}/split-hint-phone.png` });
    await settings
      .getByRole("img", { name: /Map of the string/ })
      .evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${shots}/split-map-phone.png` });
    await settings.getByRole("button", { name: "Undo", exact: true }).click();
    await settings.getByRole("button", { name: "Edit exact ranges" }).click();
    await settings
      .getByLabel("Staircase upper first LED")
      .evaluate((e) => e.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${shots}/split-exact-phone.png` });
    await settings.getByRole("button", { name: "Split off a part" }).click();
    await split.getByLabel("Name of the new light").waitFor();
    await delay(2600);
    await page.screenshot({ path: `${shots}/split-phone.png` });
    await page.keyboard.press("Escape");
    assert.deepEqual(await lights(), {
      Staircase: [0, 105],
      "Staircase upper": [105, 105],
    });
    // Along its length, the upper flight (climbing right to left) becomes a
    // flat strip from its bottom step to its top.
    const upperUrl = `${origin}/api/fixtures/${encodeURIComponent("Staircase upper")}`;
    const upperEntry = async () =>
      (
        await (await page.request.get(`${origin}/api/state`)).json()
      ).fixtures.find((f) => f.fixture.id === "Staircase upper");
    const along = await page.request.put(upperUrl, {
      headers: { Origin: origin },
      data: {
        ...(await upperEntry()).fixture,
        layout: { kind: "along" },
        scale: 2,
      },
    });
    assert.ok(along.ok(), `staircase along its length: ${await along.text()}`);
    const steps = (await upperEntry()).layout.points;
    assert.ok(
      steps.every((p) => p[1] === 0.5),
      "flat along its length",
    );
    assert.ok(
      steps.every((p, i) => i === 0 || p[0] > steps[i - 1][0]),
      "in order up the stairs",
    );
    assert.equal(stairs.state.frames, 0, "nothing streamed to the staircase");
  } finally {
    stairs.close();
  }

  assert.deepEqual(errors, [], "no browser errors");
  console.log(
    "UI checks passed: add string, light settings page, stream, effects, presets, shared and own shuffled transitions, settings, editor preview, new script, movie upload, playlist pages, power off, splitting a string.",
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
