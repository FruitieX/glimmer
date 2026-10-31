//! Shared domain types, stored as JSON in SQLite and sent to the browser.

use crate::{color::Output, device};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A physical Twinkly string.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub enabled: bool,
    pub led_count: usize,
    pub output: Output,
    /// Upper bound for the realtime frame rate.
    pub max_fps: f32,
    /// Prefer uploading loopable looks as movies over streaming them.
    #[serde(default)]
    pub prefer_movies: bool,
    /// Allow erasing every movie on the device (including Twinkly app ones)
    /// when its movie memory is full.
    #[serde(default)]
    pub allow_clearing_movies: bool,
    /// Last device information and mapping read from the string.
    #[serde(default)]
    pub info: Option<device::Gestalt>,
    #[serde(default)]
    pub layout: Option<device::Layout>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LayoutMode {
    /// The positions mapped in the Twinkly app.
    #[default]
    Device,
    /// A straight horizontal line in LED order.
    Linear,
    /// Strands of `strand` LEDs side by side, alternating direction when `zigzag`.
    Grid { strand: usize, zigzag: bool },
    /// A straight strip along the mapped positions' main direction.
    Along,
}

/// A controllable part of a device: what homectl and the UI see as one light.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fixture {
    /// Also the MQTT id: `home/lights/twinkly/<id>`.
    pub id: String,
    pub name: String,
    pub device_id: String,
    pub start: usize,
    pub count: usize,
    #[serde(default)]
    pub reversed: bool,
    #[serde(default)]
    pub layout: LayoutMode,
    #[serde(default)]
    pub transitions: Transitions,
    #[serde(default)]
    pub sort: i64,
    /// Whether seasonal playlists switch this light over when their season starts.
    #[serde(default = "yes")]
    pub seasonal: bool,
    /// Effect size: above 1 features look bigger (less of the effect shows),
    /// below 1 smaller. 0.25..4.
    #[serde(default = "one")]
    pub scale: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TransitionSpec {
    pub script_id: String,
    pub duration_ms: u32,
    #[serde(default)]
    pub params: Value,
}

impl TransitionSpec {
    pub fn new(script_id: &str, duration_ms: u32, params: Value) -> Self {
        Self {
            script_id: script_id.into(),
            duration_ms,
            params,
        }
    }
}

/// The transitions a slot can use; one is picked at random each time.
/// Sent and stored as a list. A single spec (the older format, and what
/// simple API clients send) reads as a list of one.
#[derive(Clone, Debug, Serialize, PartialEq, Default)]
#[serde(transparent)]
pub struct TransitionChoice(pub Vec<TransitionSpec>);

impl<'de> Deserialize<'de> for TransitionChoice {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            One(TransitionSpec),
            Many(Vec<TransitionSpec>),
        }
        Ok(match Repr::deserialize(d)? {
            Repr::One(spec) => Self(vec![spec]),
            Repr::Many(list) => Self(list),
        })
    }
}

impl TransitionChoice {
    pub fn one(spec: TransitionSpec) -> Self {
        Self(vec![spec])
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &TransitionSpec> {
        self.0.iter()
    }

    /// Picks one at random, avoiding `last` (the previous pick) while there
    /// is anything else to choose. `None` when the list is empty.
    pub fn pick(
        &self,
        last: Option<&TransitionSpec>,
        rng: &mut impl rand::Rng,
    ) -> Option<&TransitionSpec> {
        use rand::RngExt;
        let fresh: Vec<&TransitionSpec> = self.0.iter().filter(|s| Some(*s) != last).collect();
        let from: Vec<&TransitionSpec> = if fresh.is_empty() {
            self.0.iter().collect()
        } else {
            fresh
        };
        match from.len() {
            0 => None,
            1 => Some(from[0]),
            n => Some(from[rng.random_range(0..n)]),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transitions {
    pub on: TransitionChoice,
    pub off: TransitionChoice,
    pub change: TransitionChoice,
}

impl Transitions {
    pub fn all(&self) -> impl Iterator<Item = &TransitionSpec> {
        self.on
            .iter()
            .chain(self.off.iter())
            .chain(self.change.iter())
    }
}

impl Default for Transitions {
    fn default() -> Self {
        Self {
            on: TransitionChoice::one(TransitionSpec::new(
                "wipe",
                1500,
                serde_json::json!({"direction": "up"}),
            )),
            off: TransitionChoice::one(TransitionSpec::new(
                "wipe",
                1500,
                serde_json::json!({"direction": "down"}),
            )),
            change: TransitionChoice::one(TransitionSpec::new("fade", 1200, Value::Null)),
        }
    }
}

/// What a fixture shows when on: an effect with its settings.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Look {
    pub script_id: String,
    #[serde(default)]
    pub params: Value,
    /// `#rrggbb` per colour slot of the effect.
    #[serde(default)]
    pub colors: Vec<String>,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            script_id: "solid".into(),
            params: Value::Object(Default::default()),
            colors: vec!["#ffb46b".into()],
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixtureState {
    pub power: bool,
    /// 0..1
    pub brightness: f32,
    pub look: Look,
    /// The preset the look came from, while unchanged.
    #[serde(default)]
    pub preset_id: Option<String>,
    /// The playlist choosing the look.
    #[serde(default)]
    pub playlist_id: Option<String>,
    /// Set while a playlist's schedule put it on, until the user picks
    /// something else.
    #[serde(default)]
    pub scheduled: Option<Box<Scheduled>>,
}

/// A scheduled playlist on a fixture and what to go back to afterwards.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scheduled {
    pub playlist_id: String,
    /// Last day of the window, `YYYY-MM-DD`.
    pub until: String,
    pub resume: Selection,
}

/// What a fixture showed before a schedule took over.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub look: Look,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub playlist_id: Option<String>,
    /// An outer schedule that was showing (windows nest).
    #[serde(default)]
    pub scheduled: Option<Box<Scheduled>>,
}

impl Default for FixtureState {
    fn default() -> Self {
        Self {
            power: false,
            brightness: 1.0,
            look: Look::default(),
            preset_id: None,
            playlist_id: None,
            scheduled: None,
        }
    }
}

/// A saved look that homectl scenes and the UI can pick by name.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub look: Look,
    #[serde(default)]
    pub sort: i64,
}

/// One look in a playlist and how long it shows.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub script_id: String,
    /// When set (and the preset exists), the preset's look is shown instead.
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub params: Value,
    #[serde(default)]
    pub colors: Vec<String>,
    #[serde(default = "default_entry_s")]
    pub duration_s: f64,
    /// Disabled entries are skipped.
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn default_entry_s() -> f64 {
    60.0
}

fn one() -> f32 {
    1.0
}

fn yes() -> bool {
    true
}

/// When a playlist is in season, every year.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Season {
    /// `MM-DD` to `MM-DD`, both included; may wrap over the new year.
    Dates { from: String, to: String },
    /// Days relative to (Gregorian) Easter Sunday, both included.
    Easter { easter: [i32; 2] },
    /// Days relative to Midsummer Eve (the Friday from June 19 to 25).
    Midsummer { midsummer: [i32; 2] },
}

