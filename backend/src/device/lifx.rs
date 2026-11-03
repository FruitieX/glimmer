//! The LIFX LAN protocol over UDP 56700: message framing, HSBK colours and
//! the matrix `Set64` message the Candle uses.
//!
//! Only what Glimmer needs: querying a device and painting its zones.
//! Discovery, the HTTP API and firmware effects are left out. Devices are
//! addressed by IP, and their serial number (the header's target) is learned
//! from the first reply, as LIFX only answers unicast messages that carry it.

use crate::color::{self, Rgb};
use rand::random;
use std::{
    io,
    net::{SocketAddr, UdpSocket},
    time::{Duration, Instant},
};

pub const PORT: u16 = 56700;

const PROTOCOL: u16 = 1024;
const ADDRESSABLE: u16 = 0x1000;
const HEADER: usize = 36;

pub const GET_VERSION: u16 = 32;
pub const STATE_VERSION: u16 = 33;
pub const SET64: u16 = 715;
pub const SET_LIGHT_POWER: u16 = 117;

/// How close to the blackbody curve a colour must be (in CIE xy) before it
/// is shown with the white LEDs at the matching temperature rather than
/// with the RGB LEDs. Warm candles and cool daylight sit well inside this;
/// oranges, pinks and pastels sit outside it.
const WHITE_DISTANCE: f32 = 0.02;

fn packet(source: u32, target: [u8; 8], kind: u16, payload: &[u8]) -> Vec<u8> {
    let size = HEADER + payload.len();
    let mut p = vec![0u8; size];
    p[0..2].copy_from_slice(&(size as u16).to_le_bytes());
    p[2..4].copy_from_slice(&(PROTOCOL | ADDRESSABLE).to_le_bytes());
    p[4..8].copy_from_slice(&source.to_le_bytes());
    p[8..16].copy_from_slice(&target);
    p[32..34].copy_from_slice(&kind.to_le_bytes());
    p[HEADER..].copy_from_slice(payload);
    p
}

/// A received message, borrowing its payload.
#[derive(Debug)]
pub struct Message<'a> {
    pub kind: u16,
    pub source: u32,
    /// The sending device's serial number, which is also the address to
    /// send it unicast messages.
    pub target: [u8; 8],
    pub payload: &'a [u8],
}

impl<'a> Message<'a> {
    pub fn parse(buf: &'a [u8]) -> Option<Self> {
        if buf.len() < HEADER {
            return None;
        }
        let size = u16::from_le_bytes([buf[0], buf[1]]) as usize;
        let word = u16::from_le_bytes([buf[2], buf[3]]);
        if word & 0x0fff != PROTOCOL || size < HEADER || size > buf.len() {
            return None;
        }
        Some(Self {
            kind: u16::from_le_bytes([buf[32], buf[33]]),
            source: u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]),
            target: buf[8..16].try_into().ok()?,
            payload: &buf[HEADER..size],
        })
    }
}

/// A device's firmware and product id.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Version {
    pub vendor: u32,
    pub product: u32,
    pub firmware: u32,
}

/// A zone's colour. LIFX swaps to the white LEDs when `saturation` is zero,
/// and `kelvin` then picks their temperature.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Hsbk {
    pub hue: u16,
    pub saturation: u16,
    pub brightness: u16,
    pub kelvin: u16,
}

impl Hsbk {
    pub const BLACK: Self = Self {
        hue: 0,
        saturation: 0,
        brightness: 0,
        kelvin: 3500,
    };

    /// Colours a perceptual frame value the way a LIFX zone expects: near
    /// neutrals on the blackbody curve become white at their temperature
    /// (the CCT LEDs do the work), everything else uses the RGB LEDs.
    /// `white: None` sends every colour through the RGB LEDs.
    pub fn from_rgb(rgb: Rgb, brightness: f32, white: Option<White>) -> Self {
        let v = rgb.iter().copied().fold(0.0f32, f32::max).clamp(0.0, 1.0);
        let brightness = (v * brightness.clamp(0.0, 1.0) * 65535.0).round() as u16;
        if brightness == 0 {
            return Self::BLACK;
        }
        if let Some(w) = white
            && let Some(kelvin) = white_kelvin(rgb, w.min, w.max)
        {
            return Self {
                hue: 0,
                saturation: 0,
                brightness,
                kelvin,
            };
        }
        let (h, s) = color::rgb_to_hs(rgb);
        let hue = ((h / 360.0) * 65536.0).round() as u32 % 65536;
        Self {
            hue: hue as u16,
            saturation: (s * 65535.0).round() as u16,
            brightness,
            kelvin: 3500,
        }
    }

