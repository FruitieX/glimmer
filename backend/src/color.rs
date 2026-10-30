//! Colour conversions: homectl colours in, device bytes out.
//!
//! Effects work in perceptual (sRGB-like) 0..1 values. The output stage
//! scales by brightness, converts to linear light with the device's gamma,
//! applies white balance, extracts the white channel on RGBW strings and
//! orders the bytes the way the device expects.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Rgb = [f32; 3];

pub fn parse_hex(s: &str) -> Option<Rgb> {
    let s = s.trim().trim_start_matches('#');
    let s = if s.len() == 3 {
        s.chars().flat_map(|c| [c, c]).collect::<String>()
    } else {
        s.to_string()
    };
    if s.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(&s, 16).ok()?;
    Some([
        ((n >> 16) & 255) as f32 / 255.0,
        ((n >> 8) & 255) as f32 / 255.0,
        (n & 255) as f32 / 255.0,
    ])
}

pub fn to_hex(c: Rgb) -> String {
    let b = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]))
}

pub fn hsv_to_rgb(h: f32, s: f32, v: f32) -> Rgb {
    let h = h.rem_euclid(1.0) * 6.0;
    let i = h.floor();
    let f = h - i;
    let (p, q, t) = (v * (1.0 - s), v * (1.0 - s * f), v * (1.0 - s * (1.0 - f)));
    match i as u32 {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}

/// Hue in degrees and saturation 0..1.
pub fn rgb_to_hs(c: Rgb) -> (f32, f32) {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let d = max - min;
    if max <= 0.0 || d <= 0.0 {
        return (0.0, 0.0);
    }
    let h = if max == c[0] {
        ((c[1] - c[2]) / d).rem_euclid(6.0)
    } else if max == c[1] {
        (c[2] - c[0]) / d + 2.0
    } else {
        (c[0] - c[1]) / d + 4.0
    };
    (h * 60.0, d / max)
}

fn srgb_encode(v: f32) -> f32 {
    if v <= 0.0031308 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

fn normalized(c: Rgb) -> Rgb {
    let max = c[0].max(c[1]).max(c[2]);
    if max <= 0.0 {
        [1.0, 1.0, 1.0]
    } else {
        [
            (c[0] / max).max(0.0),
            (c[1] / max).max(0.0),
            (c[2] / max).max(0.0),
        ]
    }
}

fn xy_to_rgb(x: f32, y: f32) -> Rgb {
    if y <= 0.0 {
        return [1.0, 1.0, 1.0];
    }
    let (cx, cy, cz) = (x / y, 1.0, (1.0 - x - y) / y);
    let lin = [
        3.2406 * cx - 1.5372 * cy - 0.4986 * cz,
        -0.9689 * cx + 1.8758 * cy + 0.0415 * cz,
        0.0557 * cx - 0.2040 * cy + 1.0570 * cz,
    ];
    let n = normalized(lin);
    [srgb_encode(n[0]), srgb_encode(n[1]), srgb_encode(n[2])]
}

/// Approximate colour of a black body at `kelvin` (Tanner Helland's fit).
pub fn kelvin_to_rgb(kelvin: f32) -> Rgb {
    let t = kelvin.clamp(1000.0, 40000.0) / 100.0;
    let r = if t <= 66.0 {
        255.0
    } else {
        329.698_73 * (t - 60.0).powf(-0.133_204_76)
    };
    let g = if t <= 66.0 {
        99.470_8 * t.ln() - 161.119_57
    } else {
        288.122_16 * (t - 60.0).powf(-0.075_514_846)
    };
    let b = if t >= 66.0 {
        255.0
    } else if t <= 19.0 {
        0.0
    } else {
        138.517_73 * (t - 10.0).ln() - 305.044_8
    };
    [
        (r / 255.0).clamp(0.0, 1.0),
        (g / 255.0).clamp(0.0, 1.0),
        (b / 255.0).clamp(0.0, 1.0),
    ]
}

/// Reads a colour in any of homectl's forms (`{h,s}`, `{x,y}`, `{r,g,b}`
/// 0–255, `{ct}` in Kelvin) or a `"#rrggbb"` string. Brightness is separate.
pub fn from_json(v: &Value) -> Option<Rgb> {
    if let Some(s) = v.as_str() {
        return parse_hex(s);
    }
    let f = |k: &str| v.get(k).and_then(Value::as_f64).map(|v| v as f32);
    if let (Some(h), Some(s)) = (f("h"), f("s")) {
        let s = if s > 1.0 { s / 100.0 } else { s };
        return Some(hsv_to_rgb(h / 360.0, s.clamp(0.0, 1.0), 1.0));
    }
    if let (Some(x), Some(y)) = (f("x"), f("y")) {
        return Some(xy_to_rgb(x, y));
    }
    if let (Some(r), Some(g), Some(b)) = (f("r"), f("g"), f("b")) {
        return Some([r / 255.0, g / 255.0, b / 255.0].map(|c| c.clamp(0.0, 1.0)));
    }
    if let Some(ct) = f("ct") {
        // Values below 1000 are mireds.
        let kelvin = if ct < 1000.0 { 1_000_000.0 / ct } else { ct };
        return Some(kelvin_to_rgb(kelvin));
    }
    None
}

/// The homectl representation published for a colour.
pub fn to_json(c: Rgb) -> Value {
    let (h, s) = rgb_to_hs(c);
    let s = (f64::from(s) * 1000.0).round() / 1000.0;
    serde_json::json!({ "h": h.round() as u32 % 360, "s": s })
}

/// How a device turns perceptual colours into bytes.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Output {
    /// Byte order, e.g. `RGB`, `GRB` or `WRGB`.
    pub order: String,
    pub gamma: f32,
    /// Per-channel gains for white balance.
    pub gains: Rgb,
    /// How much of the common RGB part moves to the white LED (RGBW only).
    pub white: f32,
}

impl Output {
    pub fn for_bytes_per_led(bytes: usize) -> Self {
        Self {
            order: if bytes == 4 { "WRGB" } else { "RGB" }.into(),
            gamma: 2.2,
            gains: [1.0, 1.0, 1.0],
            white: 1.0,
        }
    }

    pub fn bytes_per_led(&self) -> usize {
        self.order.len()
    }

    /// Converts one perceptual frame (`brightness` per LED) to device bytes.
    pub fn encode(&self, frame: &[f32], brightness: &[f32], out: &mut Vec<u8>) {
        out.clear();
        let has_white = self.order.contains('W');
        let order = self.order.as_bytes();
        for (i, px) in frame.as_chunks::<3>().0.iter().enumerate() {
            let k = brightness.get(i).copied().unwrap_or(1.0);
            let lin = |v: f32, g: f32| (v.clamp(0.0, 1.0) * k).powf(self.gamma) * g;
            let mut r = lin(px[0], self.gains[0]);
            let mut g = lin(px[1], self.gains[1]);
            let mut b = lin(px[2], self.gains[2]);
            let mut w = 0.0;
            if has_white {
                w = r.min(g).min(b) * self.white.clamp(0.0, 1.0);
                r -= w;
                g -= w;
                b -= w;
            }
            for c in order {
                let v = match c {
                    b'R' => r,
                    b'G' => g,
                    b'B' => b,
                    _ => w,
                };
                out.push((v.clamp(0.0, 1.0) * 255.0).round() as u8);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_homectl_colors() {
        assert_eq!(
            from_json(&serde_json::json!("#ff8000")),
            Some([1.0, 128.0 / 255.0, 0.0])
        );
        assert_eq!(
            from_json(&serde_json::json!({"h": 120, "s": 1.0})),
            Some([0.0, 1.0, 0.0])
        );
        assert_eq!(
            from_json(&serde_json::json!({"r": 0, "g": 0, "b": 255})),
            Some([0.0, 0.0, 1.0])
        );
        let warm = from_json(&serde_json::json!({"ct": 2700})).unwrap();
        assert!(warm[0] > warm[1] && warm[1] > warm[2]);
        let white = from_json(&serde_json::json!({"x": 0.3127, "y": 0.329})).unwrap();
        assert!(white.iter().all(|c| (c - 1.0).abs() < 0.02), "{white:?}");
        assert_eq!(rgb_to_hs([0.0, 0.0, 1.0]), (240.0, 1.0));
    }

    #[test]
    fn encodes_rgbw_with_white_extraction() {
        let mut out = vec![];
        let o = Output {
            gamma: 1.0,
            ..Output::for_bytes_per_led(4)
        };
        o.encode(&[1.0, 1.0, 1.0, 1.0, 0.5, 0.0], &[1.0, 1.0], &mut out);
        assert_eq!(out, [255, 0, 0, 0, 0, 255, 128, 0]);
        let o = Output {
            gamma: 1.0,
            ..Output::for_bytes_per_led(3)
        };
        o.encode(&[1.0, 0.5, 0.0], &[0.5], &mut out);
        assert_eq!(out, [128, 64, 0]);
    }
}
