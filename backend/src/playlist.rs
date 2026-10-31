//! Playlists: season windows, the order entries play in, and the built-in
//! seasonal playlists. The scheduler that plays them and starts and ends
//! their seasons lives in `app.rs`.

use crate::model::{Playlist, PlaylistEntry, Season};
use chrono::{Datelike, Duration, NaiveDate, Weekday};
use rand::{Rng, RngExt, seq::SliceRandom};
use serde_json::json;
use std::{sync::OnceLock, time::Instant};

/// The time zone seasons are judged in: `GLIMMER_TZ`, else `TZ`, else UTC.
fn zone() -> chrono_tz::Tz {
    static ZONE: OnceLock<chrono_tz::Tz> = OnceLock::new();
    *ZONE.get_or_init(|| {
        for var in ["GLIMMER_TZ", "TZ"] {
            let Ok(name) = std::env::var(var) else {
                continue;
            };
            let name = name.trim().trim_start_matches(':');
            if name.is_empty() {
                continue;
            }
            match name.parse() {
                Ok(tz) => return tz,
                Err(_) => tracing::warn!("{var}={name} is not a known time zone"),
            }
        }
        chrono_tz::UTC
    })
}

/// Today's date where the strings are.
pub fn today() -> NaiveDate {
    chrono::Utc::now().with_timezone(&zone()).date_naive()
}

/// Easter Sunday of a Gregorian year (the anonymous Gregorian algorithm).
pub fn easter(year: i32) -> NaiveDate {
    let a = year % 19;
    let b = year / 100;
    let c = year % 100;
    let d = b / 4;
    let e = b % 4;
    let f = (b + 8) / 25;
    let g = (b - f + 1) / 3;
    let h = (19 * a + b - d - g + 15) % 30;
    let i = c / 4;
    let k = c % 4;
    let l = (32 + 2 * e + 2 * i - h - k) % 7;
    let m = (a + 11 * h + 22 * l) / 451;
    let month = (h + l - 7 * m + 114) / 31;
    let day = (h + l - 7 * m + 114) % 31 + 1;
    NaiveDate::from_ymd_opt(year, month as u32, day as u32).expect("Easter is a real date")
}

/// Midsummer Eve (Juhannusaatto): the Friday from June 19 to 25.
pub fn midsummer_eve(year: i32) -> NaiveDate {
    let june19 = NaiveDate::from_ymd_opt(year, 6, 19).expect("a real date");
    let ahead = (7 + Weekday::Fri.num_days_from_monday() as i64
        - june19.weekday().num_days_from_monday() as i64)
        % 7;
    june19 + Duration::days(ahead)
}

/// `MM-DD` as (month, day). February 29 is allowed.
fn month_day(s: &str) -> Option<(u32, u32)> {
    let (m, d) = s.trim().split_once('-')?;
    let (m, d): (u32, u32) = (m.parse().ok()?, d.parse().ok()?);
    // 2000 was a leap year, so this accepts 02-29.
    NaiveDate::from_ymd_opt(2000, m, d).map(|_| (m, d))
}

/// A month and day in a year; February 29 is the 28th in common years.
fn on(year: i32, (m, d): (u32, u32)) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, m, d)
        .or_else(|| NaiveDate::from_ymd_opt(year, m, d - 1))
        .expect("checked dates")
}

