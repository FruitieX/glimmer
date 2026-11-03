//! Normalised LED positions for a fixture: x right, y up, z towards the
//! viewer, each scaled to 0..1 across the fixture.

use crate::{
    device,
    model::{Device, Fixture, LayoutMode},
};

#[derive(Clone, Debug, PartialEq)]
pub struct FixtureLayout {
    /// Where the LEDs are, for drawing the light.
    pub points: Vec<[f32; 3]>,
    /// Width / height before normalisation (1 when either is flat).
    pub aspect: f32,
    /// Each LED's place along the light, when that isn't the LED order.
    pub u: Option<Vec<f32>>,
    /// Typical gap between neighbouring LEDs, when the scripts shouldn't
    /// work it out from the positions.
    pub spacing: Option<f32>,
    /// The light's effect size (`Fixture::scale`).
    pub scale: f32,
}

/// What scripts see of a fixture: its layout zoomed by its effect size.
pub struct ScriptLayout {
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    pub z: Vec<f32>,
    pub u: Vec<f32>,
    pub aspect: f32,
    pub spacing: Option<f32>,
}

pub const MIN_SCALE: f32 = 0.25;
pub const MAX_SCALE: f32 = 4.0;

impl FixtureLayout {
    /// Positions in LED order, without an effect size.
    pub fn plain(points: Vec<[f32; 3]>, aspect: f32) -> Self {
        Self {
            points,
            aspect,
            u: None,
            spacing: None,
            scale: 1.0,
        }
    }

    /// Zooms every coordinate about the centre, so a scale of 2 shows half
    /// of the 0..1 world (features look twice as big) and 0.5 shows twice
    /// as much. The aspect stays: the shape of the light doesn't change.
    pub fn for_scripts(&self) -> ScriptLayout {
        let k = 1.0 / self.scale.clamp(MIN_SCALE, MAX_SCALE);
        let zoom = |v: f32| (v - 0.5) * k + 0.5;
        let n = self.points.len();
        let u = match &self.u {
            Some(u) => u.iter().map(|&v| zoom(v)).collect(),
            None => (0..n)
                .map(|i| {
                    zoom(if n > 1 {
                        i as f32 / (n - 1) as f32
                    } else {
                        0.0
                    })
                })
                .collect(),
        };
        ScriptLayout {
            x: self.points.iter().map(|p| zoom(p[0])).collect(),
            y: self.points.iter().map(|p| zoom(p[1])).collect(),
            z: self.points.iter().map(|p| zoom(p[2])).collect(),
            u,
            aspect: self.aspect,
            spacing: self.spacing.map(|s| s * k),
        }
    }
}

fn normalise(raw: Vec<[f32; 3]>) -> FixtureLayout {
    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    for p in &raw {
        for a in 0..3 {
            lo[a] = lo[a].min(p[a]);
            hi[a] = hi[a].max(p[a]);
        }
    }
    let span = |a: usize| hi[a] - lo[a];
    let points = raw
        .iter()
        .map(|p| {
            let mut q = [0.5; 3];
            for a in 0..3 {
                if span(a) > 1e-4 {
                    q[a] = (p[a] - lo[a]) / span(a);
                }
            }
            q
        })
        .collect();
    let aspect = if span(0) > 1e-4 && span(1) > 1e-4 {
        span(0) / span(1)
    } else {
        1.0
    };
    FixtureLayout::plain(points, aspect)
}

/// Lays a light out as a straight strip along its main direction: the
/// principal axis of its positions, running bottom → top (or left → right
/// when it's nearly level, or towards the viewer when it points at them).
/// `x` and `u` are each LED's place along that axis, 0..1, so effects that
/// run along the string follow it physically rather than the order the
/// LEDs zigzag in.
fn along(raw: &[[f32; 3]]) -> FixtureLayout {
    let n = raw.len();
    let t = project(raw);
    let lo = t.iter().copied().fold(f32::MAX, f32::min);
    let hi = t.iter().copied().fold(f32::MIN, f32::max);
    let span = hi - lo;
    let u: Vec<f32> = t
        .iter()
        .map(|&v| if span > 1e-6 { (v - lo) / span } else { 0.5 })
        .collect();
    let gaps = (n.max(2) - 1) as f32;
    FixtureLayout {
        points: u.iter().map(|&v| [v, 0.5, 0.5]).collect(),
        // Treat the strip as about six LEDs thick, so effects see a long
        // line (a 120-LED string comes out at 20:1).
        aspect: (gaps / 6.0).max(4.0),
        // The mean gap: projected neighbours can land almost on top of
        // each other, so the nearest one says little.
        spacing: Some(1.0 / gaps),
        u: Some(u),
        scale: 1.0,
    }
}