/// Looks shown one after another; homectl and the UI pick it like a preset.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub entries: Vec<PlaylistEntry>,
    #[serde(default)]
    pub shuffle: bool,
    /// Used between entries instead of the light's own change transitions;
    /// empty: the light's.
    #[serde(default)]
    pub transitions: TransitionChoice,
    #[serde(default)]
    pub season: Option<Season>,
    /// Put the playlist on by itself when its season starts.
    #[serde(default)]
    pub auto_enabled: bool,
    /// The lights the schedule applies to; none: all of them.
    #[serde(default)]
    pub lights: Option<Vec<String>>,
    /// Added by the app (and still editable).
    #[serde(default)]
    pub builtin: bool,
    /// Effects the user took out of a built-in playlist, so new built-in
    /// effects are added but these don't come back.
    #[serde(default)]
    pub removed: Vec<String>,
    #[serde(default)]
    pub sort: i64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScriptKind {
    Effect,
    Transition,
}

/// A script and the source of one of its versions.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSource {
    pub id: String,
    pub version: i64,
    pub kind: ScriptKind,
    pub source: String,
}

impl ScriptSource {
    /// The key under which a runtime registers this version.
    pub fn key(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }
}

/// Lower-case slug for ids.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(id: &str) -> TransitionSpec {
        TransitionSpec::new(id, 1000, Value::Null)
    }

    #[test]
    fn picks_never_repeat_straight_away() {
        let mut rng = rand::rng();
        let choice = TransitionChoice(vec![spec("fade"), spec("wipe"), spec("iris")]);
        let mut last: Option<TransitionSpec> = None;
        let mut seen = std::collections::HashSet::new();
        for _ in 0..200 {
            let pick = choice.pick(last.as_ref(), &mut rng).unwrap().clone();
            assert_ne!(Some(&pick), last.as_ref());
            seen.insert(pick.script_id.clone());
            last = Some(pick);
        }
        assert_eq!(seen.len(), 3, "every transition gets picked");
        // Two alternate.
        let two = TransitionChoice(vec![spec("fade"), spec("wipe")]);
        let first = two.pick(None, &mut rng).unwrap().clone();
        let second = two.pick(Some(&first), &mut rng).unwrap();
        assert_ne!(&first, second);
    }

    #[test]
    fn single_and_empty_choices() {
        let mut rng = rand::rng();
        let one = TransitionChoice::one(spec("fade"));
        // A single transition is used every time, even right after itself.
        assert_eq!(one.pick(Some(&spec("fade")), &mut rng), Some(&spec("fade")));
        assert_eq!(one.pick(None, &mut rng), Some(&spec("fade")));
        assert_eq!(TransitionChoice::default().pick(None, &mut rng), None);
        // Duplicates don't leave nothing to pick.
        let same = TransitionChoice(vec![spec("fade"), spec("fade")]);
        assert_eq!(
            same.pick(Some(&spec("fade")), &mut rng),
            Some(&spec("fade"))
        );
    }

    #[test]
    fn reads_single_transitions_from_older_data() {
        let old = json!({
            "on": {"scriptId": "wipe", "durationMs": 1500, "params": {"direction": "up"}},
            "off": {"scriptId": "wipe", "durationMs": 1500},
            "change": [
                {"scriptId": "fade", "durationMs": 1200, "params": null},
                {"scriptId": "iris", "durationMs": 900, "params": {"rim": 0.3}}
            ]
        });
        let t: Transitions = serde_json::from_value(old).unwrap();
        assert_eq!(t.on.0.len(), 1);
        assert_eq!(t.on.0[0].params, json!({"direction": "up"}));
        assert_eq!(t.off.0[0].params, Value::Null);
        assert_eq!(t.change.0[1].script_id, "iris");
        // Written back as lists.
        let back = serde_json::to_value(&t).unwrap();
        assert!(back["on"].is_array());
        assert_eq!(serde_json::from_value::<Transitions>(back).unwrap(), t);
        // Playlists from before playlist transitions have none.
        let p: Playlist = serde_json::from_value(json!({
            "id": "calm", "name": "Calm", "entries": []
        }))
        .unwrap();
        assert!(p.transitions.is_empty());
        assert!(
            serde_json::from_value::<Transitions>(json!({"on": 3, "off": [], "change": []}))
                .is_err()
        );
    }
}
