//! Application state shared by the web API and MQTT: storage, the engine,
//! and change notifications.

use crate::{
    ai::Ai,
    color::{self, Output},
    db,
    device::Client,
    engine::{Command, Engine, Transition},
    model::{
        Device, Fixture, FixtureState, LayoutMode, Look, Preset, ScriptSource, TransitionSpec,
    },
};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;
use std::sync::{Arc, Mutex, MutexGuard};
use tokio::sync::broadcast;

#[derive(Clone, Debug)]
pub enum Event {
    /// A fixture's state changed.
    State(String),
    /// Devices, fixtures, presets or scripts changed.
    Config,
}

pub struct App {
    db: Arc<Mutex<Connection>>,
    pub engine: Engine,
    pub events: broadcast::Sender<Event>,
    pub ai: Option<Ai>,
}

/// A change to a fixture's state, from the UI or MQTT. Absent fields stay.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePatch {
    pub power: Option<bool>,
    pub brightness: Option<f32>,
    /// Preset id or name.
    pub preset: Option<String>,
    pub look: Option<Look>,
    pub script_id: Option<String>,
    /// Merged into the look's params.
    pub params: Option<serde_json::Map<String, Value>>,
    /// `#rrggbb` per colour slot.
    pub colors: Option<Vec<String>>,
    /// Replaces the first colour slot.
    pub color: Option<String>,
    pub transition_ms: Option<u32>,
    pub transition: Option<TransitionSpec>,
}

/// Initial devices, read once from `TWINKLY_SEED` when the database is empty.
#[derive(Deserialize)]
struct SeedDevice {
    name: String,
    ip: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    fixtures: Vec<SeedFixture>,
}

#[derive(Deserialize)]
struct SeedFixture {
    id: String,
    #[serde(default)]
    start: usize,
    /// 0: up to the end of the string.
    #[serde(default)]
    count: usize,
}

fn yes() -> bool {
    true
}

pub fn new_device(name: &str, ip: &str, enabled: bool) -> Device {
    Device {
        id: crate::model::slug(name),
        name: name.trim().into(),
        ip: ip.trim().into(),
        enabled,
        led_count: 0,
        output: Output::for_bytes_per_led(3),
        max_fps: 25.0,
        prefer_movies: false,
        allow_clearing_movies: false,
        info: None,
        layout: None,
    }
}

pub fn new_fixture(id: &str, device: &Device, start: usize, count: usize, sort: i64) -> Fixture {
    Fixture {
        id: id.trim().into(),
        name: id.trim().into(),
        device_id: device.id.clone(),
        start,
        count,
        reversed: false,
        layout: LayoutMode::Device,
        transitions: Default::default(),
        sort,
    }
}

impl App {
    pub fn new(db: Connection, ai: Option<Ai>) -> Arc<Self> {
        let db = Arc::new(Mutex::new(db));
        let lookup = {
            let db = db.clone();
            Arc::new(move |id: &str| -> Option<ScriptSource> {
                db.lock()
                    .ok()
                    .and_then(|db| db::script_source(&db, id, None).ok().flatten())
            })
        };
        Arc::new(Self {
            db,
            engine: Engine::new(lookup),
            events: broadcast::channel(256).0,
            ai,
        })
    }

    pub fn db(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.db.lock().map_err(|e| e.to_string())
    }

    pub fn changed(&self) {
        let _ = self.events.send(Event::Config);
    }

    /// Imports seed devices into an empty database.
    pub fn seed(&self, json: &str) -> Result<(), String> {
        let db = self.db()?;
        if !db::devices(&db)?.is_empty() {
            return Ok(());
        }
        let seed: Vec<SeedDevice> =
            serde_json::from_str(json).map_err(|e| format!("TWINKLY_SEED: {e}"))?;
        let mut sort = 0;
        for d in seed {
            let device = new_device(&d.name, &d.ip, d.enabled);
            db::save_device(&db, &device)?;
            let fixtures = if d.fixtures.is_empty() {
                vec![SeedFixture {
                    id: d.name.clone(),
                    start: 0,
                    count: 0,
                }]
            } else {
                d.fixtures
            };
            for f in fixtures {
                sort += 1;
                let fixture = new_fixture(&f.id, &device, f.start, f.count, sort);
                db::save_fixture(&db, &fixture, &FixtureState::default())?;
            }
            tracing::info!("seeded device {}", device.name);
        }
        Ok(())
    }

