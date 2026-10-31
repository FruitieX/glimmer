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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Transitions {
    pub on: TransitionSpec,
    pub off: TransitionSpec,
    pub change: TransitionSpec,
}

impl Default for Transitions {
    fn default() -> Self {
        Self {
            on: TransitionSpec::new("wipe", 1500, serde_json::json!({"direction": "up"})),
            off: TransitionSpec::new("wipe", 1500, serde_json::json!({"direction": "down"})),
            change: TransitionSpec::new("fade", 1200, Value::Null),
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