    pub fn bytes(self) -> [u8; 8] {
        let mut b = [0u8; 8];
        b[0..2].copy_from_slice(&self.hue.to_le_bytes());
        b[2..4].copy_from_slice(&self.saturation.to_le_bytes());
        b[4..6].copy_from_slice(&self.brightness.to_le_bytes());
        b[6..8].copy_from_slice(&self.kelvin.to_le_bytes());
        b
    }
}

/// The white range a bulb supports; the Candle Colour covers 1500–9000 K on
/// current firmware (2500–9000 K on older versions).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct White {
    pub min: u16,
    pub max: u16,
}

impl Default for White {
    fn default() -> Self {
        Self {
            min: 1500,
            max: 9000,
        }
    }
}

/// The Candle's 26 zones in Set64's 5 × 6 slots: slot 0 is the top cap and
/// slots 5–29 are the five columns of five. Slots 1–4 are unused (only the
/// first colour of the top row is shown).
pub fn candle_slots(zones: &[Hsbk]) -> [Hsbk; 64] {
    let mut colors = [Hsbk::BLACK; 64];
    if let Some(top) = zones.first() {
        colors[0] = *top;
    }
    for (i, zone) in zones.iter().skip(1).take(25).enumerate() {
        colors[5 + i] = *zone;
    }
    colors
}

fn linear(c: f32) -> f32 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// CIE xy chromaticity of a perceptual sRGB colour.
fn xy(rgb: Rgb) -> (f32, f32) {
    let [r, g, b] = rgb.map(linear);
    let x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
    let sum = x + y + z;
    if sum <= 0.0 {
        (0.3127, 0.3290)
    } else {
        (x / sum, y / sum)
    }
}

/// CIE xy of a black body at `kelvin` (Kim et al.'s cubic fit).
fn blackbody(kelvin: f64) -> (f64, f64) {
    let t = kelvin;
    if t <= 4000.0 {
        let x = -0.2661239e9 / t.powi(3) - 0.2343589e6 / t.powi(2) + 0.8776956e3 / t + 0.179910;
        let y = -0.9549476 * x.powi(3) - 1.37418593 * x.powi(2) + 2.09137015 * x - 0.16748867;
        (x, y)
    } else {
        let x = -3.0258469e9 / t.powi(3) + 2.1070379e6 / t.powi(2) + 0.2226347e3 / t + 0.240390;
        let y = 3.0817580 * x.powi(3) - 5.87338670 * x.powi(2) + 3.75112997 * x - 0.37001483;
        (x, y)
    }
}

/// The white temperature to show `rgb` at, when it is close enough to the
/// blackbody curve; `None` leaves it to the RGB LEDs.
fn white_kelvin(rgb: Rgb, min: u16, max: u16) -> Option<u16> {
    let (x, y) = xy(rgb);
    let (x, y) = (f64::from(x), f64::from(y));
    // McCamy's approximation.
    let n = (x - 0.3320) / (y - 0.1858);
    let cct = -449.0 * n.powi(3) + 3525.0 * n.powi(2) - 6823.3 * n + 5520.33;
    if !(1667.0..=25000.0).contains(&cct) {
        return None;
    }
    let (bx, by) = blackbody(cct);
    if ((x - bx).powi(2) + (y - by).powi(2)).sqrt() > f64::from(WHITE_DISTANCE) {
        return None;
    }
    Some(cct.clamp(f64::from(min), f64::from(max)).round() as u16)
}

/// A LIFX device on the LAN. The socket is connected to one address, so the
/// replies are filtered by the kernel and by our source id.
pub struct Client {
    socket: UdpSocket,
    source: u32,
    target: [u8; 8],
    sequence: u8,
}

