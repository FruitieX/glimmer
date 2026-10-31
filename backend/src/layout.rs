//! Normalised LED positions for a fixture: x right, y up, z towards the
//! viewer, each scaled to 0..1 across the fixture.

use crate::{
    device,
    model::{Device, Fixture, LayoutMode},
};

pub struct FixtureLayout {
    pub points: Vec<[f32; 3]>,
    /// Width / height before normalisation (1 when either is flat).
    pub aspect: f32,
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
    FixtureLayout { points, aspect }
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
    let mut raw: Vec<[f32; 3]> = match &fixture.layout {
        LayoutMode::Device => match &device.layout {
            Some(layout)
                if layout.coordinates.len() >= fixture.start + n && layout.source != "linear" =>
            {
                layout.coordinates[fixture.start..fixture.start + n]
                    .iter()
                    .map(|p| [p.x, p.y, p.z])
                    .collect()
            }
            _ => (0..n).map(|i| [i as f32, 0.0, 0.0]).collect(),
        },
        LayoutMode::Linear => (0..n).map(|i| [i as f32, 0.0, 0.0]).collect(),
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
    normalise(raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{color::Output, device};

    fn device(layout: Option<device::Layout>) -> Device {
        Device {
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
        }
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
}