    /// Starts workers for enabled devices and restores fixtures that were on.
    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        let devices = db::devices(&*self.db()?)?;
        for device in devices {
            if device.enabled && device.info.is_none() {
                let app = self.clone();
                let id = device.id.clone();
                std::thread::spawn(move || {
                    if let Err(e) = app.refresh_device(&id) {
                        tracing::warn!("reading {id}: {e}");
                    }
                });
            } else {
                self.sync_device(&device.id, true)?;
            }
        }
        Ok(())
    }

    /// Pushes a device's configuration to the engine; optionally restores
    /// its fixtures that are on.
    pub fn sync_device(&self, id: &str, restore: bool) -> Result<(), String> {
        let (device, fixtures) = {
            let db = self.db()?;
            let Some(device) = db::device(&db, id)? else {
                drop(db);
                self.engine.remove(id);
                return Ok(());
            };
            let fixtures: Vec<(Fixture, FixtureState)> = db::fixtures(&db)?
                .into_iter()
                .filter(|(f, _)| f.device_id == id)
                .collect();
            (device, fixtures)
        };
        if device.led_count == 0 {
            // Nothing is known about the string yet.
            self.engine.remove(id);
            return Ok(());
        }
        self.engine.configure(
            device.clone(),
            fixtures.iter().map(|(f, _)| f.clone()).collect(),
        );
        if restore && device.enabled {
            for (f, state) in fixtures.into_iter().filter(|(_, s)| s.power) {
                self.engine.send(
                    &device.id,
                    Command::Apply {
                        fixture: f.id,
                        state,
                        transition: Transition::Instant,
                        brightness_ms: Some(0),
                        draft: None,
                    },
                );
            }
        }
        Ok(())
    }

    /// Reads LED count, colour profile and mapping from the string.
    pub fn refresh_device(&self, id: &str) -> Result<Device, String> {
        let device = db::device(&*self.db()?, id)?.ok_or("no such device")?;
        let client = Client::new(&device.ip);
        let gestalt = client.gestalt()?;
        let layout = client.layout().ok();
        let mut device = device;
        let bytes = gestalt.bytes_per_led();
        if device.output.bytes_per_led() != bytes {
            device.output = Output::for_bytes_per_led(bytes);
        }
        device.led_count = gestalt.number_of_led;
        if device.info.is_none()
            && let Some(fps) = gestalt.frame_rate.filter(|f| *f > 0.0)
        {
            // The reported rate is what the string's own effects use; realtime runs faster.
            device.max_fps = if fps < 20.0 {
                25.0
            } else {
                fps.min(30.0) as f32
            };
        }
        device.info = Some(gestalt);
        device.layout = layout;
        {
            let db = self.db()?;
            db::save_device(&db, &device)?;
            // Fill in fixtures that run to the end of the string.
            for (mut f, state) in db::fixtures(&db)?
                .into_iter()
                .filter(|(f, _)| f.device_id == id)
            {
                let max = device.led_count.saturating_sub(f.start);
                if f.count == 0 || f.count > max {
                    f.count = max;
                    db::save_fixture(&db, &f, &state)?;
                }
            }
        }
        self.sync_device(id, true)?;
        self.changed();
        Ok(device)
    }

    pub fn fixture(&self, id: &str) -> Result<(Fixture, FixtureState), String> {
        db::fixture(&*self.db()?, id)?.ok_or_else(|| format!("no fixture {id}"))
    }

    fn find_preset(db: &Connection, key: &str) -> Result<Option<Preset>, String> {
        let key = key.trim();
        Ok(db::presets(db)?
            .into_iter()
            .find(|p| p.id == key || p.name.eq_ignore_ascii_case(key)))
    }

    /// Applies a change to a fixture, stores it and shows it.
    pub fn set_state(&self, id: &str, patch: StatePatch) -> Result<FixtureState, String> {
        let (fixture, state) = {
            let db = self.db()?;
            let (fixture, mut state) =
                db::fixture(&db, id)?.ok_or_else(|| format!("no fixture {id}"))?;
            if let Some(key) = &patch.preset {
                let preset = Self::find_preset(&db, key)?
                    .ok_or_else(|| format!("no preset called {key}"))?;
                state.look = preset.look;
                state.preset_id = Some(preset.id);
            }
            if let Some(look) = patch.look.clone() {
                if db::script_source(&db, &look.script_id, None)?.is_none() {
                    return Err(format!("no effect {}", look.script_id));
                }
                state.look = look;
                state.preset_id = None;
            }
            if let Some(script) = &patch.script_id
                && *script != state.look.script_id
            {
                if db::script_source(&db, script, None)?.is_none() {
                    return Err(format!("no effect {script}"));
                }
                state.look = Look {
                    script_id: script.clone(),
                    params: Value::Object(Default::default()),
                    colors: vec![],
                };
                state.preset_id = None;
            }
            if let Some(params) = &patch.params {
                if !state.look.params.is_object() {
                    state.look.params = Value::Object(Default::default());
                }
                if let Some(map) = state.look.params.as_object_mut() {
                    for (k, v) in params {
                        map.insert(k.clone(), v.clone());
                    }
                }
                state.preset_id = None;
            }
            if let Some(colors) = &patch.colors {
                state.look.colors = colors
                    .iter()
                    .map(|c| {
                        color::parse_hex(c)
                            .map(color::to_hex)
                            .ok_or(format!("bad colour {c}"))
                    })
                    .collect::<Result<_, _>>()?;
            }
            if let Some(c) = &patch.color {
                let c = color::parse_hex(c).ok_or(format!("bad colour {c}"))?;
                if state.look.colors.is_empty() {
                    state.look.colors.push(color::to_hex(c));
                } else {
                    state.look.colors[0] = color::to_hex(c);
                }
            }
            if let Some(p) = patch.power {
                state.power = p;
            }
            if let Some(b) = patch.brightness {
                state.brightness = b.clamp(0.0, 1.0);
            }
            db::save_state(&db, id, &state)?;
            (fixture, state)
        };
        let transition = match (&patch.transition, patch.transition_ms) {
            (Some(spec), _) => Transition::Spec(spec.clone()),
            (None, Some(0)) => Transition::Instant,
            _ => Transition::Auto,
        };
        self.engine.send(
            &fixture.device_id,
            Command::Apply {
                fixture: fixture.id.clone(),
                state: state.clone(),
                transition,
                brightness_ms: patch.transition_ms,
                draft: None,
            },
        );
        let _ = self.events.send(Event::State(id.to_string()));
        Ok(state)
    }

    /// Shows an unsaved script on a fixture until its state is set again.
    pub fn try_draft(&self, id: &str, draft: ScriptSource, look: Look) -> Result<(), String> {
        let (fixture, mut state) = self.fixture(id)?;
        state.power = true;
        state.look = look;
        self.engine.send(
            &fixture.device_id,
            Command::Apply {
                fixture: fixture.id,
                state,
                transition: Transition::Auto,
                brightness_ms: None,
                draft: Some(draft),
            },
        );
        Ok(())
    }

    /// Re-shows the saved state (ending a draft preview).
    pub fn restore(&self, id: &str) -> Result<(), String> {
        let (fixture, state) = self.fixture(id)?;
        self.engine.send(
            &fixture.device_id,
            Command::Apply {
                fixture: fixture.id,
                state,
                transition: Transition::Auto,
                brightness_ms: None,
                draft: None,
            },
        );
        Ok(())
    }
}
