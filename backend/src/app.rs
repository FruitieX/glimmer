//! Application state shared by the web API and MQTT: storage, the engine,
//! the playlist scheduler and change notifications.

use crate::{
    ai::Ai,
    color::{self, Output},
    db,
    device::Client,
    engine::{Command, Engine, Transition},
    model::{
        Device, DeviceKind, Fixture, FixtureState, LayoutMode, Look, Playlist, PlaylistEntry,
        Preset, Scheduled, ScriptSource, Selection, Settings, Slot, TransitionSpec,
    },
    playlist::{self, Run},
};
use chrono::NaiveDate;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tokio::sync::broadcast;

#[derive(Clone, Debug)]
pub enum Event {
    /// A fixture's state changed.
    State(String),
    /// Devices, fixtures, presets, playlists or scripts changed.
    Config,
}

pub struct App {
    db: Arc<Mutex<Connection>>,
    /// Fixtures playing a playlist, by fixture id. Locked after `db`.
    runs: Mutex<HashMap<String, Run>>,
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
    /// Preset id or name; also takes playlists (`Playlist: <name>`) for homectl.
    pub preset: Option<String>,
    /// Playlist id or name.
    pub playlist: Option<String>,
    pub look: Option<Look>,
    pub script_id: Option<String>,
    /// Merged into the look's params.
    pub params: Option<serde_json::Map<String, Value>>,
    /// `params` replace the look's params instead (absent: back to the
    /// defaults), as when picking one of an effect's built-in looks. Unlike
    /// `look`, this keeps a playing playlist going.
    #[serde(default)]
    pub replace_params: bool,
    /// `#rrggbb` per colour slot.
    pub colors: Option<Vec<String>>,
    /// Replaces the first colour slot.
    pub color: Option<String>,
    pub transition_ms: Option<u32>,
    pub transition: Option<TransitionSpec>,
}

/// Initial devices, read once from `GLIMMER_SEED` when the database is empty.
#[derive(Deserialize)]
struct SeedDevice {
    #[serde(default)]
    kind: DeviceKind,
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

pub fn new_device(name: &str, ip: &str, enabled: bool, kind: DeviceKind) -> Device {
    Device {
        kind,
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
        lifx: None,
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
        seasonal: true,
        scale: 1.0,
    }
}

impl App {
    /// `images` is a separate connection for scripts' `image(id)`: scripts
    /// also run while `db` is locked (checking a script before saving it).
    pub fn new(db: Connection, images: Connection, ai: Option<Ai>) -> Arc<Self> {
        let db = Arc::new(Mutex::new(db));
        {
            // Scripts' image(id) reads uploads once and keeps them in memory.
            let db = Mutex::new(images);
            let cache: Mutex<std::collections::HashMap<String, Arc<crate::script::ImageAsset>>> =
                Mutex::default();
            let _ = crate::script::IMAGES.set(Arc::new(move |id: &str| {
                if let Some(a) = cache.lock().ok()?.get(id) {
                    return Some(a.clone());
                }
                let asset = Arc::new(crate::images::load(&*db.lock().ok()?, id).ok()??);
                cache.lock().ok()?.insert(id.to_string(), asset.clone());
                Some(asset)
            }));
        }
        let transitions = db::settings(&db.lock().unwrap())
            .map(|s| s.transitions)
            .unwrap_or_else(|e| {
                tracing::error!("reading settings: {e}");
                Default::default()
            });
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
            runs: Mutex::default(),
            engine: Engine::new(lookup, transitions),
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

    pub fn settings(&self) -> Result<Settings, String> {
        db::settings(&*self.db()?)
    }

    /// Saves the settings; lights following the transitions for all lights
    /// use the new ones from their next change.
    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        let db = self.db()?;
        db::save_settings(&db, settings)?;
        self.engine.set_transitions(settings.transitions.clone());
        drop(db);
        self.changed();
        Ok(())
    }

