// A stand-in for an OpenAI-compatible chat completions endpoint, for tests:
// canned answers to Glimmer's prompts (naming presets, suggesting looks,
// proposing playlists, writing effects), built from what the prompt lists.
// Run: node scripts/fake-ai.mjs [port], then GLIMMER_AI_URL=http://127.0.0.1:<port>/v1
import http from "node:http";

/** The JSON between `<tag>` and `</tag>`: one value, or one per line. */
function tagged(text, tag, lines = false) {
  const m = text.match(new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n?</${tag}>`));
  if (!m) return lines ? [] : null;
  if (!lines) return JSON.parse(m[1]);
  return m[1]
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

const fenced = (value) =>
  "```json\n" + JSON.stringify(value, null, 2) + "\n```";

/** Looks for the effect described in `text`: two good ones and one without a name. */
function looks(text) {
  const meta = tagged(text, "meta");
  const number = Object.entries(meta.params).find(
    ([, p]) => p.type === "number",
  );
  const value = (pick) => (number ? { [number[0]]: pick(number[1]) } : {});
  const colors = (list) => meta.colors.map((_, i) => list[i % list.length]);
  return {
    looks: [
      {
        name: "Slow Ember",
        params: value((p) => p.min ?? p.default),
        colors: colors(["#ff7a1a", "#7a1400", "#ffc46b"]),
      },
      {
        name: "Frosted Pine",
        params: value((p) => p.max ?? p.default),
        colors: colors(["#2e8b57", "#e0f0ff"]),
      },
      // Dropped by the server: a look needs a name.
      { name: "", params: {}, colors: [] },
    ],
  };
}

/** A playlist from the listed effects, with one entry that doesn't exist. */
function playlist(text) {
  const effects = tagged(text, "effects", true);
  const transitions = tagged(text, "transitions", true);
  const withLooks = effects.find((e) => e.looks.length) ?? effects[0];
  const withColors =
    effects.find((e) => e.colors.length && e.id !== withLooks.id) ?? effects[0];
  return {
    name: "Cosy Autumn Evening",
    shuffle: false,
    season: null,
    transitions: transitions.length
      ? [{ scriptId: transitions[0].id, durationMs: 1500 }]
      : [],
    entries: [
      { scriptId: effects[0].id, durationS: 180 },
      { scriptId: withLooks.id, durationS: 240, look: withLooks.looks[0] },
      {
        scriptId: withColors.id,
        durationS: 200,
        preset: {
          name: "Autumn Hearth",
          params: {},
          colors: withColors.colors.map(() => "#c8641e"),
        },
      },
      { scriptId: "no-such-effect", durationS: 60 },
    ],
  };
}

const EFFECT = `export const meta = { name: "Fake glow", params: {}, colors: [{ id: "c", label: "Colour", default: "#ff8800" }] };
export function render(ctx) { for (let i = 0; i < ctx.n; i++) ctx.out.set(ctx.colors[0], i * 3); }`;

export function startFakeAi({ port = 8097 } = {}) {
  const state = {
    /** Every request: its kind, whether it carried a picture, and its text. */
    requests: [],
    /** Turn down requests with pictures, like a text-only model. */
    rejectImages: false,
    /** Names given out in turn. */
    names: ["Ember Glow", "Quiet Harbour", "Velvet Dusk"],
    /** How long naming takes, so the placeholder name shows first. */
    nameDelayMs: 2000,
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const reply = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions"))
      return reply(404, { error: { message: "not found" } });
    const { messages } = JSON.parse(body);
    const system = messages[0]?.content ?? "";
    const last = messages.at(-1).content;
    const parts =
      typeof last === "string" ? [{ type: "text", text: last }] : last;
    const text = parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    const images = parts.filter((p) => p.type === "image_url");
    const kind = system.startsWith("You name")
      ? "name"
      : system.startsWith("You suggest")
        ? "looks"
        : system.startsWith("You build playlists")
          ? "playlist"
          : "script";
    state.requests.push({
      kind,
      hasImage: images.length > 0,
      // A real PNG, sent as a data URL.
      pngImage: images.some((p) =>
        p.image_url?.url?.startsWith("data:image/png;base64,iVBOR"),
      ),
      text,
    });
    if (state.rejectImages && images.length)
      return reply(400, {
        error: { message: "this model does not accept images" },
      });
    let content;
    if (kind === "name") {
      await new Promise((r) => setTimeout(r, state.nameDelayMs));
      content = fenced({ name: state.names.shift() ?? "Late Glow" });
    } else if (kind === "looks") content = fenced(looks(text));
    else if (kind === "playlist") content = fenced(playlist(text));
    else content = JSON.stringify({ source: EFFECT, summary: "A plain glow." });
    reply(200, {
      choices: [{ message: { role: "assistant", content } }],
    });
  });
  server.listen(port, "127.0.0.1");
  return { state, close: () => server.close() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 8097);
  startFakeAi({ port });
  console.log(`Fake AI on http://127.0.0.1:${port}/v1`);
}