impl Season {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Season::Dates { from, to } => {
                for v in [from, to] {
                    month_day(v).ok_or_else(|| format!("{v} is not a date like 12-24"))?;
                }
            }
            Season::Easter { easter: [a, b] } | Season::Midsummer { midsummer: [a, b] } => {
                if a > b || a.abs() > 60 || b.abs() > 60 {
                    return Err(
                        "The days must be in order and within 60 days of the holiday".into(),
                    );
                }
            }
        }
        Ok(())
    }

    /// The first and last day of the window that `date` falls in.
    pub fn occurrence(&self, date: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
        let y = date.year();
        let (start, end) = match self {
            Season::Dates { from, to } => {
                let (from, to) = (month_day(from)?, month_day(to)?);
                if from <= to {
                    (on(y, from), on(y, to))
                } else if (date.month(), date.day()) >= from {
                    (on(y, from), on(y + 1, to))
                } else {
                    (on(y - 1, from), on(y, to))
                }
            }
            // Within 60 days, these never reach into another year.
            Season::Easter { easter: [a, b] } => {
                let e = easter(y);
                (e + Duration::days(*a as i64), e + Duration::days(*b as i64))
            }
            Season::Midsummer { midsummer: [a, b] } => {
                let e = midsummer_eve(y);
                (e + Duration::days(*a as i64), e + Duration::days(*b as i64))
            }
        };
        (start <= date && date <= end).then_some((start, end))
    }
}

/// The scheduled playlists in season on `date`, outer (earlier, then longer)
/// windows first so that shorter ones nest on top of them.
pub fn starting(playlists: &[Playlist], date: NaiveDate) -> Vec<(&Playlist, NaiveDate, NaiveDate)> {
    let mut due: Vec<_> = playlists
        .iter()
        .filter(|p| p.auto_enabled && p.entries.iter().any(|e| e.enabled))
        .filter_map(|p| {
            let (start, end) = p.season.as_ref()?.occurrence(date)?;
            Some((p, start, end))
        })
        .collect();
    due.sort_by_key(|(p, start, end)| (*start, -(*end - *start).num_days(), p.sort));
    due
}

/// Whether a playlist's schedule still covers a fixture on `date`.
pub fn schedule_covers(p: &Playlist, fixture: &str, date: NaiveDate) -> bool {
    p.auto_enabled
        && p.lights
            .as_ref()
            .is_none_or(|l| l.iter().any(|f| f == fixture))
        && p.season
            .as_ref()
            .is_some_and(|s| s.occurrence(date).is_some())
}

/// The name homectl sees for a playlist in its preset list.
pub fn preset_name(p: &Playlist) -> String {
    format!("Playlist: {}", p.name)
}

/// One pass over `n` entries: in order, or shuffled so that `last` (the
/// entry just shown) doesn't play again straight away.
pub fn cycle<R: Rng + ?Sized>(
    n: usize,
    shuffle: bool,
    last: Option<usize>,
    rng: &mut R,
) -> Vec<usize> {
    let mut seq: Vec<usize> = (0..n).collect();
    if shuffle {
        seq.shuffle(rng);
        if n > 1 && Some(seq[0]) == last {
            let swap = rng.random_range(1..n);
            seq.swap(0, swap);
        }
    }
    seq
}

/// A playlist's enabled entries with their index in the whole list.
fn enabled(p: &Playlist) -> Vec<(usize, PlaylistEntry)> {
    p.entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.enabled)
        .map(|(i, e)| (i, e.clone()))
        .collect()
}

/// A fixture playing a playlist (kept in memory: a restart starts afresh).
pub struct Run {
    pub playlist: String,
    /// The enabled entries when the order was made, to notice edits.
    entries: Vec<(usize, PlaylistEntry)>,
    shuffle: bool,
    seq: Vec<usize>,
    pos: usize,
    pub started: Instant,
    started_ms: i64,
}

impl Run {
    pub fn start<R: Rng + ?Sized>(playlist: &Playlist, rng: &mut R) -> Option<Self> {
        let entries = enabled(playlist);
        if entries.is_empty() {
            return None;
        }
        Some(Self {
            playlist: playlist.id.clone(),
            seq: cycle(entries.len(), playlist.shuffle, None, rng),
            entries,
            shuffle: playlist.shuffle,
            pos: 0,
            started: Instant::now(),
            started_ms: now_ms(),
        })
    }

    pub fn current(&self) -> Option<&PlaylistEntry> {
        self.entries.get(*self.seq.get(self.pos)?).map(|(_, e)| e)
    }

