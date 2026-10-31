//! `glimmer preview <script.js> <out.png> [seconds] [frames] [--look <name>]`:
//! renders a contact sheet of an effect (or transition) without any lights,
//! for checking scripts by eye. Each frame shows a 10 × 21 curtain and, below
//! it, a 120-LED straight string. Effects show their defaults, or one of their
//! `meta.looks` by name; `--look all` gives one row per look, the defaults
//! first.

use crate::script::{Rgb, Scripts};
use image::{GenericImage, Rgb as Px, RgbImage};
use std::time::Instant;

const CELL: u32 = 9;
const BACKGROUND: Px<u8> = Px([10, 10, 16]);

fn curtain() -> Vec<[f32; 3]> {
    (0..210)
        .map(|i| [(i / 21) as f32 / 9.0, 1.0 - (i % 21) as f32 / 20.0, 0.5])
        .collect()
}

fn strip() -> Vec<[f32; 3]> {
    (0..120).map(|i| [i as f32 / 119.0, 0.5, 0.5]).collect()
}

fn px(c: &[f32]) -> Px<u8> {
    Px([
        (c[0].clamp(0.0, 1.0) * 255.0) as u8,
        (c[1].clamp(0.0, 1.0) * 255.0) as u8,
        (c[2].clamp(0.0, 1.0) * 255.0) as u8,
    ])
}

fn dot(img: &mut RgbImage, cx: u32, cy: u32, c: &[f32]) {
    for dy in 0..CELL - 2 {
        for dx in 0..CELL - 2 {
            img.put_pixel(cx + dx, cy + dy, px(c));
        }
    }
}

/// One contact sheet: `frames` frames over `seconds`, six to a row, and the
/// slowest frame in milliseconds.
fn sheet(
    source: &str,
    transition: bool,
    params: &serde_json::Value,
    colors: &[Rgb],
    seconds: f64,
    frames: usize,
    cols: u32,
) -> Result<(RgbImage, f64), String> {
    let scripts = Scripts::new()?;
    scripts.register("s", source)?;
    let layouts = [("c", curtain(), 10.0 / 21.0 * 2.0), ("s", strip(), 20.0)];
    for (id, pts, aspect) in &layouts {
        scripts.layout(id, pts, *aspect)?;
        scripts.create(&format!("i{id}"), "s", id, params, colors)?;
        if transition {
            scripts.register("from", crate::builtin::source("rainbow").unwrap())?;
            scripts.register("to", crate::builtin::source("twinkle").unwrap())?;
            scripts.create(&format!("f{id}"), "from", id, &serde_json::json!({}), &[])?;
            scripts.create(
                &format!("t{id}"),
                "to",
                id,
                &serde_json::json!({}),
                &[[1.0, 0.95, 0.85], [0.1, 0.15, 0.4]],
            )?;
        }
    }
    let rows = (frames as u32).div_ceil(cols);
    let pw = 10 * CELL + 12;
    let ph = 21 * CELL + 2 * CELL + 16;
    let mut img = RgbImage::from_pixel(pw * cols, ph * rows, BACKGROUND);
    let mut slowest = 0.0f64;
    for f in 0..frames {
        let t = seconds * f as f64 / frames.max(1) as f64;
        let (ox, oy) = ((f as u32 % cols) * pw + 6, (f as u32 / cols) * ph + 6);
        for (id, pts, _) in &layouts {
            let mut buf = vec![0.0; pts.len() * 3];
            let start = Instant::now();
            if transition {
                let mut a = vec![0.0; buf.len()];
                let mut b = vec![0.0; buf.len()];
                scripts.render(&format!("f{id}"), t, 0.04, &mut a)?;
                scripts.render(&format!("t{id}"), t, 0.04, &mut b)?;
                let p = f as f64 / (frames.max(2) - 1) as f64;
                scripts.blend(&format!("i{id}"), Some(&a), Some(&b), p, t, 0.04, &mut buf)?;
            } else {
                // Step through time so stateful simulations see real dt.
                scripts.render(
                    &format!("i{id}"),
                    t,
                    seconds / frames.max(1) as f64,
                    &mut buf,
                )?;
            }
            slowest = slowest.max(start.elapsed().as_secs_f64() * 1000.0);
            for (i, c) in buf.chunks(3).enumerate() {
                if *id == "c" {
                    dot(
                        &mut img,
                        ox + (i as u32 / 21) * CELL,
                        oy + (i as u32 % 21) * CELL,
                        c,
                    );
                } else {
                    // The strip wraps onto two rows of 60 under the curtain.
                    let (col, row) = (i as u32 % 60, i as u32 / 60);
                    let x = ox + col * (pw - 12) / 60;
                    let y = oy + 21 * CELL + 4 + row * (CELL - 2);
                    for dy in 0..CELL - 4 {
                        img.put_pixel(x, y + dy, px(c));
                        img.put_pixel(x + 1, y + dy, px(c));
                    }
                }
            }
        }
    }
    Ok((img, slowest))
}