/// Each point's coordinate along the principal axis of `raw`, oriented as
/// `along` describes. Not normalised.
fn project(raw: &[[f32; 3]]) -> Vec<f32> {
    let n = raw.len().max(1) as f32;
    let mut mean = [0.0f32; 3];
    for p in raw {
        for a in 0..3 {
            mean[a] += p[a] / n;
        }
    }
    let mut cov = [[0.0f32; 3]; 3];
    for p in raw {
        let d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
        for a in 0..3 {
            for b in 0..3 {
                cov[a][b] += d[a] * d[b] / n;
            }
        }
    }
    let norm = |v: [f32; 3]| (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    // Power iteration from the column with the most variance in it.
    let start = (0..3)
        .max_by(|&a, &b| cov[a][a].total_cmp(&cov[b][b]))
        .unwrap_or(0);
    let mut v = cov[start];
    for _ in 0..64 {
        let w = [0, 1, 2].map(|a| cov[a][0] * v[0] + cov[a][1] * v[1] + cov[a][2] * v[2]);
        let len = norm(w);
        if len < 1e-12 {
            break;
        }
        v = w.map(|c| c / len);
    }
    let len = norm(v);
    if len < 1e-9 {
        // No spread at all.
        return vec![0.0; raw.len()];
    }
    v = v.map(|c| c / len);
    // Upwards unless it's within about 12° of level; then left → right.
    let sign = if v[1].abs() > 0.2 {
        v[1].signum()
    } else if v[0].abs() >= v[2].abs() {
        v[0].signum()
    } else {
        v[2].signum()
    };
    raw.iter()
        .map(|p| {
            sign * ((p[0] - mean[0]) * v[0] + (p[1] - mean[1]) * v[1] + (p[2] - mean[2]) * v[2])
        })
        .collect()
}

/// Moves LEDs that the Twinkly app mapped far away from every other LED
/// (more than 8× the typical distance to the nearest one) to the middle of
/// their neighbours along the string. One such glitch would otherwise squash
/// the rest of its light into a corner once positions are normalised.
pub fn repair_strays(layout: &mut device::Layout) {
    let p: Vec<[f32; 3]> = layout.coordinates.iter().map(|c| [c.x, c.y, c.z]).collect();
    let n = p.len();
    if n < 4 {
        return;
    }
    let dist = |a: &[f32; 3], b: &[f32; 3]| {
        ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
    };
    let nearest: Vec<f32> = (0..n)
        .map(|i| {
            (0..n)
                .filter(|&j| j != i)
                .map(|j| dist(&p[i], &p[j]))
                .fold(f32::MAX, f32::min)
        })
        .collect();
    let mut sorted = nearest.clone();
    sorted.sort_by(f32::total_cmp);
    let typical = sorted[n / 2];
    if typical <= 1e-6 {
        return;
    }
    let stray: Vec<bool> = nearest.iter().map(|d| *d > typical * 8.0).collect();
    // Leave layouts alone where many points look stray: that's not a glitch.
    if stray.iter().filter(|s| **s).count() * 20 > n {
        return;
    }
    layout.repaired.clear();
    for i in (0..n).filter(|&i| stray[i]) {
        let before = (0..i).rev().find(|&j| !stray[j]).map(|j| p[j]);
        let after = (i + 1..n).find(|&j| !stray[j]).map(|j| p[j]);
        let q = match (before, after) {
            (Some(a), Some(b)) => [
                (a[0] + b[0]) / 2.0,
                (a[1] + b[1]) / 2.0,
                (a[2] + b[2]) / 2.0,
            ],
            (Some(a), None) | (None, Some(a)) => a,
            (None, None) => continue,
        };
        let c = &mut layout.coordinates[i];
        (c.x, c.y, c.z) = (q[0], q[1], q[2]);
        layout.repaired.push(i);
    }
}

pub fn fixture_layout(device: &Device, fixture: &Fixture) -> FixtureLayout {
    let n = fixture.count;
    let in_order = || (0..n).map(|i| [i as f32, 0.0, 0.0]).collect();
    let mut raw: Vec<[f32; 3]> = match &fixture.layout {
        LayoutMode::Device | LayoutMode::Along => match &device.layout {
            Some(layout)
                if layout.coordinates.len() >= fixture.start + n && layout.source != "linear" =>
            {
                layout.coordinates[fixture.start..fixture.start + n]
                    .iter()
                    .map(|p| [p.x, p.y, p.z])
                    .collect()
            }
            _ => in_order(),
        },
        LayoutMode::Linear => in_order(),
        LayoutMode::Grid { strand, zigzag } => {
            let strand = (*strand).max(1);
            (0..n)
                .map(|i| {
                    let col = i / strand;
                    let mut row = i % strand;
                    if *zigzag && col % 2 == 1 {
                        row = strand - 1 - row;
                    }
                    // LED 0 hangs at the top of the first strand.
                    [col as f32, (strand - 1 - row) as f32, 0.0]
                })
                .collect()
        }
    };
    if fixture.reversed {
        raw.reverse();
    }
    let mut l = match fixture.layout {
        LayoutMode::Along => along(&raw),
        _ => normalise(raw),
    };
    l.scale = fixture.scale;
    l
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{color::Output, device};

    fn device(layout: Option<device::Layout>) -> Device {
        Device {
            kind: crate::model::DeviceKind::Twinkly,
            id: "d".into(),
            name: "D".into(),
            ip: "192.0.2.1".into(),
            enabled: true,
            led_count: 4,
            output: Output::for_bytes_per_led(3),
            max_fps: 25.0,
            prefer_movies: false,
            allow_clearing_movies: false,
            info: None,
            lifx: None,
            layout,
        }
    }

    fn fixture(start: usize, count: usize, layout: LayoutMode) -> Fixture {
        Fixture {
            id: "f".into(),
            name: "F".into(),
            device_id: "d".into(),
            start,
            count,
            reversed: false,
            layout,
            transitions: Default::default(),
            sort: 0,
            seasonal: true,
            scale: 1.0,
        }
    }

    #[test]
    fn candle_zones_keep_their_order() {
        let mut d = device(None);
        d.kind = crate::model::DeviceKind::Lifx;
        d.led_count = 26;
        d.layout = Some(crate::device::lifx::candle_layout());
        let all = fixture_layout(&d, &fixture(0, 26, LayoutMode::Device));
        assert_eq!(all.points.len(), 26);
        let top = all.points[0];
        assert!(
            top[1] > all.points[1..].iter().map(|p| p[1]).fold(0.0, f32::max),
            "the top cap sits above the body"
        );
        // Splitting the cap off gives it one point and the body the rest.
        let cap = fixture_layout(&d, &fixture(0, 1, LayoutMode::Device));
        assert_eq!(cap.points.len(), 1);
        let body = fixture_layout(&d, &fixture(1, 25, LayoutMode::Device));
        assert_eq!(body.points.len(), 25);
    }

    #[test]
    fn slices_and_normalises_the_device_mapping() {
        let coords = [(-1.0, 0.0), (0.0, 0.5), (1.0, 1.0), (3.0, 1.0)]
            .iter()
            .map(|&(x, y)| device::Point { x, y, z: 0.0 })
            .collect();
        let d = device(Some(device::Layout {
            source: "2d".into(),
            synthesized: false,
            coordinates: coords,
            repaired: vec![],
        }));
        let l = fixture_layout(&d, &fixture(0, 3, LayoutMode::Device));
        assert_eq!(
            l.points,
            [[0.0, 0.0, 0.5], [0.5, 0.5, 0.5], [1.0, 1.0, 0.5]]
        );
        assert_eq!(l.aspect, 2.0);
        let l = fixture_layout(&d, &fixture(2, 2, LayoutMode::Device));
        assert_eq!(l.points, [[0.0, 0.5, 0.5], [1.0, 0.5, 0.5]]);
    }

    #[test]
    fn stray_mapped_leds_move_between_their_neighbours() {
        let mut coordinates: Vec<device::Point> = (0..40)
            .map(|i| device::Point {
                x: (i % 10) as f32 * 0.1,
                y: (i / 10) as f32 * 0.1,
                z: 0.0,
            })
            .collect();
        coordinates[17].x = 6.5;
        let mut layout = device::Layout {
            source: "3d".into(),
            synthesized: false,
            coordinates,
            repaired: vec![],
        };
        repair_strays(&mut layout);
        assert_eq!(layout.repaired, [17]);
        let c = &layout.coordinates[17];
        assert!((c.x - 0.7).abs() < 1e-5 && (c.y - 0.1).abs() < 1e-5);
        // A second pass finds nothing more.
        repair_strays(&mut layout);
        assert!(layout.repaired.is_empty());
    }

    #[test]
    fn grids_hang_from_the_top() {
        let l = fixture_layout(
            &device(None),
            &fixture(
                0,
                4,
                LayoutMode::Grid {
                    strand: 2,
                    zigzag: true,
                },
            ),
        );
        assert_eq!(l.points[0], [0.0, 1.0, 0.5]);
        assert_eq!(l.points[2], [1.0, 0.0, 0.5]);
    }

    #[test]
    fn along_lays_a_noisy_diagonal_band_out_bottom_to_top() {
        // A string zigzagging up a staircase from the right: 3.5 wide, 1 high,
        // with each LED jumping across the banister and back.
        let n = 200;
        let coords = (0..n)
            .map(|i| {
                let t = i as f32 / (n - 1) as f32;
                let side = if i % 2 == 0 { 0.08 } else { -0.08 };
                let jitter = (hash(i) - 0.5) * 0.04;
                device::Point {
                    x: 3.5 * (1.0 - t) + side + jitter,
                    y: t + side * 0.5 - jitter,
                    z: side,
                }
            })
            .collect();
        let d = device(Some(device::Layout {
            source: "3d".into(),
            synthesized: false,
            coordinates: coords,
            repaired: vec![],
        }));
        let l = fixture_layout(&d, &fixture(0, n, LayoutMode::Along));
        let u = l.u.clone().unwrap();
        // The first LED is at the bottom; the strip is flat in y and z.
        assert!(u[0] < 0.03 && u[n - 1] > 0.97, "{} {}", u[0], u[n - 1]);
        assert!(l.points.iter().all(|p| p[1] == 0.5 && p[2] == 0.5));
        assert!(l.points.iter().zip(&u).all(|(p, u)| p[0] == *u));
        // In physical order apart from the zigzag: each LED is near its share
        // of the way up, and a few LEDs further along is always higher.
        let off = (0..n)
            .map(|i| (u[i] - i as f32 / (n - 1) as f32).abs())
            .fold(0.0, f32::max);
        assert!(off < 0.05, "{off}");
        assert!((10..n).all(|i| u[i] > u[i - 10]));
        assert!(l.aspect > 2.5);
        assert!((l.spacing.unwrap() - 1.0 / 199.0).abs() < 1e-6);
    }

    #[test]
    fn along_runs_left_to_right_when_level_and_in_order_unmapped() {
        let coords = (0..10)
            .map(|i| device::Point {
                x: 9.0 - i as f32,
                y: if i % 2 == 0 { 0.1 } else { 0.0 },
                z: 0.0,
            })
            .collect();
        let d = device(Some(device::Layout {
            source: "2d".into(),
            synthesized: false,
            coordinates: coords,
            repaired: vec![],
        }));
        let u = fixture_layout(&d, &fixture(0, 10, LayoutMode::Along))
            .u
            .unwrap();
        assert!(u[0] > 0.99 && u[9] < 0.01);
        let u = fixture_layout(&device(None), &fixture(0, 5, LayoutMode::Along))
            .u
            .unwrap();
        assert_eq!(u, [0.0, 0.25, 0.5, 0.75, 1.0]);
    }

    #[test]
    fn scale_zooms_about_the_centre() {
        let mut f = fixture(0, 5, LayoutMode::Along);
        f.scale = 2.0;
        let l = fixture_layout(&device(None), &f);
        // What the light shows stays put; scripts see the zoomed world.
        assert_eq!(l.points[0], [0.0, 0.5, 0.5]);
        let s = l.for_scripts();
        assert_eq!(s.x, [0.25, 0.375, 0.5, 0.625, 0.75]);
        assert_eq!(s.u, s.x);
        assert_eq!(s.y, [0.5; 5]);
        assert_eq!(s.spacing, Some(0.125));
        assert_eq!(s.aspect, l.aspect);
        let mut f = fixture(0, 3, LayoutMode::Linear);
        f.scale = 0.5;
        let s = fixture_layout(&device(None), &f).for_scripts();
        assert_eq!(s.x, [-0.5, 0.5, 1.5]);
        assert_eq!(s.u, [-0.5, 0.5, 1.5]);
        assert_eq!(s.spacing, None);
    }

    fn hash(i: usize) -> f32 {
        ((i as u32).wrapping_mul(2654435761) >> 8) as f32 / (1u32 << 24) as f32
    }
}