    /// Index of the current entry in the playlist's whole list.
    pub fn index(&self) -> Option<usize> {
        self.entries.get(*self.seq.get(self.pos)?).map(|(i, _)| *i)
    }

    /// Whether the current entry is gone from (or disabled in) `playlist`.
    /// Changed settings don't count: the entry keeps playing its turn.
    pub fn current_removed(&self, playlist: &Playlist) -> bool {
        let Some((i, c)) = self
            .entries
            .get(*self.seq.get(self.pos).unwrap_or(&usize::MAX))
        else {
            return true;
        };
        playlist.id != self.playlist
            || playlist
                .entries
                .get(*i)
                .is_none_or(|e| !e.enabled || e.script_id != c.script_id)
    }

    pub fn duration_s(&self) -> f64 {
        self.current().map_or(60.0, |e| e.duration_s.max(1.0))
    }

    /// Moves to the next entry of `playlist`, which may have been edited.
    pub fn advance<R: Rng + ?Sized>(&mut self, playlist: &Playlist, rng: &mut R) -> bool {
        let entries = enabled(playlist);
        let n = entries.len();
        if n == 0 {
            return false;
        }
        if playlist.id != self.playlist {
            return match Self::start(playlist, rng) {
                Some(run) => {
                    *self = run;
                    true
                }
                None => false,
            };
        }
        if entries != self.entries || playlist.shuffle != self.shuffle {
            // Carry on after the current entry in the edited list.
            let current = self
                .seq
                .get(self.pos)
                .and_then(|&k| self.entries.get(k))
                .cloned();
            let current_at = self.seq.get(self.pos).copied().unwrap_or(0);
            // The same entry, even if its settings were changed.
            let at = current.and_then(|(ci, c)| {
                entries.iter().position(|(_, e)| *e == c).or_else(|| {
                    entries
                        .iter()
                        .position(|(i, e)| *i == ci && e.script_id == c.script_id)
                })
            });
            self.seq = cycle(n, playlist.shuffle, at, rng);
            self.pos = if playlist.shuffle {
                0
            } else {
                match at {
                    Some(i) => (i + 1) % n,
                    // The current entry was removed: its successor took its place.
                    None => current_at.min(n - 1),
                }
            };
            self.entries = entries;
            self.shuffle = playlist.shuffle;
        } else {
            let last = self.seq.get(self.pos).copied();
            self.pos += 1;
            if self.pos >= self.seq.len() {
                self.seq = cycle(n, self.shuffle, last, rng);
                self.pos = 0;
            }
        }
        self.started = Instant::now();
        self.started_ms = now_ms();
        true
    }

