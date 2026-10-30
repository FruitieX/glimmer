//! Uploaded images and GIFs, scaled down and stored for effects to sample
//! through `image(id)`.

use crate::script::ImageAsset;
use image::{AnimationDecoder, ImageFormat, RgbaImage, codecs::gif::GifDecoder, imageops};
use rusqlite::{Connection, OptionalExtension, params};
use std::io::Cursor;

/// Longest side after scaling; LED fixtures have far fewer pixels than this.
const MAX_SIDE: u32 = 64;
const MAX_FRAMES: usize = 400;

fn to_rgb(img: &RgbaImage, width: u32, height: u32) -> Vec<u8> {
    let small = imageops::resize(img, width, height, imageops::FilterType::Triangle);
    small
        .pixels()
        .flat_map(|p| {
            // Transparent areas become black, i.e. LEDs off.
            let a = p[3] as u32;
            [0, 1, 2].map(|c| ((p[c] as u32 * a) / 255) as u8)
        })
        .collect()
}

fn scaled(w: u32, h: u32) -> (u32, u32) {
    let k = MAX_SIDE as f32 / w.max(h).max(1) as f32;
    if k >= 1.0 {
        (w.max(1), h.max(1))
    } else {
        (
            ((w as f32 * k).round() as u32).max(1),
            ((h as f32 * k).round() as u32).max(1),
        )
    }
}

pub fn decode(bytes: &[u8]) -> Result<ImageAsset, String> {
    let format = image::guess_format(bytes)
        .map_err(|_| "That isn't a GIF, PNG or JPEG image.".to_string())?;
    let mut frames: Vec<(RgbaImage, f32)> = vec![];
    if format == ImageFormat::Gif {
        let decoder = GifDecoder::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        for frame in decoder.into_frames().take(MAX_FRAMES) {
            let frame = frame.map_err(|e| e.to_string())?;
            let (n, d) = frame.delay().numer_denom_ms();
            let seconds = if d == 0 {
                0.1
            } else {
                n as f32 / d as f32 / 1000.0
            };
            // Browsers treat very short GIF delays as 0.1 s.
            let seconds = if seconds < 0.02 { 0.1 } else { seconds };
            frames.push((frame.into_buffer(), seconds));
        }
    } else {
        let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
        frames.push((img.to_rgba8(), 1.0));
    }
    let Some((first, _)) = frames.first() else {
        return Err("The image has no frames.".into());
    };
    let (width, height) = scaled(first.width(), first.height());
    Ok(ImageAsset {
        width,
        height,
        delays: frames.iter().map(|(_, d)| *d).collect(),
        frames: frames
            .iter()
            .map(|(img, _)| to_rgb(img, width, height))
            .collect(),
    })
}

pub fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS images(
            id TEXT PRIMARY KEY, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
            frames BLOB NOT NULL, delays TEXT NOT NULL, created INTEGER NOT NULL)",
    )
    .map_err(|e| e.to_string())
}

pub fn save(db: &Connection, id: &str, name: &str, asset: &ImageAsset) -> Result<(), String> {
    let data: Vec<u8> = asset.frames.concat();
    db.execute(
        "INSERT INTO images(id,name,width,height,frames,delays,created) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            id,
            name,
            asset.width,
            asset.height,
            data,
            serde_json::to_string(&asset.delays).map_err(|e| e.to_string())?,
            crate::db::now()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load(db: &Connection, id: &str) -> Result<Option<ImageAsset>, String> {
    let row = db
        .query_row(
            "SELECT width,height,frames,delays FROM images WHERE id=?1",
            [id],
            |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, u32>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((width, height, data, delays)) = row else {
        return Ok(None);
    };
    let size = (width * height * 3) as usize;
    let delays: Vec<f32> = serde_json::from_str(&delays).map_err(|e| e.to_string())?;
    Ok(Some(ImageAsset {
        width,
        height,
        frames: data.chunks(size.max(1)).map(<[u8]>::to_vec).collect(),
        delays,
    }))
}

/// A new effect that plays an uploaded image on the LEDs.
pub fn effect_source(id: &str, name: &str) -> String {
    let name = serde_json::to_string(name).unwrap_or_else(|_| "\"Image\"".into());
    format!(
        r#"export const meta = {{
  name: {name},
  description: "Plays an uploaded image across the LEDs.",
  category: "Images",
  antialias: true,
  params: {{
    speed: {{ type: "number", label: "Speed", min: 0, max: 3, step: 0.05, default: 1 }},
    fit: {{ type: "select", label: "Fit", options: ["cover", "contain", "stretch"], labels: ["Fill the light", "Show all of it", "Stretch"], default: "cover" }},
    mirror: {{ type: "boolean", label: "Mirror", default: false }},
    pan: {{ type: "number", label: "Pan speed", min: -1, max: 1, step: 0.01, default: 0 }},
  }},
}};

const IMAGE = "{id}";

export function render(ctx) {{
  const {{ n, x, y, out, params, t, aspect }} = ctx;
  const img = image(IMAGE);
  const frame = imageFrame(img, t * params.speed);
  const imgAspect = img.width / img.height;
  // Scale so the image covers (or fits inside) the light, keeping its shape.
  let sx = 1, sy = 1;
  if (params.fit !== "stretch") {{
    const wider = imgAspect > aspect;
    const cover = params.fit === "cover";
    if (wider === cover) sx = aspect / imgAspect;
    else sy = imgAspect / aspect;
  }}
  for (let i = 0; i < n; i++) {{
    let px = (x[i] - 0.5) * sx + 0.5 + t * params.pan * 0.2;
    const py = (y[i] - 0.5) * sy + 0.5;
    if (params.mirror) px = 1 - px;
    px = px - Math.floor(px);
    if (py < 0 || py > 1) continue;
    out.set(sampleImage(img, frame, px, py), i * 3);
  }}
}}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_and_scales_images() {
        let img = RgbaImage::from_pixel(200, 100, image::Rgba([255, 0, 0, 255]));
        let mut png = vec![];
        img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
            .unwrap();
        let asset = decode(&png).unwrap();
        assert_eq!((asset.width, asset.height), (64, 32));
        assert_eq!(asset.frames.len(), 1);
        assert_eq!(&asset.frames[0][..3], &[255, 0, 0]);
        assert!(decode(b"nope").is_err());
    }
}