pub fn run(
    path: &str,
    out: &str,
    seconds: f64,
    frames: usize,
    look: Option<&str>,
) -> Result<(), String> {
    let source = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    // A transition fails when rendered as an effect (it has no frames to blend).
    let (transition, (meta, avg)) = match Scripts::check(&source, false) {
        Ok(r) => (false, r),
        Err(effect_error) => match Scripts::check(&source, true) {
            Ok(r) => (true, r),
            Err(_) => return Err(effect_error),
        },
    };
    let defaults: Vec<String> = meta.colors.iter().map(|c| c.default.clone()).collect();
    let mut looks = vec![("Default", serde_json::json!({}), defaults)];
    for l in &meta.looks {
        let params = serde_json::Value::Object(l.params.clone());
        looks.push((l.name.as_str(), params, l.colors.clone()));
    }
    let names: Vec<&str> = looks.iter().map(|l| l.0).collect();
    let picked: Vec<_> = match look {
        None => looks.into_iter().take(1).collect(),
        Some("all") => looks,
        Some(name) => {
            let found: Vec<_> = looks.into_iter().filter(|l| l.0 == name).collect();
            if found.is_empty() {
                return Err(format!(
                    "{} has no look {name:?} (it has {names:?})",
                    meta.name
                ));
            }
            found
        }
    };
    // All looks: one row each, so they compare at a glance.
    let cols = if picked.len() > 1 { frames as u32 } else { 6 };
    let mut sheets = vec![];
    let mut slowest = 0.0f64;
    for (_, params, colors) in &picked {
        let colors: Vec<Rgb> = colors
            .iter()
            .filter_map(|c| crate::color::parse_hex(c))
            .collect();
        let (img, slow) = sheet(&source, transition, params, &colors, seconds, frames, cols)?;
        slowest = slowest.max(slow);
        sheets.push(img);
    }
    let (w, h) = (sheets[0].width(), sheets[0].height());
    let gap = if sheets.len() > 1 { 6 } else { 0 };
    let mut img = RgbImage::from_pixel(w, (h + gap) * sheets.len() as u32 - gap, Px([40, 40, 52]));
    for (i, s) in sheets.iter().enumerate() {
        img.copy_from(s, 0, i as u32 * (h + gap))
            .map_err(|e| e.to_string())?;
    }
    img.save(out).map_err(|e| e.to_string())?;
    let shown: Vec<&str> = picked.iter().map(|l| l.0).collect();
    println!(
        "{} ({}): {frames} frames over {seconds} s written to {out}, looks {shown:?} (of {names:?}); check frame {:.2} ms, slowest {slowest:.2} ms; category {:?}, antialias {}, loops {}",
        meta.name,
        if transition { "transition" } else { "effect" },
        avg.as_secs_f64() * 1000.0,
        meta.category,
        meta.antialias,
        meta.loops
    );
    Ok(())
}