    /// What the UI shows about the playing entry.
    pub fn info(&self) -> serde_json::Value {
        json!({
            "playlistId": self.playlist,
            "entry": self.index(),
            "startedAt": self.started_ms,
            "durationS": self.duration_s(),
        })
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// A built-in playlist, added once (a user's edits and deletions stay).
pub struct Builtin {
    pub id: &'static str,
    pub name: &'static str,
    pub season: Option<Season>,
    /// Built-in effects whose id starts with this belong to the playlist,
    /// including ones added in later versions.
    pub prefix: Option<&'static str>,
    /// Effects for a playlist without a prefix.
    pub scripts: &'static [&'static str],
    pub duration_s: f64,
}

fn dates(from: &str, to: &str) -> Option<Season> {
    Some(Season::Dates {
        from: from.into(),
        to: to.into(),
    })
}

pub fn builtins() -> Vec<Builtin> {
    let seasonal = |id, name, season, prefix| Builtin {
        id,
        name,
        season,
        prefix: Some(prefix),
        scripts: &[],
        duration_s: 150.0,
    };
    vec![
        seasonal(
            "halloween",
            "Halloween",
            dates("10-01", "11-01"),
            "halloween-",
        ),
        seasonal("christmas", "Christmas", dates("12-01", "12-27"), "xmas-"),
        seasonal(
            "independence-day",
            "Independence Day",
            dates("12-05", "12-06"),
            "independence-",
        ),
        seasonal("new-year", "New Year", dates("12-28", "01-02"), "newyear-"),
        seasonal(
            "valentines",
            "Valentine's",
            dates("02-10", "02-14"),
            "valentine-",
        ),
        seasonal(
            "easter",
            "Easter",
            Some(Season::Easter { easter: [-7, 1] }),
            "easter-",
        ),
        seasonal("vappu", "Vappu", dates("04-28", "05-01"), "vappu-"),
        // Thursday to Sunday around Midsummer Eve.
        seasonal(
            "juhannus",
            "Juhannus",
            Some(Season::Midsummer { midsummer: [-1, 2] }),
            "juhannus-",
        ),
        // Through 02-29, so leap days are covered too.
        seasonal("winter", "Winter", dates("01-03", "02-29"), "winter-"),
        seasonal("spring", "Spring", dates("03-01", "05-31"), "spring-"),
        seasonal("summer", "Summer", dates("06-01", "08-31"), "summer-"),
        seasonal("autumn", "Autumn", dates("09-01", "11-30"), "autumn-"),
        Builtin {
            id: "everyday",
            name: "Everyday",
            season: None,
            prefix: None,
            scripts: &["candle", "aurora", "palette-drift", "lava-lamp", "ocean"],
            duration_s: 180.0,
        },
    ]
}

impl Builtin {
    pub fn entry(&self, script: &str) -> PlaylistEntry {
        PlaylistEntry {
            script_id: script.into(),
            preset_id: None,
            params: json!({}),
            colors: vec![],
            duration_s: self.duration_s,
            enabled: true,
        }
    }

