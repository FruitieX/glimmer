// A stand-in for a LIFX Candle Colour (26 zones, 5 × 6 matrix), for tests:
// answer LIFX LAN queries on 127.0.0.1 and record the Set64 frames.
// Run: node scripts/fake-lifx.mjs [port]
import dgram from "node:dgram";

const HEADER = 36;
const MAC = Buffer.from([0xd0, 0x73, 0xd5, 0x00, 0x00, 0x01]);
const TARGET = Buffer.concat([MAC, Buffer.alloc(2)]);

const GET_SERVICE = 2;
const STATE_SERVICE = 3;
const GET_HOST_FIRMWARE = 14;
const STATE_HOST_FIRMWARE = 15;
const GET_POWER = 20;
const STATE_POWER = 22;
const GET_LABEL = 23;
const STATE_LABEL = 25;
const GET_VERSION = 32;
const STATE_VERSION = 33;
const ACKNOWLEDGEMENT = 45;
const GET_COLOR = 101;
const SET_COLOR = 102;
const LIGHT_STATE = 107;
const SET_LIGHT_POWER = 117;
const GET64 = 707;
const STATE64 = 711;
const SET64 = 715;

function packet(source, target, type, payload = Buffer.alloc(0), seq = 0) {
  const p = Buffer.alloc(HEADER + payload.length);
  p.writeUInt16LE(p.length, 0);
  p.writeUInt16LE(1024 | 0x1000, 2); // protocol 1024, addressable
  p.writeUInt32LE(source >>> 0, 4);
  target.copy(p, 8);
  p[23] = seq;
  p.writeUInt16LE(type, 32);
  payload.copy(p, HEADER);
  return p;
}

function parse(msg) {
  if (msg.length < HEADER) return null;
  const size = msg.readUInt16LE(0);
  if (size < HEADER || size > msg.length) return null;
  return {
    source: msg.readUInt32LE(4),
    res: (msg[22] & 1) === 1,
    ack: (msg[22] & 2) === 2,
    sequence: msg[23],
    type: msg.readUInt16LE(32),
    payload: msg.subarray(HEADER, size),
  };
}

function hsbkBytes([hue, saturation, brightness, kelvin]) {
  const b = Buffer.alloc(8);
  b.writeUInt16LE(hue, 0);
  b.writeUInt16LE(saturation, 2);
  b.writeUInt16LE(brightness, 4);
  b.writeUInt16LE(kelvin, 6);
  return b;
}

function readHsbk(buf, offset) {
  return [
    buf.readUInt16LE(offset),
    buf.readUInt16LE(offset + 2),
    buf.readUInt16LE(offset + 4),
    buf.readUInt16LE(offset + 6),
  ];
}

function colourSummary(colors) {
  const zones = [colors[0], ...colors.slice(5, 30)];
  const white = zones.filter(([, s]) => s === 0);
  const kelvins = white.map(([, , , k]) => k);
  const range = kelvins.length
    ? `${Math.min(...kelvins)}-${Math.max(...kelvins)} K`
    : "no whites";
  return `${white.length}/26 white (${range}), ${26 - white.length} colour`;
}

export function startFakeLifx({ port = 56700, quiet = true } = {}) {
  const state = {
    power: 65535,
    label: "Fake Candle",
    // 5 × 6 matrix; only slots 0 and 5–29 mean anything on a Candle.
    colors: Array.from({ length: 64 }, () => [0, 0, 0, 3500]),
    frames: 0,
    lastSet: null,
  };
  const socket = dgram.createSocket({ type: "udp4" });
  socket.on("message", (msg, rinfo) => {
    const m = parse(msg);
    if (!m) return;
    const reply = (type, payload = Buffer.alloc(0)) =>
      socket.send(
        packet(m.source, TARGET, type, payload, m.sequence),
        rinfo.port,
        rinfo.address,
      );
    const label = Buffer.alloc(32);
    label.write(state.label);
    switch (m.type) {
      case GET_SERVICE: {
        const p = Buffer.alloc(5);
        p.writeUInt8(1, 0);
        p.writeUInt32LE(port, 1);
        return reply(STATE_SERVICE, p);
      }
      case GET_HOST_FIRMWARE: {
        const p = Buffer.alloc(20);
        p.writeBigUInt64LE(0n, 0);
        p.writeBigUInt64LE(0n, 8);
        p.writeUInt32LE(0x0003_5000, 16);
        return reply(STATE_HOST_FIRMWARE, p);
      }
      case GET_LABEL:
        return reply(STATE_LABEL, label);
      case GET_VERSION: {
        const p = Buffer.alloc(12);
        p.writeUInt32LE(1, 0); // vendor
        p.writeUInt32LE(57, 4); // Candle Colour
        p.writeUInt32LE(0x0003_5000, 8);
        return reply(STATE_VERSION, p);
      }
      case GET_POWER: {
        const p = Buffer.alloc(2);
        p.writeUInt16LE(state.power, 0);
        return reply(STATE_POWER, p);
      }
      case GET_COLOR: {
        const p = Buffer.alloc(52);
        hsbkBytes(state.colors[0]).copy(p, 0);
        p.writeUInt16LE(state.power, 10);
        label.copy(p, 12);
        return reply(LIGHT_STATE, p);
      }
      case GET64: {
        const p = Buffer.alloc(5 + 512);
        p.writeUInt8(0, 0); // tile_index
        p.writeUInt8(0, 1); // reserved
        p.writeUInt8(0, 2); // x
        p.writeUInt8(0, 3); // y
        p.writeUInt8(5, 4); // width
        state.colors.forEach((c, i) => hsbkBytes(c).copy(p, 5 + i * 8));
        return reply(STATE64, p);
      }
      case SET_LIGHT_POWER: {
        state.power = m.payload.readUInt16LE(0);
        if (m.ack) reply(ACKNOWLEDGEMENT);
        return;
      }
      case SET_COLOR: {
        state.colors = state.colors.map(() => readHsbk(m.payload, 0));
        if (m.ack) reply(ACKNOWLEDGEMENT);
        return;
      }
      case SET64: {
        const colors = Array.from({ length: 64 }, (_, i) =>
          readHsbk(m.payload, 10 + i * 8),
        );
        state.colors = colors;
        state.frames += 1;
        state.lastSet = {
          at: Date.now(),
          duration: m.payload.readUInt32LE(6),
          colors,
        };
        if (m.ack) reply(ACKNOWLEDGEMENT);
        if (!quiet)
          console.log(`set64 #${state.frames}: ${colourSummary(colors)}`);
        return;
      }
      default:
        return;
    }
  });
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(port, "127.0.0.1", () => {
      if (!quiet) {
        const { address, port: bound } = socket.address();
        console.log(`fake LIFX candle on ${address}:${bound}`);
      }
      resolve({
        state,
        close: () => socket.close(),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 56700;
  const quiet = process.argv.includes("--quiet");
  startFakeLifx({ port, quiet }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
