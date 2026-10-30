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
}

impl Default for FixtureState {
    fn default() -> Self {
        Self {
            power: false,
            brightness: 1.0,
            look: Look::default(),
            preset_id: None,
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