    /// The effects (of `effects`, the built-in ones) that belong to it.
    pub fn scripts<'a>(&self, effects: &'a [String]) -> Vec<&'a String> {
        effects
            .iter()
            .filter(|id| match self.prefix {
                Some(prefix) => id.starts_with(prefix),
                None => self.scripts.contains(&id.as_str()),
            })
            .collect()
    }

    pub fn playlist(&self, effects: &[String], sort: i64) -> Playlist {
        Playlist {
            id: self.id.into(),
            name: self.name.into(),
            entries: self
                .scripts(effects)
                .into_iter()
                .map(|s| self.entry(s))
                .collect(),
            shuffle: true,
            transitions: Default::default(),
            auto_enabled: self.season.is_some(),
            season: self.season.clone(),
            lights: None,
            builtin: true,
            removed: vec![],
            sort,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    fn effects() -> Vec<String> {
        crate::builtin::all()
            .filter(|(_, _, transition)| !transition)
            .map(|(id, _, _)| id.to_string())
            .collect()
    }

    fn all() -> Vec<Playlist> {
        let effects = effects();
        builtins()
            .iter()
            .enumerate()
            .map(|(i, b)| b.playlist(&effects, i as i64))
            .collect()
    }

    #[test]
    fn holiday_dates() {
        assert_eq!(easter(2008), date(2008, 3, 23));
        assert_eq!(easter(2019), date(2019, 4, 21));
        assert_eq!(easter(2024), date(2024, 3, 31));
        assert_eq!(easter(2025), date(2025, 4, 20));
        assert_eq!(easter(2026), date(2026, 4, 5));
        assert_eq!(easter(2038), date(2038, 4, 25));
        assert_eq!(midsummer_eve(2024), date(2024, 6, 21));
        assert_eq!(midsummer_eve(2025), date(2025, 6, 20));
        assert_eq!(midsummer_eve(2026), date(2026, 6, 19));
        assert_eq!(midsummer_eve(2027), date(2027, 6, 25));
    }

    #[test]
    fn date_windows_wrap_the_new_year() {
        let ny = dates("12-28", "01-02").unwrap();
        let window = Some((date(2026, 12, 28), date(2027, 1, 2)));
        assert_eq!(ny.occurrence(date(2026, 12, 28)), window);
        assert_eq!(ny.occurrence(date(2026, 12, 31)), window);
        assert_eq!(ny.occurrence(date(2027, 1, 2)), window);
        assert_eq!(ny.occurrence(date(2027, 1, 3)), None);
        assert_eq!(ny.occurrence(date(2026, 12, 27)), None);
        let halloween = dates("10-01", "11-01").unwrap();
        assert!(halloween.occurrence(date(2026, 10, 31)).is_some());
        assert!(halloween.occurrence(date(2026, 11, 2)).is_none());
        assert!(dates("02-30", "03-01").unwrap().validate().is_err());
        assert!(dates("02-29", "03-01").unwrap().validate().is_ok());
        let winter = dates("01-03", "02-29").unwrap();
        assert_eq!(
            winter.occurrence(date(2027, 2, 28)).unwrap().1,
            date(2027, 2, 28)
        );
        assert_eq!(
            winter.occurrence(date(2028, 2, 29)).unwrap().1,
            date(2028, 2, 29)
        );
    }

    #[test]
    fn holiday_windows_are_relative() {
        let s = Season::Easter { easter: [-7, 1] };
        assert_eq!(
            s.occurrence(date(2026, 4, 1)),
            Some((date(2026, 3, 29), date(2026, 4, 6)))
        );
        assert_eq!(s.occurrence(date(2026, 4, 7)), None);
        assert!(Season::Easter { easter: [2, 1] }.validate().is_err());
        let juhannus = Season::Midsummer { midsummer: [-1, 2] };
        assert_eq!(
            juhannus.occurrence(date(2026, 6, 20)),
            Some((date(2026, 6, 18), date(2026, 6, 21)))
        );
        assert_eq!(juhannus.occurrence(date(2026, 6, 22)), None);
    }

    #[test]
    fn outer_windows_start_first() {
        let p = all();
        let ids = |y, m, d| -> Vec<String> {
            starting(&p, date(y, m, d))
                .into_iter()
                .map(|(p, _, _)| p.id.clone())
                .collect()
        };
        assert_eq!(ids(2026, 10, 31), ["autumn", "halloween"]);
        assert_eq!(ids(2026, 12, 5), ["christmas", "independence-day"]);
        assert_eq!(ids(2026, 4, 30), ["spring", "vappu"]);
        assert_eq!(ids(2026, 4, 1), ["spring", "easter"]);
        assert_eq!(ids(2026, 6, 19), ["summer", "juhannus"]);
        assert_eq!(ids(2027, 1, 1), ["new-year"]);
        assert_eq!(ids(2027, 2, 12), ["winter", "valentines"]);
        let mut christmas = p.iter().find(|p| p.id == "christmas").unwrap().clone();
        assert!(schedule_covers(&christmas, "Curtain", date(2026, 12, 27)));
        assert!(!schedule_covers(&christmas, "Curtain", date(2026, 12, 28)));
        christmas.lights = Some(vec!["Tree".into()]);
        assert!(!schedule_covers(&christmas, "Curtain", date(2026, 12, 20)));
        assert!(schedule_covers(&christmas, "Tree", date(2026, 12, 20)));
    }

    #[test]
    fn builtins_pick_effects_by_prefix() {
        let p = all();
        let halloween = p.iter().find(|p| p.id == "halloween").unwrap();
        assert!(halloween.entries.len() >= 3);
        assert!(
            halloween
                .entries
                .iter()
                .all(|e| e.script_id.starts_with("halloween-"))
        );
        assert_eq!(
            p.iter().find(|p| p.id == "everyday").unwrap().entries.len(),
            5
        );
    }

    #[test]
    fn shuffled_cycles_cover_everything_and_avoid_repeats() {
        let mut rng = rand::rng();
        assert_eq!(cycle(4, false, Some(3), &mut rng), vec![0, 1, 2, 3]);
        for _ in 0..200 {
            let mut seq = cycle(5, true, Some(2), &mut rng);
            assert_ne!(seq[0], 2);
            seq.sort();
            assert_eq!(seq, vec![0, 1, 2, 3, 4]);
        }
        assert_eq!(cycle(1, true, Some(0), &mut rng), vec![0]);
    }

    fn entry(script: &str) -> PlaylistEntry {
        PlaylistEntry {
            script_id: script.into(),
            preset_id: None,
            params: json!({}),
            colors: vec![],
            duration_s: 2.0,
            enabled: true,
        }
    }

    fn list(id: &str, scripts: &[&str], shuffle: bool) -> Playlist {
        Playlist {
            id: id.into(),
            name: id.into(),
            entries: scripts.iter().map(|s| entry(s)).collect(),
            shuffle,
            transitions: Default::default(),
            season: None,
            auto_enabled: false,
            lights: None,
            builtin: false,
            removed: vec![],
            sort: 0,
        }
    }

    fn script(run: &Run) -> &str {
        &run.current().unwrap().script_id
    }

    #[test]
    fn runs_play_in_order_and_follow_edits() {
        let mut rng = rand::rng();
        let mut p = list("a", &["x", "y", "z"], false);
        let mut run = Run::start(&p, &mut rng).unwrap();
        let mut seen = vec![script(&run).to_string()];
        for _ in 0..4 {
            run.advance(&p, &mut rng);
            seen.push(script(&run).to_string());
        }
        assert_eq!(seen, ["x", "y", "z", "x", "y"]);
        // Removing the current entry ("y") moves on to the one after it.
        p.entries.remove(1);
        assert!(run.current_removed(&p));
        run.advance(&p, &mut rng);
        assert_eq!(script(&run), "z");
        // A new entry after the current one plays next.
        p.entries.push(entry("w"));
        run.advance(&p, &mut rng);
        assert_eq!(script(&run), "w");
        // Disabled entries are skipped, and keep their place in the list.
        p.entries[0].enabled = false;
        run.advance(&p, &mut rng);
        assert_eq!((script(&run), run.index()), ("z", Some(1)));
        p.entries[1].enabled = false;
        assert!(run.current_removed(&p));
        p.entries[2].enabled = false;
        assert!(!run.advance(&p, &mut rng), "nothing left to play");
        assert!(Run::start(&p, &mut rng).is_none());
    }

    #[test]
    fn changed_settings_keep_the_entry_playing() {
        let mut rng = rand::rng();
        let mut p = list("a", &["x", "y", "z"], false);
        let mut run = Run::start(&p, &mut rng).unwrap();
        run.advance(&p, &mut rng);
        // Colours saved into the playing entry ("y") don't cut its turn short,
        // and the next turn still moves on.
        p.entries[1].colors = vec!["#ff0000".into()];
        assert!(!run.current_removed(&p));
        run.advance(&p, &mut rng);
        assert_eq!(script(&run), "z");
        run.advance(&p, &mut rng);
        run.advance(&p, &mut rng);
        assert_eq!(run.current().unwrap().colors, ["#ff0000"]);
    }

    #[test]
    fn shuffled_runs_play_each_entry_once_per_cycle() {
        let mut rng = rand::rng();
        let p = list("a", &["v", "w", "x", "y", "z"], true);
        let mut run = Run::start(&p, &mut rng).unwrap();
        let mut played = vec![run.index().unwrap()];
        for _ in 0..49 {
            let last = run.index();
            run.advance(&p, &mut rng);
            assert_ne!(run.index(), last, "no entry repeats back to back");
            played.push(run.index().unwrap());
        }
        for pass in played.chunks(5) {
            let mut pass = pass.to_vec();
            pass.sort();
            assert_eq!(pass, vec![0, 1, 2, 3, 4]);
        }
    }
}