impl Client {
    /// `addr` is `host` or `host:port`; the port is only for test doubles.
    pub fn new(addr: &str) -> Result<Self, String> {
        let (host, port) = match addr.rsplit_once(':') {
            Some((h, p)) if !h.contains(':') && p.parse::<u16>().is_ok() => {
                (h, p.parse::<u16>().unwrap())
            }
            _ => (addr, PORT),
        };
        let addr: SocketAddr = format!("{host}:{port}")
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?;
        let socket = UdpSocket::bind(if addr.is_ipv4() {
            "0.0.0.0:0"
        } else {
            "[::]:0"
        })
        .map_err(|e| e.to_string())?;
        socket.connect(addr).map_err(|e| e.to_string())?;
        let source = random::<u32>();
        Ok(Self {
            socket,
            // Old firmware ignores source 0 and 1.
            source: if source < 2 { 2 } else { source },
            target: [0; 8],
            sequence: 0,
        })
    }

    fn send(&mut self, kind: u16, payload: &[u8], state_reply: bool) -> Result<(), String> {
        self.sequence = self.sequence.wrapping_add(1);
        let mut p = packet(self.source, self.target, kind, payload);
        p[22] = u8::from(state_reply);
        p[23] = self.sequence;
        self.socket.send(&p).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Sends a `Get` and waits for the expected state message.
    fn request(&mut self, kind: u16, expect: u16) -> Result<Vec<u8>, String> {
        self.send(kind, &[], true)?;
        let deadline = Instant::now() + Duration::from_secs(1);
        let mut buf = [0u8; 1024];
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(format!("no reply to LIFX message {kind}"));
            }
            self.socket
                .set_read_timeout(Some(left))
                .map_err(|e| e.to_string())?;
            match self.socket.recv(&mut buf) {
                Ok(n) => {
                    let Some(m) = Message::parse(&buf[..n]) else {
                        continue;
                    };
                    if m.source != self.source {
                        continue;
                    }
                    // A device always replies with its own serial number.
                    if m.kind == expect {
                        self.target = m.target;
                        return Ok(m.payload.to_vec());
                    }
                }
                Err(e)
                    if e.kind() == io::ErrorKind::WouldBlock
                        || e.kind() == io::ErrorKind::TimedOut =>
                {
                    return Err(format!("no reply to LIFX message {kind}"));
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    pub fn version(&mut self) -> Result<Version, String> {
        let p = self.request(GET_VERSION, STATE_VERSION)?;
        if p.len() < 12 {
            return Err("short LIFX version reply".into());
        }
        Ok(Version {
            vendor: u32::from_le_bytes(p[0..4].try_into().unwrap()),
            product: u32::from_le_bytes(p[4..8].try_into().unwrap()),
            firmware: u32::from_le_bytes(p[8..12].try_into().unwrap()),
        })
    }

    pub fn power(&mut self, on: bool) -> Result<(), String> {
        let level: u16 = if on { 65535 } else { 0 };
        let mut payload = Vec::with_capacity(6);
        payload.extend_from_slice(&level.to_le_bytes());
        payload.extend_from_slice(&0u32.to_le_bytes());
        self.send(SET_LIGHT_POWER, &payload, false)
    }

    /// Paints a matrix device. The Candle uses `width = 5`; the payload has
    /// no height, the device knows its own shape.
    pub fn set64(&mut self, colors: &[Hsbk; 64], duration_ms: u32) -> Result<(), String> {
        let mut payload = Vec::with_capacity(522);
        payload.extend_from_slice(&[0, 1, 0, 0, 0, 5]); // tile, length, fb, x, y, width
        payload.extend_from_slice(&duration_ms.to_le_bytes());
        for c in colors {
            payload.extend_from_slice(&c.bytes());
        }
        self.send(SET64, &payload, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(hex: &str) -> Rgb {
        color::parse_hex(hex).unwrap()
    }

    #[test]
    fn frames_messages_and_reads_replies() {
        let p = packet(0x1234_5678, [0xd0, 0x73, 0xd5, 1, 2, 3, 0, 0], 715, &[9, 8]);
        assert_eq!(p.len(), HEADER + 2);
        assert_eq!(u16::from_le_bytes([p[0], p[1]]) as usize, p.len());
        assert_eq!(u16::from_le_bytes([p[2], p[3]]), PROTOCOL | ADDRESSABLE);
        assert_eq!(&p[8..14], &[0xd0, 0x73, 0xd5, 1, 2, 3]);
        assert_eq!(u16::from_le_bytes([p[32], p[33]]), 715);
        let m = Message::parse(&p).unwrap();
        assert_eq!(m.kind, 715);
        assert_eq!(m.source, 0x1234_5678);
        assert_eq!(m.target, [0xd0, 0x73, 0xd5, 1, 2, 3, 0, 0]);
        assert_eq!(m.payload, &[9, 8]);
        assert!(Message::parse(&p[..10]).is_none());
    }

    #[test]
    fn set64_is_one_558_byte_packet() {
        let mut c = [Hsbk::BLACK; 64];
        c[0] = Hsbk {
            hue: 1,
            saturation: 2,
            brightness: 3,
            kelvin: 4,
        };
        let mut payload = Vec::new();
        payload.extend_from_slice(&[0, 1, 0, 0, 0, 5]);
        payload.extend_from_slice(&0u32.to_le_bytes());
        for x in &c {
            payload.extend_from_slice(&x.bytes());
        }
        let p = packet(7, [1; 8], SET64, &payload);
        assert_eq!(p.len(), 558);
        assert_eq!(&p[36..42], &[0, 1, 0, 0, 0, 5]);
        assert_eq!(&p[42..46], &0u32.to_le_bytes());
        assert_eq!(&p[46..54], &[1, 0, 2, 0, 3, 0, 4, 0]);
    }

    #[test]
    fn candle_slots_put_the_top_zone_first() {
        let zones = [Hsbk {
            kelvin: 2000,
            ..Hsbk::BLACK
        }; 26];
        let slots = candle_slots(&zones);
        assert_eq!(slots[0].kelvin, 2000);
        assert_eq!(slots[4].brightness, 0, "the rest of the top row is unused");
        assert_eq!(slots[5].kelvin, 2000);
        assert_eq!(slots[29].kelvin, 2000);
        assert_eq!(slots[30].brightness, 0);
    }

    #[test]
    fn whites_go_to_the_cct_leds() {
        let warm = Hsbk::from_rgb(rgb("#ffd9b0"), 1.0, Some(White::default()));
        assert_eq!(warm.saturation, 0);
        assert!((3900..4600).contains(&warm.kelvin), "{warm:?}");
        assert_eq!(warm.brightness, 65535);

        // The default solid colour is on the blackbody curve at ~2900 K.
        let amber = Hsbk::from_rgb(rgb("#ffb46b"), 1.0, Some(White::default()));
        assert_eq!(amber.saturation, 0);
        assert!((2600..3200).contains(&amber.kelvin), "{amber:?}");

        let daylight = Hsbk::from_rgb(rgb("#ffffff"), 1.0, Some(White::default()));
        assert_eq!(daylight.saturation, 0);
        assert!((6000..7000).contains(&daylight.kelvin), "{daylight:?}");
    }

    #[test]
    fn colours_stay_coloured() {
        let red = Hsbk::from_rgb(rgb("#ff0000"), 1.0, Some(White::default()));
        assert_eq!(red.saturation, 65535);
        assert_eq!(red.hue, 0);
        let green = Hsbk::from_rgb(rgb("#00ff00"), 1.0, Some(White::default()));
        assert_eq!(green.saturation, 65535);
        assert!((21000..22500).contains(&green.hue), "{green:?}");
        // Pink is off the blackbody curve, so it is not "white".
        let pink = Hsbk::from_rgb(rgb("#ffd0e0"), 1.0, Some(White::default()));
        assert!(pink.saturation > 0, "{pink:?}");
        // Without a white range everything is RGB.
        let warm_rgb = Hsbk::from_rgb(rgb("#ffd9b0"), 1.0, None);
        assert!(warm_rgb.saturation > 0);
    }

    #[test]
    fn dim_colours_are_black_and_brightness_scales() {
        assert_eq!(
            Hsbk::from_rgb([1.0, 1.0, 1.0], 0.0, Some(White::default())),
            Hsbk::BLACK
        );
        let half = Hsbk::from_rgb(rgb("#ffffff"), 0.5, Some(White::default()));
        assert!((32760..32770).contains(&half.brightness), "{half:?}");
    }

    #[test]
    fn kelvin_is_clamped_to_the_bulb() {
        let narrow = White {
            min: 2700,
            max: 4000,
        };
        let cool = Hsbk::from_rgb(rgb("#ffffff"), 1.0, Some(narrow));
        assert_eq!(cool.kelvin, 4000);
        let warm = Hsbk::from_rgb(rgb("#ff8000"), 1.0, Some(narrow));
        assert_eq!(warm.kelvin, 2700);
    }
}
