// A stand-in for a Twinkly string, for tests: the HTTP API on the given port
// and realtime UDP frames on 127.0.0.1:7777. Run: node scripts/fake-twinkly.mjs [port] [leds] [rgbw]
import http from "node:http";
import dgram from "node:dgram";

export function startFakeTwinkly({
  port = 8099,
  leds = 210,
  rgbw = true,
  udpPort = 7777,
} = {}) {
  const token = Buffer.from("fakefake").toString("base64");
  const state = {
    mode: "movie",
    movies: [],
    current: null,
    frames: 0,
    lastFrame: null,
    brightness: 100,
  };
  const bytes = rgbw ? 4 : 3;
  const strands = 10;
  const per = Math.ceil(leds / strands);
  const coordinates = Array.from({ length: leds }, (_, i) => ({
    x: -1 + (2 * Math.floor(i / per)) / (strands - 1),
    y: 1 - (i % per) / (per - 1),
    z: 0,
  }));
  const json = (res, body, status = 200) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ ...body, code: 1000 }));
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const path = req.url.replace("/xled/v1/", "");
      const authed = req.headers["x-auth-token"] === token;
      if (path === "gestalt")
        return json(res, {
          product_code: "FAKE210",
          device_name: "Fake",
          fw_family: "G",
          number_of_led: leds,
          bytes_per_led: bytes,
          led_profile: rgbw ? "RGBW" : "RGB",
          frame_rate: 12.5,
          measured_frame_rate: 13,
          movie_capacity: 4000,
          max_movies: 55,
        });
      if (path === "fw/version") return json(res, { version: "2.11.0" });
      if (path === "login")
        return json(res, {
          authentication_token: token,
          "challenge-response": "x",
        });
      if (!authed) {
        res.writeHead(401);
        return res.end("Invalid Token.");
      }
      if (path === "verify") return json(res, {});
      if (path === "led/mode") {
        if (req.method === "POST")
          state.mode = JSON.parse(body.toString()).mode;
        return json(res, { mode: state.mode });
      }
      if (path === "led/layout/full")
        return json(res, { source: "2d", synthesized: false, coordinates });
      if (path === "led/out/brightness") {
        if (req.method === "POST")
          state.brightness = JSON.parse(body.toString()).value;
        return json(res, { value: state.brightness, mode: "enabled" });
      }
      if (path === "movies") {
        if (req.method === "DELETE") state.movies = [];
        const used = state.movies.reduce((n, m) => n + m.frames_number, 0);
        return json(res, {
          movies: state.movies,
          available_frames: 4000 - used,
          max_capacity: 4000,
        });
      }
      if (path === "movies/new") {
        const m = JSON.parse(body.toString());
        state.pending = { ...m, id: state.movies.length };
        return json(res, {});
      }
      if (path === "movies/full") {
        state.movies.push(state.pending);
        state.current = state.pending.id;
        return json(res, {});
      }
      if (path === "movies/current") {
        if (req.method === "POST")
          state.current = JSON.parse(body.toString()).id;
        return json(res, { id: state.current });
      }
      res.writeHead(404);
      res.end("This URI does not exist");
    });
  });
  server.listen(port, "127.0.0.1");
  const udp = dgram.createSocket("udp4");
  udp.on("message", (msg) => {
    if (msg[0] === 3 && msg.subarray(1, 9).toString() === "fakefake") {
      state.frames++;
      state.lastFrame = msg.subarray(12);
    }
  });
  udp.bind(udpPort, "127.0.0.1");
  return {
    state,
    close: () => {
      server.close();
      udp.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [port, leds, rgbw] = process.argv.slice(2);
  const fake = startFakeTwinkly({
    port: Number(port) || 8099,
    leds: Number(leds) || 210,
    rgbw: rgbw !== "rgb",
  });
  setInterval(
    () =>
      console.log(
        `mode=${fake.state.mode} frames=${fake.state.frames} movies=${fake.state.movies.length}`,
      ),
    5000,
  );
}