    /// Makes every light follow the transitions for all lights in `slot`.
    /// Returns the lights that had their own.
    pub fn follow_all(&self, slot: Slot) -> Result<Vec<String>, String> {
        let (changed, devices) = {
            let db = self.db()?;
            let mut changed = vec![];
            let mut devices = vec![];
            for (mut f, state) in db::fixtures(&db)? {
                if f.transitions.slot_mut(slot).take().is_some() {
                    db::save_fixture(&db, &f, &state)?;
                    changed.push(f.id);
                    if !devices.contains(&f.device_id) {
                        devices.push(f.device_id);
                    }
                }
            }
            (changed, devices)
        };
        for d in devices {
            self.sync_device(&d, false)?;
        }
        self.changed();
        Ok(changed)
    }

    /// Imports seed devices into an empty database.
    pub fn seed(&self, json: &str) -> Result<(), String> {
        let db = self.db()?;
        if !db::devices(&db)?.is_empty() {
            return Ok(());
        }
        let seed: Vec<SeedDevice> =
            serde_json::from_str(json).map_err(|e| format!("GLIMMER_SEED: {e}"))?;
        let mut sort = 0;
        for d in seed {
            let device = new_device(&d.name, &d.ip, d.enabled, d.kind);
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
                Self::skip_running_schedules(&db, &fixture.id)?;
            }
            tracing::info!("seeded device {}", device.name);
        }
        Ok(())
    }

    /// Starts workers for enabled devices, restores fixtures that were on
    /// (playlists from their start) and the playlist scheduler.
    pub fn start(self: &Arc<Self>) -> Result<(), String> {
        // Seasons that started or ended while the app was down.
        self.run_schedules(playlist::today())?;
        let devices = {
            let db = self.db()?;
            for (f, mut state) in db::fixtures(&db)? {
                let running = self
                    .runs
                    .lock()
                    .map_err(|e| e.to_string())?
                    .contains_key(&f.id);
                if state.power && state.playlist_id.is_some() && !running {
                    self.restart(&db, &f.id, &mut state)?;
                    db::save_state(&db, &f.id, &state)?;
                }
            }
            db::devices(&db)?
        };
        let app = Arc::downgrade(self);
        std::thread::Builder::new()
            .name("playlists".into())
            .spawn(move || {
                let mut round = 1;
                while let Some(app) = app.upgrade() {
                    if let Err(e) = app.tick(round) {
                        tracing::warn!("playlists: {e}");
                    }
                    drop(app);
                    round += 1;
                    std::thread::sleep(Duration::from_millis(500));
                }
            })
            .map_err(|e| e.to_string())?;
        for device in devices {
            if device.enabled && device.led_count == 0 {
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

    /// Reads the LED count, colour profile and mapping from the device.
    pub fn refresh_device(&self, id: &str) -> Result<Device, String> {
        let mut device = db::device(&*self.db()?, id)?.ok_or("no such device")?;
        match device.kind {
            DeviceKind::Twinkly => {
                let client = Client::new(&device.ip);
                let gestalt = client.gestalt()?;
                let layout = client.layout().ok().map(|mut l| {
                    crate::layout::repair_strays(&mut l);
                    l
                });
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
            }
            DeviceKind::Lifx => {
                let mut client = crate::device::lifx::Client::new(&device.ip)?;
                let version = client.version()?;
                let zones = crate::device::lifx::zone_count(version.product);
                if device.lifx.is_none() {
                    device.max_fps = 20.0;
                }
                device.led_count = zones;
                device.lifx = Some(version);
                device.info = None;
                // A Candle's 26 zones have a known shape; single-zone bulbs
                // fall back to a straight line.
                device.layout = (zones == 26).then(crate::device::lifx::candle_layout);
                device.output = Output::for_bytes_per_led(3);
            }
        }
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

    /// A playlist's id from its id, name, or `Playlist: <name>`.
    fn find_playlist(db: &Connection, key: &str) -> Result<Option<String>, String> {
        let key = key.trim();
        let key = match key.get(..9) {
            Some(p) if p.eq_ignore_ascii_case("playlist:") => key[9..].trim(),
            _ => key,
        };
        Ok(db::playlists(db)?
            .into_iter()
            .find(|p| p.id == key || p.name.eq_ignore_ascii_case(key))
            .map(|p| p.id))
    }

    /// An entry's look: its preset's, when it names one that exists.
    fn entry_look(db: &Connection, entry: &PlaylistEntry) -> Result<Option<Look>, String> {
        if let Some(id) = &entry.preset_id
            && let Some(p) = db::presets(db)?.into_iter().find(|p| p.id == *id)
        {
            return Ok(Some(p.look));
        }
        if db::script_source(db, &entry.script_id, None)?.is_none() {
            return Ok(None);
        }
        Ok(Some(Look {
            script_id: entry.script_id.clone(),
            params: if entry.params.is_object() {
                entry.params.clone()
            } else {
                Value::Object(Default::default())
            },
            colors: entry.colors.clone(),
        }))
    }

    /// Moves a fixture's playlist on (or starts it) and returns the look to
    /// show, skipping entries whose effect is gone. `None` when there is
    /// nothing to play: the fixture keeps its look.
    fn next_entry(
        &self,
        db: &Connection,
        fixture: &str,
        playlist_id: &str,
    ) -> Result<Option<Look>, String> {
        let playlists = db::playlists(db)?;
        let mut runs = self.runs.lock().map_err(|e| e.to_string())?;
        let Some(list) = playlists.iter().find(|p| p.id == playlist_id) else {
            runs.remove(fixture);
            return Ok(None);
        };
        let rng = &mut rand::rng();
        let own = runs.remove(fixture).filter(|r| r.playlist == playlist_id);
        // Lights on the same playlist stay in step: one joining it, or one
        // whose turn ends after another's already moved on, takes that run.
        let leader = runs
            .values()
            .filter(|r| r.playlist == playlist_id)
            .filter(|r| own.as_ref().is_none_or(|o| r.started > o.started))
            .max_by_key(|r| r.started)
            .cloned();
        let run = match (leader, own) {
            (Some(run), _) => Some(run),
            (None, Some(mut run)) => run.advance(list, rng).then_some(run),
            (None, None) => Run::start(list, rng),
        };
        let Some(mut run) = run else {
            return Ok(None);
        };
        for _ in 0..list.entries.len() {
            if let Some(look) = run
                .current()
                .map(|e| Self::entry_look(db, e))
                .transpose()?
                .flatten()
            {
                runs.insert(fixture.to_string(), run);
                return Ok(Some(look));
            }
            run.advance(list, rng);
        }
        Ok(None)
    }

    /// Starts a fixture's playlist from the beginning, if it has one and is on.
    fn restart(&self, db: &Connection, id: &str, state: &mut FixtureState) -> Result<(), String> {
        self.runs.lock().map_err(|e| e.to_string())?.remove(id);
        if state.power
            && let Some(p) = state.playlist_id.clone()
            && let Some(look) = self.next_entry(db, id, &p)?
        {
            state.look = look;
        }
        Ok(())
    }

    /// What a fixture's playlist is playing, for the UI.
    pub fn playing(&self, fixture: &str) -> Option<Value> {
        self.runs.lock().ok()?.get(fixture).map(Run::info)
    }

    /// One scheduler round (twice a second): moves on the playlists whose
    /// entry is over or was removed, and starts ones without a run. Every
    /// tenth round also starts and ends seasons.
    fn tick(&self, round: u64) -> Result<(), String> {
        if round.is_multiple_of(10) {
            self.run_schedules(playlist::today())?;
        }
        let due: Vec<String> = {
            let db = self.db()?;
            let fixtures = db::fixtures(&db)?;
            let playlists: Vec<Playlist> = db::playlists(&db)?;
            let mut runs = self.runs.lock().map_err(|e| e.to_string())?;
            runs.retain(|id, run| {
                fixtures.iter().any(|(f, s)| {
                    f.id == *id && s.playlist_id.as_deref() == Some(run.playlist.as_str())
                })
            });
            fixtures
                .iter()
                .filter(|(_, s)| s.power && s.playlist_id.is_some())
                .filter(|(f, _)| {
                    let Some(run) = runs.get(&f.id) else {
                        return true;
                    };
                    playlists
                        .iter()
                        .find(|p| p.id == run.playlist)
                        .is_none_or(|p| run.current_removed(p))
                        || run.started.elapsed().as_secs_f64() >= run.duration_s()
                })
                .map(|(f, _)| f.id.clone())
                .collect()
        };
        for id in due {
            self.advance_playlist(&id)?;
        }
        Ok(())
    }

    /// Shows a fixture's next playlist entry with the playlist's transitions
    /// (or the fixture's change transitions).
    fn advance_playlist(&self, id: &str) -> Result<(), String> {
        let (fixture, state, transitions) = {
            let db = self.db()?;
            let Some((fixture, mut state)) = db::fixture(&db, id)? else {
                return Ok(());
            };
            let Some(playlist) = state.playlist_id.clone().filter(|_| state.power) else {
                return Ok(());
            };
            let Some(look) = self.next_entry(&db, id, &playlist)? else {
                return Ok(());
            };
            if look == state.look {
                return Ok(());
            }
            state.look = look;
            state.preset_id = None;
            db::save_state(&db, id, &state)?;
            let transitions = db::playlists(&db)?
                .into_iter()
                .find(|p| p.id == playlist)
                .map(|p| p.transitions)
                .unwrap_or_default();
            (fixture, state, transitions)
        };
        self.show(&fixture, state, Transition::Change(transitions));
        Ok(())
    }

    fn show(&self, fixture: &Fixture, state: FixtureState, transition: Transition) {
        let id = fixture.id.clone();
        self.engine.send(
            &fixture.device_id,
            Command::Apply {
                fixture: fixture.id.clone(),
                state,
                transition,
                brightness_ms: None,
                draft: None,
            },
        );
        let _ = self.events.send(Event::State(id));
    }

    /// Ends the seasonal schedules that are over on `today` (restoring what
    /// the fixture showed before), then starts the ones whose window began
    /// and that haven't put this occurrence on yet. Power is never changed.
    pub fn run_schedules(&self, today: NaiveDate) -> Result<(), String> {
        let mut shown: Vec<(Fixture, FixtureState)> = vec![];
        {
            let db = self.db()?;
            let playlists = db::playlists(&db)?;
            // Ends first, so a window starting on the day another ends nests
            // on top of what that one restored.
            for (f, mut state) in db::fixtures(&db)? {
                let mut ended = false;
                while let Some(mark) = state.scheduled.take() {
                    let covers = playlists
                        .iter()
                        .find(|p| p.id == mark.playlist_id)
                        .is_some_and(|p| f.seasonal && playlist::schedule_covers(p, &f.id, today))
                        && mark.until.parse::<NaiveDate>().is_ok_and(|u| today <= u);
                    if covers {
                        state.scheduled = Some(mark);
                        break;
                    }
                    let resume = mark.resume;
                    state.look = resume.look;
                    state.preset_id = resume.preset_id;
                    state.playlist_id = resume
                        .playlist_id
                        .filter(|id| playlists.iter().any(|p| p.id == *id));
                    state.scheduled = resume.scheduled;
                    ended = true;
                }
                if ended {
                    self.restart(&db, &f.id, &mut state)?;
                    db::save_state(&db, &f.id, &state)?;
                    shown.push((f, state));
                }
            }
            for (p, start, end) in playlist::starting(&playlists, today) {
                let start = start.to_string();
                for (f, mut state) in db::fixtures(&db)? {
                    if !playlist::schedule_covers(p, &f.id, today)
                        || db::schedule_fired(&db, &p.id, &f.id)?.as_deref() == Some(&start)
                    {
                        continue;
                    }
                    db::set_schedule_fired(&db, &p.id, &f.id, &start)?;
                    // An opted-out light lets the start pass, so opting back
                    // in waits for the next one.
                    if !f.seasonal {
                        continue;
                    }
                    let resume = Selection {
                        look: state.look.clone(),
                        preset_id: state.preset_id.take(),
                        playlist_id: state.playlist_id.take(),
                        scheduled: state.scheduled.take(),
                    };
                    state.playlist_id = Some(p.id.clone());
                    state.scheduled = Some(Box::new(Scheduled {
                        playlist_id: p.id.clone(),
                        until: end.to_string(),
                        resume,
                    }));
                    self.restart(&db, &f.id, &mut state)?;
                    db::save_state(&db, &f.id, &state)?;
                    shown.retain(|(x, _)| x.id != f.id);
                    shown.push((f, state));
                }
            }
        }
        for (f, state) in shown {
            self.show(&f, state, Transition::Auto);
        }
        Ok(())
    }

    /// A new light joins seasonal schedules from their next start, rather
    /// than being switched over in the middle of one.
    pub fn skip_running_schedules(db: &Connection, fixture: &str) -> Result<(), String> {
        let today = playlist::today();
        let playlists = db::playlists(db)?;
        for (p, start, _) in playlist::starting(&playlists, today) {
            if playlist::schedule_covers(p, fixture, today) {
                db::set_schedule_fired(db, &p.id, fixture, &start.to_string())?;
            }
        }
        Ok(())
    }

    /// After a playlist was deleted: scheduled fixtures go back to what they
    /// showed before, others playing it keep their look.
    pub fn playlist_deleted(&self, id: &str) -> Result<(), String> {
        self.run_schedules(playlist::today())?;
        let db = self.db()?;
        for (f, mut state) in db::fixtures(&db)? {
            if state.playlist_id.as_deref() == Some(id) {
                state.playlist_id = None;
                state.scheduled = None;
                db::save_state(&db, &f.id, &state)?;
                let _ = self.events.send(Event::State(f.id));
            }
        }
        Ok(())
    }

    /// Applies a change to a fixture, stores it and shows it.
    pub fn set_state(&self, id: &str, patch: StatePatch) -> Result<FixtureState, String> {
        let (fixture, state) = {
            let db = self.db()?;
            let (fixture, mut state) =
                db::fixture(&db, id)?.ok_or_else(|| format!("no fixture {id}"))?;
            let was_on = state.power;
            // Picking anything ends a scheduled playlist without going back.
            if patch.preset.is_some()
                || patch.playlist.is_some()
                || patch.look.is_some()
                || patch.script_id.is_some()
            {
                state.scheduled = None;
            }
            let mut picked_playlist = match &patch.playlist {
                Some(key) => Some(
                    Self::find_playlist(&db, key)?
                        .ok_or_else(|| format!("no playlist called {key}"))?,
                ),
                None => None,
            };
            if let Some(key) = &patch.preset {
                match Self::find_preset(&db, key)? {
                    Some(preset) => {
                        state.look = preset.look;
                        state.preset_id = Some(preset.id);
                        state.playlist_id = None;
                    }
                    None => {
                        picked_playlist = Some(
                            Self::find_playlist(&db, key)?
                                .ok_or_else(|| format!("no preset called {key}"))?,
                        )
                    }
                }
            }
            if let Some(look) = patch.look.clone() {
                if db::script_source(&db, &look.script_id, None)?.is_none() {
                    return Err(format!("no effect {}", look.script_id));
                }
                state.look = look;
                state.preset_id = None;
                state.playlist_id = None;
            }
            if let Some(script) = &patch.script_id {
                if *script != state.look.script_id {
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
                // Picking the effect a playlist shows keeps it, without the playlist.
                state.playlist_id = None;
            }
            if patch.replace_params {
                state.look.params = Value::Object(Default::default());
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
            // Custom colours make the look no longer the preset's, unless the
            // same change also picked the preset (a homectl scene sends both).
            if (patch.colors.is_some() || patch.color.is_some()) && patch.preset.is_none() {
                state.preset_id = None;
            }
            // A playlist picks its own colours.
            if picked_playlist.is_none() {
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
            }
            if let Some(p) = patch.power {
                state.power = p;
            }
            if let Some(b) = patch.brightness {
                state.brightness = b.clamp(0.0, 1.0);
            }
            // Picking the playlist that's already playing (homectl resending
            // its scene, say) carries on rather than starting over.
            if picked_playlist.is_some()
                && picked_playlist == state.playlist_id
                && was_on
                && patch.power != Some(false)
                && self
                    .runs
                    .lock()
                    .map_err(|e| e.to_string())?
                    .contains_key(id)
            {
                picked_playlist = None;
            }
            if let Some(p) = &picked_playlist {
                state.playlist_id = Some(p.clone());
                state.preset_id = None;
                self.runs.lock().map_err(|e| e.to_string())?.remove(id);
            }
            // A playlist starts when picked, and resumes with its next entry
            // when the light comes back on.
            if let Some(playlist) = state.playlist_id.clone()
                && state.power
                && (picked_playlist.is_some() || !was_on)
                && let Some(look) = self.next_entry(&db, id, &playlist)?
            {
                state.look = look;
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(script: &str) -> PlaylistEntry {
        PlaylistEntry {
            script_id: script.into(),
            preset_id: None,
            params: json!({}),
            colors: vec![],
            duration_s: 60.0,
            enabled: true,
        }
    }

    /// An app with one light (its string disabled, so nothing is contacted)
    /// and the built-in playlists plus "Calm".
    fn app() -> (tempfile::TempDir, Arc<App>) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.sqlite3");
        let db = db::open(&path).unwrap();
        db::sync_builtins(&db).unwrap();
        db::seed_playlists(&db).unwrap();
        let device = new_device("Curtain", "192.0.2.20", false, DeviceKind::Twinkly);
        db::save_device(&db, &device).unwrap();
        db::save_fixture(
            &db,
            &new_fixture("Curtain", &device, 0, 10, 1),
            &FixtureState::default(),
        )
        .unwrap();
        db::save_playlist(
            &db,
            &Playlist {
                id: "calm".into(),
                name: "Calm".into(),
                entries: vec![entry("aurora"), entry("plasma")],
                shuffle: false,
                transitions: Default::default(),
                season: None,
                auto_enabled: false,
                lights: None,
                builtin: false,
                removed: vec![],
                sort: 0,
            },
        )
        .unwrap();
        let app = App::new(db, rusqlite::Connection::open(&path).unwrap(), None);
        (dir, app)
    }

    fn set(app: &App, patch: Value) -> Result<FixtureState, String> {
        app.set_state("Curtain", serde_json::from_value(patch).unwrap())
    }

    fn state(app: &App) -> FixtureState {
        app.fixture("Curtain").unwrap().1
    }

    fn day(app: &App, m: u32, d: u32) -> FixtureState {
        let y = if m == 1 { 2027 } else { 2026 };
        app.run_schedules(NaiveDate::from_ymd_opt(y, m, d).unwrap())
            .unwrap();
        state(app)
    }

    #[test]
    fn lights_follow_the_transitions_for_all_lights() {
        let (_dir, app) = app();
        let two = crate::model::TransitionChoice(vec![
            TransitionSpec::new("iris", 400, Value::Null),
            TransitionSpec::new("push", 400, Value::Null),
        ]);
        let mut settings = app.settings().unwrap();
        assert_eq!(settings.transitions, Default::default());
        settings.transitions.change = two.clone();
        app.save_settings(&settings).unwrap();
        // The engine resolves each light's lists from these when it uses them.
        assert_eq!(app.engine.transitions().change, two);
        let (mut f, state) = app.fixture("Curtain").unwrap();
        let all = app.engine.transitions();
        assert_eq!(f.transitions.effective(Slot::Change, &all), &two);
        // A light with its own list keeps it, until told to follow again.
        f.transitions.change = Some(crate::model::TransitionChoice::default());
        db::save_fixture(&app.db().unwrap(), &f, &state).unwrap();
        let f = app.fixture("Curtain").unwrap().0;
        assert!(f.transitions.effective(Slot::Change, &all).is_empty());
        assert_eq!(app.follow_all(Slot::Change).unwrap(), vec!["Curtain"]);
        assert_eq!(app.follow_all(Slot::Change).unwrap(), Vec::<String>::new());
        let f = app.fixture("Curtain").unwrap().0;
        assert_eq!(f.transitions.effective(Slot::Change, &all), &two);
    }

    #[test]
    fn playlists_are_picked_like_presets() {
        let (_dir, app) = app();
        // homectl names playlists like presets.
        let s = set(&app, json!({"preset": "Playlist: Calm", "power": true})).unwrap();
        assert_eq!(s.playlist_id.as_deref(), Some("calm"));
        assert_eq!(s.look.script_id, "aurora");
        assert_eq!(app.playing("Curtain").unwrap()["entry"], 0);
        // Brightness keeps the entry; coming back on moves to the next one.
        let s = set(&app, json!({"brightness": 0.5})).unwrap();
        assert_eq!(s.look.script_id, "aurora");
        set(&app, json!({"power": false})).unwrap();
        let s = set(&app, json!({"power": true})).unwrap();
        assert_eq!(
            (s.look.script_id.as_str(), s.playlist_id.as_deref()),
            ("plasma", Some("calm"))
        );
        // Picking an effect ends the playlist.
        let s = set(&app, json!({"scriptId": "rainbow"})).unwrap();
        assert_eq!(s.playlist_id, None);
        let s = set(&app, json!({"playlist": "Everyday"})).unwrap();
        assert_eq!(s.playlist_id.as_deref(), Some("everyday"));
        assert!(set(&app, json!({"preset": "Nothing like it"})).is_err());
        app.playlist_deleted("everyday").unwrap();
        assert_ne!(state(&app).playlist_id.as_deref(), Some("everyday"));
    }

    #[test]
    fn built_in_looks_replace_params_and_keep_the_playlist() {
        let (_dir, app) = app();
        set(&app, json!({"playlist": "calm", "power": true})).unwrap();
        // A tweak merges; picking a look replaces every param.
        set(&app, json!({"params": {"speed": 1.5, "height": 0.9}})).unwrap();
        let s = set(
            &app,
            json!({"params": {"speed": 0.4}, "replaceParams": true, "colors": ["#ff0000", "#00ff00"]}),
        )
        .unwrap();
        assert_eq!(s.look.params, json!({"speed": 0.4}));
        assert_eq!(s.look.colors, vec!["#ff0000", "#00ff00"]);
        assert_eq!(s.playlist_id.as_deref(), Some("calm"));
        // Without params it goes back to the defaults.
        let s = set(&app, json!({"replaceParams": true})).unwrap();
        assert_eq!(s.look.params, json!({}));
    }

    #[test]
    fn schedules_nest_and_restore() {
        let (_dir, app) = app();
        set(&app, json!({"scriptId": "rainbow"})).unwrap();
        assert_eq!(day(&app, 11, 30).playlist_id.as_deref(), Some("autumn"));
        let s = day(&app, 12, 1);
        assert_eq!(s.playlist_id.as_deref(), Some("christmas"));
        assert!(!s.power, "power never changes");
        assert_eq!(s.scheduled.as_ref().unwrap().until, "2026-12-27");
        assert_eq!(
            s.scheduled.as_ref().unwrap().resume.look.script_id,
            "rainbow",
            "autumn ended first"
        );
        // Independence Day nests inside Christmas, then gives it back.
        let s = day(&app, 12, 5);
        assert_eq!(s.playlist_id.as_deref(), Some("independence-day"));
        let s = day(&app, 12, 7);
        assert_eq!(s.playlist_id.as_deref(), Some("christmas"));
        assert!(s.scheduled.is_some(), "still scheduled");
        // Christmas ends, the original look comes back, and New Year starts on top.
        let s = day(&app, 12, 28);
        assert_eq!(s.playlist_id.as_deref(), Some("new-year"));
        assert_eq!(
            s.scheduled.as_ref().unwrap().resume.look.script_id,
            "rainbow"
        );
        let s = day(&app, 1, 3);
        assert_eq!(s.playlist_id.as_deref(), Some("winter"));
        assert_eq!(s.scheduled.unwrap().resume.look.script_id, "rainbow");
        // Firing is remembered: the same occurrence doesn't start again.
        let s = day(&app, 1, 1);
        assert_eq!(
            (s.playlist_id, s.look.script_id.as_str()),
            (None, "rainbow")
        );
    }

    #[test]
    fn picking_something_else_ends_a_schedule() {
        let (_dir, app) = app();
        set(&app, json!({"scriptId": "rainbow", "power": true})).unwrap();
        let s = day(&app, 12, 1);
        assert_eq!(s.playlist_id.as_deref(), Some("christmas"));
        assert!(
            s.look.script_id.starts_with("xmas-"),
            "on lights show an entry"
        );
        set(&app, json!({"scriptId": "plasma"})).unwrap();
        assert_eq!(
            day(&app, 12, 2).look.script_id,
            "plasma",
            "no re-activation"
        );
        // A nested window still starts, and returns to the user's pick.
        assert_eq!(
            day(&app, 12, 5).playlist_id.as_deref(),
            Some("independence-day")
        );
        let s = day(&app, 12, 7);
        assert_eq!((s.playlist_id, s.look.script_id.as_str()), (None, "plasma"));
        // Overriding the nested one ends both: nothing is restored later.
        let (_dir, app) = self::app();
        set(&app, json!({"scriptId": "rainbow"})).unwrap();
        day(&app, 12, 1);
        day(&app, 12, 5);
        set(&app, json!({"playlist": "calm"})).unwrap();
        assert_eq!(day(&app, 12, 7).playlist_id.as_deref(), Some("calm"));
        assert_eq!(
            day(&app, 12, 28)
                .scheduled
                .unwrap()
                .resume
                .playlist_id
                .as_deref(),
            Some("calm")
        );
    }

    #[test]
    fn turning_a_schedule_off_ends_it() {
        let (_dir, app) = app();
        set(&app, json!({"scriptId": "rainbow"})).unwrap();
        assert_eq!(day(&app, 12, 1).playlist_id.as_deref(), Some("christmas"));
        let db = app.db().unwrap();
        let mut christmas = db::playlists(&db)
            .unwrap()
            .into_iter()
            .find(|p| p.id == "christmas")
            .unwrap();
        christmas.auto_enabled = false;
        db::save_playlist(&db, &christmas).unwrap();
        drop(db);
        assert_eq!(day(&app, 12, 2).look.script_id, "rainbow");
        // A light outside the schedule's lights is left alone.
        let db = app.db().unwrap();
        christmas.auto_enabled = true;
        christmas.lights = Some(vec!["Tree".into()]);
        db::save_playlist(&db, &christmas).unwrap();
        db.execute("DELETE FROM schedule_fired", []).unwrap();
        drop(db);
        assert_eq!(day(&app, 12, 3).playlist_id, None);
    }

    #[test]
    fn schedules_added_mid_season_wait_for_their_next_start() {
        let (_dir, app) = app();
        set(&app, json!({"scriptId": "rainbow"})).unwrap();
        let db = app.db().unwrap();
        for p in db::playlists(&db).unwrap() {
            db::skip_running_occurrence(&db, &p, NaiveDate::from_ymd_opt(2026, 10, 31).unwrap())
                .unwrap();
        }
        drop(db);
        // Autumn and Halloween were already running: nothing changes.
        let s = day(&app, 10, 31);
        assert_eq!(
            (s.playlist_id, s.look.script_id.as_str()),
            (None, "rainbow")
        );
        // Christmas starts as usual.
        assert_eq!(day(&app, 12, 1).playlist_id.as_deref(), Some("christmas"));
    }

    #[test]
    fn lights_on_the_same_playlist_stay_in_step() {
        let (_dir, app) = app();
        {
            let db = app.db().unwrap();
            let device = db::device(&db, "curtain").unwrap().unwrap();
            db::save_fixture(
                &db,
                &new_fixture("Tree", &device, 10, 0, 2),
                &FixtureState::default(),
            )
            .unwrap();
        }
        set(&app, json!({"playlist": "calm", "power": true})).unwrap();
        app.advance_playlist("Curtain").unwrap();
        assert_eq!(state(&app).look.script_id, "plasma");
        // Joining mid-way shows what the other light shows.
        let tree = app
            .set_state(
                "Tree",
                serde_json::from_value(json!({"playlist": "calm", "power": true})).unwrap(),
            )
            .unwrap();
        assert_eq!(tree.look.script_id, "plasma");
        // Whichever moves on first, the other follows to the same entry.
        app.advance_playlist("Tree").unwrap();
        app.advance_playlist("Curtain").unwrap();
        let tree = app.fixture("Tree").unwrap().1;
        assert_eq!(tree.look.script_id, "aurora");
        assert_eq!(state(&app).look.script_id, "aurora");
    }

    #[test]
    fn lights_can_opt_out_of_seasons() {
        let (_dir, app) = app();
        set(&app, json!({"scriptId": "rainbow"})).unwrap();
        let opt_out = |seasonal: bool| {
            let db = app.db().unwrap();
            let (mut f, s) = db::fixture(&db, "Curtain").unwrap().unwrap();
            f.seasonal = seasonal;
            db::save_fixture(&db, &f, &s).unwrap();
        };
        opt_out(false);
        assert_eq!(day(&app, 12, 1).playlist_id, None);
        // Opting back in waits for the next start; opting out mid-season
        // goes back to what the light showed before.
        opt_out(true);
        assert_eq!(
            day(&app, 12, 1).playlist_id,
            None,
            "this start already passed"
        );
        assert_eq!(day(&app, 12, 28).playlist_id.as_deref(), Some("new-year"));
        opt_out(false);
        assert_eq!(day(&app, 12, 29).look.script_id, "rainbow");
    }
}
