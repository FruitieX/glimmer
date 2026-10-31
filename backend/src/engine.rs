//! The render engine: one thread per enabled device renders its fixtures'
//! looks and transitions in JavaScript and streams the frames over UDP. A
//! second thread per device does the slow HTTP work (authentication, modes,
//! movie uploads) so it never delays a frame.

use crate::{
    color,
    device::{self, Client},
    layout,
    model::{
        Device, Fixture, FixtureState, Look, ScriptKind, ScriptSource, Slot, TransitionChoice,
        TransitionSpec, Transitions,
    },
    script::{Rgb, Scripts},
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Condvar, Mutex, RwLock,
        mpsc::{self, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant},
};
use tokio::sync::broadcast;

pub type ScriptLookup = Arc<dyn Fn(&str) -> Option<ScriptSource> + Send + Sync>;

/// The transitions for all lights, read each time a light that follows them
/// changes, so edits apply right away.
pub type SharedTransitions = Arc<RwLock<Transitions>>;

/// How a state change is shown.
#[derive(Clone, Debug)]
pub enum Transition {
    /// One of the fixture's on/off/change transitions (its own list, or the
    /// one for all lights).
    Auto,
    /// Like `Auto`, but a change of look uses one of these (a playlist's own
    /// transitions) when there are any.
    Change(TransitionChoice),
    Instant,
    Spec(TransitionSpec),
}

pub enum Command {
    Configure(Device, Vec<Fixture>),
    Apply {
        fixture: String,
        state: FixtureState,
        transition: Transition,
        /// Brightness changes ramp over this long.
        brightness_ms: Option<u32>,
        /// An unsaved script to show instead of the look's saved one.
        draft: Option<ScriptSource>,
    },
    /// Lights `count` LEDs from `start` (device order) and dims the rest.
    Identify(Option<(usize, usize)>),
    /// A saved script changed; looks using it switch to the new version.
    ScriptChanged(String),
    ClearMovies,
    Stop,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
    pub online: bool,
    pub mode: Option<String>,
    /// `idle`, `live` or `movie`.
    pub output: String,
    pub fps: f32,
    pub late_frames: u64,
    pub error: Option<String>,
    pub movie: Option<String>,
    pub fixture_errors: HashMap<String, String>,
    pub gestalt: Option<device::Gestalt>,
}

/// A fixture's current colours (brightness applied, before gamma), for the UI.
#[derive(Clone, Debug)]
pub struct Frame {
    pub fixture: String,
    pub rgb: Vec<u8>,
}

struct Handle {
    tx: mpsc::Sender<Command>,
    thread: Option<thread::JoinHandle<()>>,
}

pub struct Engine {
    workers: Mutex<HashMap<String, Handle>>,
    pub status: Arc<RwLock<HashMap<String, DeviceStatus>>>,
    frames: broadcast::Sender<Arc<Frame>>,
    lookup: ScriptLookup,
    transitions: SharedTransitions,
}

impl Engine {
    pub fn new(lookup: ScriptLookup, transitions: Transitions) -> Self {
        Self {
            workers: Mutex::new(HashMap::new()),
            status: Arc::new(RwLock::new(HashMap::new())),
            frames: broadcast::channel(256).0,
            lookup,
            transitions: Arc::new(RwLock::new(transitions)),
        }
    }

    /// Replaces the transitions for all lights.
    pub fn set_transitions(&self, transitions: Transitions) {
        *self.transitions.write().unwrap() = transitions;
    }

    #[cfg(test)]
    pub fn transitions(&self) -> Transitions {
        self.transitions.read().unwrap().clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Frame>> {
        self.frames.subscribe()
    }

    /// Starts, reconfigures or (when disabled) stops a device's worker.
    pub fn configure(&self, device: Device, fixtures: Vec<Fixture>) {
        let mut workers = self.workers.lock().unwrap();
        if !device.enabled {
            if let Some(mut h) = workers.remove(&device.id) {
                let _ = h.tx.send(Command::Stop);
                if let Some(t) = h.thread.take() {
                    let _ = t.join();
                }
            }
            self.status.write().unwrap().remove(&device.id);
            return;
        }
        if let Some(h) = workers.get(&device.id)
            && h.tx
                .send(Command::Configure(device.clone(), fixtures.clone()))
                .is_ok()
        {
            return;
        }
        let (tx, rx) = mpsc::channel();
        let id = device.id.clone();
        let status = self.status.clone();
        let frames = self.frames.clone();
        let lookup = self.lookup.clone();
        let transitions = self.transitions.clone();
        let thread = thread::Builder::new()
            .name(format!("render-{id}"))
            .spawn(move || run_worker(device, fixtures, rx, status, frames, lookup, transitions))
            .expect("spawning a render thread");
        workers.insert(
            id,
            Handle {
                tx,
                thread: Some(thread),
            },
        );
    }

    pub fn remove(&self, device_id: &str) {
        if let Some(mut h) = self.workers.lock().unwrap().remove(device_id) {
            let _ = h.tx.send(Command::Stop);
            if let Some(t) = h.thread.take() {
                let _ = t.join();
            }
        }
        self.status.write().unwrap().remove(device_id);
    }

    pub fn send(&self, device_id: &str, command: Command) {
        if let Some(h) = self.workers.lock().unwrap().get(device_id) {
            let _ = h.tx.send(command);
        }
    }

    pub fn broadcast_script_change(&self, script_id: &str) {
        for h in self.workers.lock().unwrap().values() {
            let _ = h.tx.send(Command::ScriptChanged(script_id.into()));
        }
    }

    pub fn shutdown(&self) {
        let ids: Vec<String> = self.workers.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.remove(&id);
        }
    }
}

// ---------------------------------------------------------------------------
// Control thread: HTTP side of a device.

#[derive(Clone, Debug, PartialEq)]
enum Desired {
    /// Leave the device alone (nothing has asked for anything yet).
    Untouched,
    Off,
    Live,
    Movie {
        id: u32,
        brightness: u8,
    },
}

struct Upload {
    unique_id: String,
    name: String,
    frames: usize,
    fps: u32,
    data: Vec<u8>,
}

#[derive(Default)]
struct ControlState {
    desired: Option<Desired>,
    /// Bumped whenever the worker asks again, so the device's actual mode is rechecked.
    generation: u64,
    device: Option<Device>,
    upload: Option<Upload>,
    clear_movies: bool,
    stop: bool,
}

struct Control {
    state: Mutex<ControlState>,
    wake: Condvar,
    token: Mutex<Option<[u8; 8]>>,
    /// Result of the last upload: the movie id, or why it failed.
    uploaded: Mutex<Option<(String, Result<u32, String>)>>,
    /// Set when starting a movie failed, so the worker streams again.
    movie_failed: Mutex<Option<String>>,
}

impl Control {
    fn update(&self, f: impl FnOnce(&mut ControlState)) {
        let mut state = self.state.lock().unwrap();
        f(&mut state);
        state.generation += 1;
        self.wake.notify_all();
    }
}

fn movie_id_from_hash(data: &[u8]) -> String {
    let h = Sha256::digest(data);
    let hex: String = h.iter().take(16).map(|b| format!("{b:02X}")).collect();
    // Marks the movie as ours: "7717" ("TT") in the third group.
    format!(
        "{}-{}-7717-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[16..20],
        &hex[20..32]
    )
}

fn run_control(
    mut device: Device,
    control: Arc<Control>,
    status: Arc<RwLock<HashMap<String, DeviceStatus>>>,
) {
    let mut client = Client::new(&device.ip);
    let mut seen_generation = 0;
    let mut applied = Desired::Untouched;
    let mut last_mode_check = Instant::now() - Duration::from_secs(60);
    let mut last_gestalt = Instant::now() - Duration::from_secs(600);
    let mut hw_brightness_changed = false;
    let id = device.id.clone();
    let set_status = |f: &dyn Fn(&mut DeviceStatus)| {
        if let Some(s) = status.write().unwrap().get_mut(&id) {
            f(s);
        }
    };
    loop {
        let (desired, upload, clear) = {
            let guard = control.state.lock().unwrap();
            let (mut guard, _) = control
                .wake
                .wait_timeout_while(guard, Duration::from_secs(2), |s| {
                    !s.stop && s.generation == seen_generation
                })
                .unwrap();
            if guard.stop {
                return;
            }
            if guard.generation != seen_generation {
                seen_generation = guard.generation;
                if matches!(applied, Desired::Off | Desired::Live) {
                    applied = Desired::Untouched;
                }
            }
            if let Some(d) = guard.device.take() {
                if d.ip != device.ip {
                    client = Client::new(&d.ip);
                    applied = Desired::Untouched;
                }
                device = d;
            }
            let clear = std::mem::take(&mut guard.clear_movies);
            (
                guard.desired.clone().unwrap_or(Desired::Untouched),
                guard.upload.take(),
                clear,
            )
        };

        if last_gestalt.elapsed() > Duration::from_secs(60) {
            last_gestalt = Instant::now();
            match client.gestalt() {
                Ok(g) => set_status(&|s| {
                    s.online = true;
                    s.gestalt = Some(g.clone());
                }),
                Err(e) => set_status(&|s| {
                    s.online = false;
                    s.error = Some(format!("unreachable: {e}"));
                }),
            }
        }

        let result: Result<(), String> = (|| {
            if clear {
                if client.mode()? == "movie" || client.mode()? == "playlist" {
                    client.set_mode("off")?;
                    applied = Desired::Off;
                }
                client.delete_all_movies()?;
            }
            if let Some(upload) = upload {
                let result = (|| {
                    let movies = client.movies()?;
                    if let Some(m) = movies
                        .movies
                        .iter()
                        .find(|m| m.unique_id.eq_ignore_ascii_case(&upload.unique_id))
                    {
                        return Ok(m.id);
                    }
                    let available = movies.available_frames.unwrap_or(u64::MAX);
                    let slots_full = device
                        .info
                        .as_ref()
                        .and_then(|i| i.max_movies)
                        .is_some_and(|max| movies.movies.len() as u64 >= max);
                    if available < upload.frames as u64 || slots_full {
                        if !device.allow_clearing_movies {
                            return Err("the device's movie memory is full; allow clearing it in the device settings".to_string());
                        }
                        client.delete_all_movies()?;
                    }
                    client.upload_movie(
                        &upload.name,
                        &upload.unique_id,
                        device.led_count,
                        upload.frames,
                        upload.fps,
                        device.output.bytes_per_led() == 4,
                        &upload.data,
                    )
                })();
                *control.uploaded.lock().unwrap() = Some((upload.unique_id, result));
            }
            match &desired {
                Desired::Untouched => {}
                Desired::Off => {
                    if applied != Desired::Off {
                        if client.mode()? != "off" {
                            client.set_mode("off")?;
                        }
                        set_status(&|s| s.mode = Some("off".into()));
                        applied = Desired::Off;
                    }
                }
                Desired::Live => {
                    let token = client.realtime_token()?;
                    *control.token.lock().unwrap() = Some(token);
                    if hw_brightness_changed {
                        client.set_brightness(100)?;
                        hw_brightness_changed = false;
                    }
                    if applied != Desired::Live
                        || last_mode_check.elapsed() > Duration::from_secs(5)
                    {
                        last_mode_check = Instant::now();
                        let mode = client.mode()?;
                        if mode != "rt" {
                            client.set_mode("rt")?;
                        }
                        set_status(&|s| s.mode = Some("rt".into()));
                        applied = Desired::Live;
                    }
                }
                Desired::Movie { id, brightness } => {
                    if applied != desired {
                        let same_movie =
                            matches!(&applied, Desired::Movie { id: old, .. } if old == id);
                        let started = (|| {
                            client.set_brightness(*brightness)?;
                            if !same_movie {
                                client.play_movie(*id)?;
                            }
                            Ok::<_, String>(())
                        })();
                        hw_brightness_changed = true;
                        if let Err(e) = started {
                            *control.movie_failed.lock().unwrap() = Some(e.clone());
                            return Err(e);
                        }
                        set_status(&|s| s.mode = Some("movie".into()));
                        applied = desired.clone();
                    }
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => set_status(&|s| {
                s.online = true;
                if s.error.as_deref().is_some_and(|e| !e.starts_with("script")) {
                    s.error = None;
                }
            }),
            Err(e) => {
                client.forget_token();
                *control.token.lock().unwrap() = None;
                // Retry everything on the next round.
                applied = Desired::Untouched;
                set_status(&|s| {
                    s.online = !e.contains("connect") && !e.contains("timed out");
                    s.error = Some(e.clone());
                });
                thread::sleep(Duration::from_secs(2));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Render worker.

#[derive(Clone)]
struct Layer {
    instance: String,
    look: Look,
    script: String,
    version: i64,
    started: f64,
    loop_s: Option<f64>,
}

enum Source {
    Black,
    Layer(Layer),
    Frozen(Vec<f32>),
}

struct Fade {
    instance: String,
    from: Source,
    started: f64,
    duration: f64,
}

#[derive(Clone, Copy)]
struct Ramp {
    from: f32,
    to: f32,
    started: f64,
    duration: f64,
}

impl Ramp {
    fn value(&self, now: f64) -> f32 {
        if self.duration <= 0.0 || now >= self.started + self.duration {
            return self.to;
        }
        let p = ((now - self.started) / self.duration).clamp(0.0, 1.0) as f32;
        self.from + (self.to - self.from) * p
    }
}

static NO_TRANSITIONS: TransitionChoice = TransitionChoice(Vec::new());

struct FixtureRt {
    cfg: Fixture,
    layout: String,
    /// The positions its instances were made with.
    shape: layout::FixtureLayout,
    points: usize,
    state: FixtureState,
    layer: Option<Layer>,
    fade: Option<Fade>,
    brightness: Ramp,
    out: Vec<f32>,
    a: Vec<f32>,
    b: Vec<f32>,
    /// The transition last picked for turning on, off and changing, so a
    /// slot with several doesn't repeat one straight away.
    picked: [Option<TransitionSpec>; 3],
}

impl FixtureRt {
    fn active(&self) -> bool {
        self.state.power || self.fade.is_some()
    }
    fn device_index(&self, i: usize) -> usize {
        if self.cfg.reversed {
            self.cfg.start + self.cfg.count - 1 - i
        } else {
            self.cfg.start + i
        }
    }
}

enum Output {
    Idle,
    Live,
    /// Waiting for an upload, then for the next loop boundary.
    Baking(Bake),
    Movie(MoviePlayback),
}

struct Bake {
    key: String,
    unique_id: String,
    fps: u32,
    total: usize,
    /// Frames per loop for each fixture index (only powered ones).
    loops: Vec<(usize, usize)>,
    hw: f32,
    data: Vec<u8>,
    done: usize,
    uploaded: Option<u32>,
}

struct MoviePlayback {
    key: String,
    started: f64,
    fps: u32,
    loops: Vec<(usize, usize)>,
    hw: f32,
}

struct Worker {
    device: Device,
    fixtures: Vec<FixtureRt>,
    scripts: Scripts,
    /// Registered script keys and their colour slot defaults.
    registered: HashMap<String, Vec<String>>,
    lookup: ScriptLookup,
    transitions: SharedTransitions,
    control: Arc<Control>,
    status: Arc<RwLock<HashMap<String, DeviceStatus>>>,
    frames: broadcast::Sender<Arc<Frame>>,
    clock: Instant,
    serial: u64,
    identify: Option<(usize, usize, Instant)>,
    output: Output,
    last_change: f64,
    failed_bakes: HashSet<String>,
    sender: Option<device::rt::Sender>,
    frame: Vec<f32>,
    brightness: Vec<f32>,
    bytes: Vec<u8>,
}

fn colors_of(look: &Look, meta_defaults: &[String]) -> Vec<Rgb> {
    let n = look.colors.len().max(meta_defaults.len());
    (0..n)
        .map(|i| {
            look.colors
                .get(i)
                .and_then(|c| color::parse_hex(c))
                .or_else(|| meta_defaults.get(i).and_then(|c| color::parse_hex(c)))
                .unwrap_or([1.0, 1.0, 1.0])
        })
        .collect()
}

fn run_worker(
    device: Device,
    fixtures: Vec<Fixture>,
    rx: mpsc::Receiver<Command>,
    status: Arc<RwLock<HashMap<String, DeviceStatus>>>,
    frames: broadcast::Sender<Arc<Frame>>,
    lookup: ScriptLookup,
    transitions: SharedTransitions,
) {
    status.write().unwrap().insert(
        device.id.clone(),
        DeviceStatus {
            output: "idle".into(),
            ..Default::default()
        },
    );
    let control = Arc::new(Control {
        state: Mutex::new(ControlState::default()),
        wake: Condvar::new(),
        token: Mutex::new(None),
        uploaded: Mutex::new(None),
        movie_failed: Mutex::new(None),
    });
    let control_thread = {
        let (device, control, status) = (device.clone(), control.clone(), status.clone());
        thread::Builder::new()
            .name(format!("control-{}", device.id))
            .spawn(move || run_control(device, control, status))
            .expect("spawning a control thread")
    };
    let scripts = match Scripts::new() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("{}: cannot start the script runtime: {e}", device.id);
            return;
        }
    };
    let mut worker = Worker {
        sender: device::rt::Sender::new(&device.ip).ok(),
        device,
        fixtures: vec![],
        scripts,
        registered: HashMap::new(),
        lookup,
        transitions,
        control: control.clone(),
        status,
        frames,
        clock: Instant::now(),
        serial: 0,
        identify: None,
        output: Output::Idle,
        last_change: 0.0,
        failed_bakes: HashSet::new(),
        frame: vec![],
        brightness: vec![],
        bytes: vec![],
    };
    worker.configure(worker.device.clone(), fixtures);
    worker.run(rx);
    control.update(|s| s.stop = true);
    let _ = control_thread.join();
}

impl Worker {
    fn now(&self) -> f64 {
        self.clock.elapsed().as_secs_f64()
    }

    fn next_id(&mut self, prefix: &str) -> String {
        self.serial += 1;
        format!("{prefix}{}", self.serial)
    }

    fn set_status(&self, f: impl FnOnce(&mut DeviceStatus)) {
        if let Some(s) = self.status.write().unwrap().get_mut(&self.device.id) {
            f(s);
        }
    }

    fn fixture_error(&self, fixture: &str, error: Option<String>) {
        let fixture = fixture.to_string();
        self.set_status(move |s| match error {
            Some(e) => {
                s.fixture_errors.insert(fixture, e);
            }
            None => {
                s.fixture_errors.remove(&fixture);
            }
        });
    }

    fn ensure_registered(&mut self, source: &ScriptSource) -> Result<(), String> {
        let key = source.key();
        if self.registered.contains_key(&key) {
            return Ok(());
        }
        let meta = self.scripts.register(&key, &source.source)?;
        self.registered
            .insert(key, meta.colors.into_iter().map(|c| c.default).collect());
        Ok(())
    }

    fn color_defaults(&self, key: &str) -> Vec<String> {
        self.registered.get(key).cloned().unwrap_or_default()
    }

    fn configure(&mut self, device: Device, fixtures: Vec<Fixture>) {
        if device.ip != self.device.ip {
            self.sender = device::rt::Sender::new(&device.ip).ok();
        }
        self.control.update(|s| s.device = Some(device.clone()));
        self.device = device;
        let n = self.device.led_count;
        self.frame = vec![0.0; n * 3];
        self.brightness = vec![0.0; n];
        let mut old: HashMap<String, FixtureRt> = self
            .fixtures
            .drain(..)
            .map(|f| (f.cfg.id.clone(), f))
            .collect();
        for cfg in fixtures {
            let cfg = Fixture {
                count: cfg.count.min(n.saturating_sub(cfg.start)),
                ..cfg
            };
            let l = layout::fixture_layout(&self.device, &cfg);
            let layout_id = format!("{}:{}:{}", cfg.id, cfg.start, cfg.count);
            if let Err(e) = self.scripts.fixture_layout(&layout_id, &l) {
                tracing::error!("layout for {}: {e}", cfg.id);
                continue;
            }
            let len = cfg.count * 3;
            match old.remove(&cfg.id) {
                Some(mut f) if f.layout == layout_id && f.points == cfg.count && f.shape == l => {
                    f.cfg = cfg;
                    self.fixtures.push(f);
                }
                Some(f) => {
                    // The LEDs changed: rebuild the instances on the new layout.
                    let mut fresh = FixtureRt {
                        cfg,
                        layout: layout_id,
                        shape: l,
                        points: len / 3,
                        state: f.state.clone(),
                        layer: None,
                        fade: None,
                        brightness: f.brightness,
                        out: vec![0.0; len],
                        a: vec![0.0; len],
                        b: vec![0.0; len],
                        picked: f.picked.clone(),
                    };
                    self.drop_fixture_instances(f);
                    let state = fresh.state.clone();
                    fresh.state.power = false;
                    self.fixtures.push(fresh);
                    let idx = self.fixtures.len() - 1;
                    self.apply(idx, state, Transition::Instant, None, None);
                }
                None => self.fixtures.push(FixtureRt {
                    cfg,
                    layout: layout_id,
                    shape: l,
                    points: len / 3,
                    state: FixtureState::default(),
                    layer: None,
                    fade: None,
                    brightness: Ramp {
                        from: 1.0,
                        to: 1.0,
                        started: 0.0,
                        duration: 0.0,
                    },
                    out: vec![0.0; len],
                    a: vec![0.0; len],
                    b: vec![0.0; len],
                    picked: Default::default(),
                }),
            }
        }
        for (_, f) in old {
            self.drop_fixture_instances(f);
        }
        self.leave_movie();
    }

    fn drop_fixture_instances(&mut self, f: FixtureRt) {
        if let Some(l) = f.layer {
            self.scripts.drop_instance(&l.instance);
        }
        if let Some(fade) = f.fade {
            self.scripts.drop_instance(&fade.instance);
            if let Source::Layer(l) = fade.from {
                self.scripts.drop_instance(&l.instance);
            }
        }
    }

    fn make_layer(
        &mut self,
        idx: usize,
        look: &Look,
        draft: Option<ScriptSource>,
    ) -> Result<Layer, String> {
        let source = match draft {
            Some(d) => d,
            None => (self.lookup)(&look.script_id)
                .ok_or_else(|| format!("script {} does not exist", look.script_id))?,
        };
        if source.kind != ScriptKind::Effect {
            return Err(format!("{} is not an effect", source.id));
        }
        self.ensure_registered(&source)?;
        let meta = self.color_defaults(&source.key());
        let colors = colors_of(look, &meta);
        let instance = self.next_id("e");
        let layout = self.fixtures[idx].layout.clone();
        self.scripts
            .create(&instance, &source.key(), &layout, &look.params, &colors)?;
        let loop_s = self.scripts.loop_of(&instance);
        Ok(Layer {
            instance,
            look: look.clone(),
            script: source.id,
            version: source.version,
            started: self.now(),
            loop_s,
        })
    }

    fn make_transition(&mut self, idx: usize, spec: &TransitionSpec) -> Result<String, String> {
        let source = (self.lookup)(&spec.script_id)
            .or_else(|| (self.lookup)("fade"))
            .ok_or("no transition script")?;
        if source.kind != ScriptKind::Transition {
            return Err(format!("{} is not a transition", source.id));
        }
        self.ensure_registered(&source)?;
        let instance = self.next_id("t");
        let layout = Scripts::transition_layout(&self.fixtures[idx].layout);
        self.scripts
            .create(&instance, &source.key(), &layout, &spec.params, &[])?;
        Ok(instance)
    }

    fn apply(
        &mut self,
        idx: usize,
        state: FixtureState,
        transition: Transition,
        brightness_ms: Option<u32>,
        draft: Option<ScriptSource>,
    ) {
        let now = self.now();
        self.last_change = now;
        self.leave_movie();
        let id = self.fixtures[idx].cfg.id.clone();
        let old = self.fixtures[idx].state.clone();

        // Brightness ramps independently of transitions.
        let current_b = self.fixtures[idx].brightness.value(now);
        let ramp_s = brightness_ms.unwrap_or(400) as f64 / 1000.0;
        self.fixtures[idx].brightness = Ramp {
            from: if old.power {
                current_b
            } else {
                state.brightness
            },
            to: state.brightness.clamp(0.0, 1.0),
            started: now,
            duration: if old.power { ramp_s } else { 0.0 },
        };

        // A draft whose code is already showing only updates its settings.
        let needs_layer = if let Some(d) = &draft {
            self.fixtures[idx]
                .layer
                .as_ref()
                .is_none_or(|l| l.script != d.id || l.version != d.version)
        } else {
            let script_version = (self.lookup)(&state.look.script_id).map(|s| s.version);
            match &self.fixtures[idx].layer {
                None => true,
                Some(l) => {
                    l.look.script_id != state.look.script_id
                        || l.script != state.look.script_id
                        || Some(l.version) != script_version
                }
            }
        };

        let mut new_layer = None;
        if needs_layer {
            match self.make_layer(idx, &state.look, draft) {
                Ok(l) => {
                    new_layer = Some(l);
                    self.fixture_error(&id, None);
                }
                Err(e) => {
                    self.fixture_error(&id, Some(e));
                    if self.fixtures[idx].layer.is_none() {
                        // Keep showing nothing rather than an older look.
                        self.fixtures[idx].state = state;
                        return;
                    }
                }
            }
        } else if let Some(layer) = &mut self.fixtures[idx].layer
            && layer.look != state.look
        {
            let meta = self
                .registered
                .get(&format!("{}@{}", layer.script, layer.version))
                .cloned()
                .unwrap_or_default();
            let colors = colors_of(&state.look, &meta);
            let result = self
                .scripts
                .update(&layer.instance, &state.look.params, &colors);
            layer.look = state.look.clone();
            layer.loop_s = self.scripts.loop_of(&layer.instance);
            if let Err(e) = result {
                self.fixture_error(&id, Some(e));
            }
        }

        let was_visible = old.power;
        let visible = state.power;
        let spec = match transition {
            Transition::Instant => None,
            Transition::Spec(s) => Some(s),
            Transition::Auto | Transition::Change(_) => {
                let all = self.transitions.read().unwrap();
                let f = &mut self.fixtures[idx];
                let t = &f.cfg.transitions;
                let (slot, choice) = if !was_visible && visible {
                    (0, t.effective(Slot::On, &all))
                } else if was_visible && !visible {
                    (1, t.effective(Slot::Off, &all))
                } else if visible && new_layer.is_some() {
                    match &transition {
                        Transition::Change(own) if !own.is_empty() => (2, own),
                        _ => (2, t.effective(Slot::Change, &all)),
                    }
                } else {
                    (0, &NO_TRANSITIONS)
                };
                let pick = choice
                    .pick(f.picked[slot].as_ref(), &mut rand::rng())
                    .cloned();
                if pick.is_some() {
                    f.picked[slot] = pick.clone();
                }
                pick
            }
        };
        let changes_picture = was_visible != visible || (visible && new_layer.is_some());

        let f = &mut self.fixtures[idx];
        let previous_layer = match new_layer {
            Some(l) => f.layer.replace(l),
            None => None,
        };
        f.state = state;

        if !changes_picture || spec.as_ref().is_none_or(|s| s.duration_ms == 0) {
            if changes_picture && let Some(fade) = self.fixtures[idx].fade.take() {
                self.drop_fade(fade);
            }
            if let Some(l) = previous_layer {
                self.retire_layer(idx, l);
            }
            return;
        }
        let spec = spec.unwrap();

        // What is on screen now becomes the starting point.
        let from = if let Some(fade) = self.fixtures[idx].fade.take() {
            let frozen = Source::Frozen(self.fixtures[idx].out.clone());
            self.drop_fade(fade);
            if let Some(l) = previous_layer {
                self.retire_layer(idx, l);
            }
            frozen
        } else if !was_visible {
            if let Some(l) = previous_layer {
                self.retire_layer(idx, l);
            }
            Source::Black
        } else {
            match previous_layer {
                Some(l) => Source::Layer(l),
                // Same layer, but visibility changed: it is the source itself.
                None => match &self.fixtures[idx].layer {
                    Some(l) if was_visible && !visible => Source::Layer(Layer {
                        instance: l.instance.clone(),
                        ..l.clone()
                    }),
                    _ => Source::Black,
                },
            }
        };
        // Turning off fades from the layer itself; mark it shared so it isn't dropped.
        let from = match from {
            Source::Layer(l)
                if self.fixtures[idx]
                    .layer
                    .as_ref()
                    .is_some_and(|c| c.instance == l.instance) =>
            {
                Source::Layer(Layer {
                    instance: format!("shared:{}", l.instance),
                    ..l
                })
            }
            other => other,
        };
        match self.make_transition(idx, &spec) {
            Ok(instance) => {
                self.fixtures[idx].fade = Some(Fade {
                    instance,
                    from,
                    started: now,
                    duration: spec.duration_ms as f64 / 1000.0,
                });
            }
            Err(e) => {
                self.fixture_error(&id, Some(format!("transition: {e}")));
                if let Source::Layer(l) = from
                    && !l.instance.starts_with("shared:")
                {
                    self.scripts.drop_instance(&l.instance);
                }
            }
        }
    }

    /// Drops a layer that is no longer current, unless an ongoing fade still
    /// shows it (it then belongs to the fade).
    fn retire_layer(&mut self, idx: usize, layer: Layer) {
        let shared = format!("shared:{}", layer.instance);
        if let Some(Fade {
            from: Source::Layer(l),
            ..
        }) = &mut self.fixtures[idx].fade
            && l.instance == shared
        {
            l.instance = layer.instance;
            return;
        }
        self.scripts.drop_instance(&layer.instance);
    }

    fn drop_fade(&mut self, fade: Fade) {
        self.scripts.drop_instance(&fade.instance);
        if let Source::Layer(l) = fade.from
            && !l.instance.starts_with("shared:")
        {
            self.scripts.drop_instance(&l.instance);
        }
    }

    /// Renders every fixture into `self.frame` / `self.brightness`.
    fn render(&mut self, now: f64, dt: f64) {
        self.frame.iter_mut().for_each(|v| *v = 0.0);
        self.brightness.iter_mut().for_each(|v| *v = 0.0);
        for idx in 0..self.fixtures.len() {
            let mut error = None;
            {
                let f = &mut self.fixtures[idx];
                f.out.iter_mut().for_each(|v| *v = 0.0);
                if let Some(fade) = &f.fade {
                    let p = if fade.duration > 0.0 {
                        (now - fade.started) / fade.duration
                    } else {
                        1.0
                    };
                    let a = match &fade.from {
                        Source::Black => None,
                        Source::Frozen(v) => Some(v.as_slice()),
                        Source::Layer(l) => {
                            let instance = l.instance.trim_start_matches("shared:");
                            match self.scripts.render(instance, now - l.started, dt, &mut f.a) {
                                Ok(()) => Some(f.a.as_slice()),
                                Err(e) => {
                                    error = Some(e);
                                    None
                                }
                            }
                        }
                    };
                    let b = match (&f.layer, f.state.power) {
                        (Some(l), true) => {
                            match self
                                .scripts
                                .render(&l.instance, now - l.started, dt, &mut f.b)
                            {
                                Ok(()) => Some(f.b.as_slice()),
                                Err(e) => {
                                    error = Some(e);
                                    None
                                }
                            }
                        }
                        _ => None,
                    };
                    if let Err(e) = self.scripts.blend(
                        &fade.instance,
                        a,
                        b,
                        p,
                        now - fade.started,
                        dt,
                        &mut f.out,
                    ) {
                        error = Some(format!("transition: {e}"));
                        if let Some(b) = b {
                            f.out.copy_from_slice(b);
                        }
                    }
                    if p >= 1.0
                        && let Some(fade) = f.fade.take()
                    {
                        self.scripts.drop_instance(&fade.instance);
                        if let Source::Layer(l) = fade.from
                            && !l.instance.starts_with("shared:")
                        {
                            self.scripts.drop_instance(&l.instance);
                        }
                    }
                } else if let (Some(l), true) = (&f.layer, f.state.power)
                    && let Err(e) =
                        self.scripts
                            .render(&l.instance, now - l.started, dt, &mut f.out)
                {
                    error = Some(e);
                }
            }
            let f = &self.fixtures[idx];
            let b = f.brightness.value(now);
            for i in 0..f.cfg.count {
                let d = f.device_index(i);
                if d < self.brightness.len() {
                    self.frame[d * 3..d * 3 + 3].copy_from_slice(&f.out[i * 3..i * 3 + 3]);
                    self.brightness[d] = b;
                }
            }
            if let Some(e) = error {
                let id = f.cfg.id.clone();
                tracing::debug!("{id}: {e}");
                self.fixture_error(&id, Some(e));
            }
        }
        if let Some((start, count, _)) = self.identify {
            for i in 0..self.device.led_count {
                let on = i >= start && i < start + count;
                let c = if on {
                    [1.0, 1.0, 1.0]
                } else {
                    [0.0, 0.05, 0.25]
                };
                self.frame[i * 3..i * 3 + 3].copy_from_slice(&c);
                self.brightness[i] = if on { 1.0 } else { 0.4 };
            }
        }
    }

    fn publish_mirror(&self) {
        if self.frames.receiver_count() == 0 {
            return;
        }
        for f in &self.fixtures {
            let b = f.brightness.value(self.now());
            let mut rgb = Vec::with_capacity(f.cfg.count * 3);
            for i in 0..f.cfg.count {
                let d = f.device_index(i);
                let k = if self.identify.is_some() {
                    self.brightness.get(d).copied().unwrap_or(0.0)
                } else {
                    b
                };
                for c in 0..3 {
                    let v = self.frame.get(d * 3 + c).copied().unwrap_or(0.0);
                    rgb.push(((v * k).clamp(0.0, 1.0) * 255.0).round() as u8);
                }
            }
            let _ = self.frames.send(Arc::new(Frame {
                fixture: f.cfg.id.clone(),
                rgb,
            }));
        }
    }

    fn active(&self) -> bool {
        self.identify.is_some() || self.fixtures.iter().any(FixtureRt::active)
    }

    fn handle(&mut self, command: Command) -> bool {
        match command {
            Command::Stop => return false,
            Command::Configure(device, fixtures) => self.configure(device, fixtures),
            Command::Apply {
                fixture,
                state,
                transition,
                brightness_ms,
                draft,
            } => {
                if let Some(idx) = self.fixtures.iter().position(|f| f.cfg.id == fixture) {
                    // Brightness-only changes can stay in a playing movie.
                    let f = &self.fixtures[idx];
                    let only_brightness = draft.is_none()
                        && f.state.power == state.power
                        && f.state.look == state.look
                        && f.state.playlist_id == state.playlist_id
                        && f.fade.is_none();
                    if only_brightness && self.adjust_movie_brightness(idx, state.brightness) {
                        self.fixtures[idx].state = state;
                        return true;
                    }
                    self.apply(idx, state, transition, brightness_ms, draft);
                    if matches!(self.output, Output::Idle) && !self.active() {
                        // Switched off while idle: make sure the string really is off.
                        self.control.update(|s| s.desired = Some(Desired::Off));
                    }
                }
            }
            Command::Identify(range) => {
                self.leave_movie();
                self.identify = range.map(|(s, c)| (s, c, Instant::now()));
            }
            Command::ScriptChanged(script) => {
                for idx in 0..self.fixtures.len() {
                    let uses = self.fixtures[idx]
                        .layer
                        .as_ref()
                        .is_some_and(|l| l.script == script);
                    if uses {
                        let state = self.fixtures[idx].state.clone();
                        self.apply(idx, state, Transition::Auto, None, None);
                    }
                }
            }
            Command::ClearMovies => {
                self.leave_movie();
                self.failed_bakes.clear();
                self.control.update(|s| s.clear_movies = true);
            }
        }
        true
    }

    fn adjust_movie_brightness(&mut self, idx: usize, brightness: f32) -> bool {
        let Output::Movie(m) = &mut self.output else {
            return false;
        };
        let powered = self.fixtures.iter().filter(|f| f.state.power).count();
        if powered != 1 || !self.fixtures[idx].state.power {
            return false;
        }
        m.hw = brightness;
        let now = self.now();
        self.fixtures[idx].brightness = Ramp {
            from: brightness,
            to: brightness,
            started: now,
            duration: 0.0,
        };
        let desired = self.control.state.lock().unwrap().desired.clone();
        if let Some(Desired::Movie { id, .. }) = desired {
            self.control.update(|s| {
                s.desired = Some(Desired::Movie {
                    id,
                    brightness: (brightness * 100.0).round() as u8,
                })
            });
        }
        true
    }

    /// Returns to streaming, continuing each layer from where the movie is.
    fn leave_movie(&mut self) {
        let output = std::mem::replace(&mut self.output, Output::Idle);
        match output {
            Output::Movie(m) => {
                let now = self.now();
                let elapsed = ((now - m.started) * m.fps as f64).floor() as usize;
                for (idx, frames) in &m.loops {
                    if let Some(f) = self.fixtures.get_mut(*idx)
                        && let Some(l) = &mut f.layer
                    {
                        let k = elapsed % frames;
                        let t = k as f64 / *frames as f64 * l.loop_s.unwrap_or(0.0);
                        l.started = now - t;
                    }
                }
                self.output = Output::Live;
                self.control.update(|s| s.desired = Some(Desired::Live));
                self.set_status(|s| s.movie = None);
            }
            Output::Baking(_) => self.output = Output::Live,
            other => self.output = other,
        }
    }

    /// Chooses whether the current picture can become a movie.
    fn maybe_bake(&mut self, now: f64) {
        if !self.device.prefer_movies
            || !matches!(self.output, Output::Live)
            || self.identify.is_some()
            || now - self.last_change < 3.0
        {
            return;
        }
        let fps = self.device.max_fps.clamp(1.0, 30.0).floor() as u32;
        let mut loops = vec![];
        let mut hw: f32 = 0.0;
        for (idx, f) in self.fixtures.iter().enumerate() {
            if f.fade.is_some() {
                return;
            }
            if !f.state.power {
                continue;
            }
            // A playlist changes the look every few minutes: a movie per entry
            // would wear the string's flash and stall each change on an upload.
            if f.state.playlist_id.is_some() {
                return;
            }
            let Some(loop_s) = f.layer.as_ref().and_then(|l| l.loop_s) else {
                return;
            };
            let frames = ((loop_s * fps as f64).round() as usize).max(1);
            loops.push((idx, frames));
            hw = hw.max(f.state.brightness);
        }
        if loops.is_empty() || hw <= 0.0 {
            return;
        }
        fn gcd(a: usize, b: usize) -> usize {
            if b == 0 { a } else { gcd(b, a % b) }
        }
        let total = loops.iter().try_fold(1usize, |acc, (_, f)| {
            let l = acc / gcd(acc, *f) * f;
            (l <= 2400).then_some(l)
        });
        let key: String = loops
            .iter()
            .map(|(i, frames)| {
                let f = &self.fixtures[*i];
                format!(
                    "{}:{:?}:{}:{}",
                    f.cfg.id,
                    f.layer.as_ref().map(|l| (&l.look, l.version)),
                    frames,
                    (f.state.brightness / hw * 100.0).round()
                )
            })
            .collect::<Vec<_>>()
            .join("|");
        if self.failed_bakes.contains(&key) {
            return;
        }
        let Some(total) = total else {
            self.failed_bakes.insert(key);
            self.set_status(|s| {
                s.movie = Some("the fixtures' loops are too long to combine into one movie".into())
            });
            return;
        };
        self.output = Output::Baking(Bake {
            key,
            unique_id: String::new(),
            fps,
            total,
            loops,
            hw,
            data: Vec::with_capacity(total * self.device.led_count * 4),
            done: 0,
            uploaded: None,
        });
        self.set_status(|s| s.movie = Some("preparing a movie".into()));
    }

    /// Renders a few movie frames per tick, then waits for the upload.
    fn step_bake(&mut self, now: f64) {
        let Output::Baking(mut bake) = std::mem::replace(&mut self.output, Output::Live) else {
            return;
        };
        if bake.done < bake.total {
            let n = self.device.led_count;
            let mut frame = vec![0.0; n * 3];
            let mut brightness = vec![0.0; n];
            let mut bytes = vec![];
            for _ in 0..8 {
                if bake.done >= bake.total {
                    break;
                }
                frame.iter_mut().for_each(|v| *v = 0.0);
                brightness.iter_mut().for_each(|v| *v = 0.0);
                for (idx, frames) in &bake.loops {
                    let f = &mut self.fixtures[*idx];
                    let Some(l) = &f.layer else { continue };
                    let k = bake.done % frames;
                    let t = k as f64 / *frames as f64 * l.loop_s.unwrap_or(0.0);
                    if let Err(e) =
                        self.scripts
                            .render(&l.instance, t, 1.0 / bake.fps as f64, &mut f.out)
                    {
                        self.failed_bakes.insert(bake.key.clone());
                        let msg = format!("could not render the movie: {e}");
                        self.set_status(|s| s.movie = Some(msg));
                        return;
                    }
                    let rel = f.state.brightness / bake.hw;
                    for i in 0..f.cfg.count {
                        let d = f.device_index(i);
                        frame[d * 3..d * 3 + 3].copy_from_slice(&f.out[i * 3..i * 3 + 3]);
                        brightness[d] = rel;
                    }
                }
                self.device.output.encode(&frame, &brightness, &mut bytes);
                bake.data.extend_from_slice(&bytes);
                bake.done += 1;
            }
            if bake.done >= bake.total {
                bake.unique_id = movie_id_from_hash(&bake.data);
                let upload = Upload {
                    unique_id: bake.unique_id.clone(),
                    name: format!("app {}", &bake.unique_id[..8]),
                    frames: bake.total,
                    fps: bake.fps,
                    data: std::mem::take(&mut bake.data),
                };
                self.control.update(|s| s.upload = Some(upload));
                self.set_status(|s| s.movie = Some("uploading a movie".into()));
            }
            self.output = Output::Baking(bake);
            return;
        }
        if bake.uploaded.is_none() {
            let result = {
                let mut guard = self.control.uploaded.lock().unwrap();
                match guard.as_ref() {
                    Some((uid, _)) if *uid == bake.unique_id => guard.take().map(|(_, r)| r),
                    _ => None,
                }
            };
            match result {
                None => {}
                Some(Ok(id)) => bake.uploaded = Some(id),
                Some(Err(e)) => {
                    self.failed_bakes.insert(bake.key.clone());
                    self.set_status(|s| s.movie = Some(format!("staying live: {e}")));
                    return;
                }
            }
        }
        let Some(id) = bake.uploaded else {
            self.output = Output::Baking(bake);
            return;
        };
        // Switch where the first loop starts over, so the hand-over is seamless.
        let (first, _) = bake.loops[0];
        let at_boundary = self.fixtures[first].layer.as_ref().is_none_or(|l| {
            let period = l.loop_s.unwrap_or(1.0);
            let phase = (now - l.started).rem_euclid(period);
            phase < 1.5 / bake.fps as f64 || period - phase < 0.5 / bake.fps as f64
        });
        if !at_boundary {
            self.output = Output::Baking(bake);
            return;
        }
        for (idx, _) in &bake.loops {
            if let Some(l) = &mut self.fixtures[*idx].layer {
                l.started = now;
            }
        }
        let brightness = (bake.hw * 100.0).round() as u8;
        self.control
            .update(|s| s.desired = Some(Desired::Movie { id, brightness }));
        let seconds = bake.total as f64 / bake.fps as f64;
        self.set_status(|s| {
            s.movie = Some(format!(
                "playing a {seconds:.1} s movie ({} frames)",
                bake.total
            ))
        });
        self.output = Output::Movie(MoviePlayback {
            key: bake.key,
            started: now,
            fps: bake.fps,
            loops: bake.loops,
            hw: bake.hw,
        });
    }

    fn run(&mut self, rx: mpsc::Receiver<Command>) {
        let mut last = self.now();
        let mut last_mirror = 0.0;
        let mut frames = 0u32;
        let mut fps_window = Instant::now();
        let mut late = 0u64;
        let mut next = Instant::now();
        loop {
            // Wait for the next frame, handling commands meanwhile.
            let active = self.active();
            let streaming = active && !matches!(self.output, Output::Movie(_));
            let watching = self.frames.receiver_count() > 0;
            let period = if streaming {
                Duration::from_secs_f32(1.0 / self.device.max_fps.clamp(1.0, 60.0))
            } else if active && watching {
                Duration::from_millis(100)
            } else {
                Duration::from_millis(500)
            };
            loop {
                let now = Instant::now();
                if now >= next {
                    break;
                }
                match rx.recv_timeout(next - now) {
                    Ok(cmd) => {
                        if !self.handle(cmd) {
                            return;
                        }
                        // A change shows on the very next frame.
                        if !matches!(self.output, Output::Movie(_)) && self.active() {
                            next = next.min(Instant::now());
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            let now_i = Instant::now();
            if now_i > next + period {
                late += 1;
                next = now_i + period;
            } else {
                next += period;
            }
            if let Some((_, _, at)) = self.identify
                && at.elapsed() > Duration::from_secs(120)
            {
                self.identify = None;
            }

            let movie_failed = self.control.movie_failed.lock().unwrap().take();
            if let Some(e) = movie_failed
                && let Output::Movie(m) = &self.output
            {
                self.failed_bakes.insert(m.key.clone());
                self.leave_movie();
                self.set_status(|s| s.movie = Some(format!("staying live: {e}")));
            }
            if fps_window.elapsed() >= Duration::from_secs(2) {
                let fps = frames as f32 / fps_window.elapsed().as_secs_f32();
                frames = 0;
                fps_window = Instant::now();
                let output = match self.output {
                    Output::Movie(_) => "movie",
                    Output::Idle => "idle",
                    _ => "live",
                };
                self.set_status(|s| {
                    s.fps = fps;
                    s.late_frames = late;
                    s.output = output.into();
                });
            }

            let now = self.now();
            let dt = (now - last).clamp(0.0, 0.5);
            last = now;
            let active = self.active();
            match (&self.output, active) {
                (Output::Idle, true) => {
                    self.output = Output::Live;
                    self.control.update(|s| s.desired = Some(Desired::Live));
                    self.set_status(|s| s.output = "live".into());
                }
                (Output::Idle, false) => continue,
                (_, false) => {
                    // Everything faded out: send black and switch the string off.
                    self.frame.iter_mut().for_each(|v| *v = 0.0);
                    self.send_frame();
                    self.output = Output::Idle;
                    self.control.update(|s| s.desired = Some(Desired::Off));
                    self.set_status(|s| {
                        s.output = "idle".into();
                        s.fps = 0.0;
                        s.movie = None;
                    });
                    self.publish_mirror_black();
                    continue;
                }
                _ => {}
            }
            let in_movie = matches!(self.output, Output::Movie(_));
            if in_movie && !watching {
                continue;
            }
            self.render(now, dt);
            if !in_movie {
                self.send_frame();
                frames += 1;
            }
            if now - last_mirror >= 1.0 / 15.0 {
                last_mirror = now;
                self.publish_mirror();
            }
            match self.output {
                Output::Live => self.maybe_bake(now),
                Output::Baking(_) => self.step_bake(now),
                _ => {}
            }
        }
    }

    fn publish_mirror_black(&self) {
        if self.frames.receiver_count() == 0 {
            return;
        }
        for f in &self.fixtures {
            let _ = self.frames.send(Arc::new(Frame {
                fixture: f.cfg.id.clone(),
                rgb: vec![0; f.cfg.count * 3],
            }));
        }
    }

    fn send_frame(&mut self) {
        let token = *self.control.token.lock().unwrap();
        let (Some(token), Some(sender)) = (token, &self.sender) else {
            return;
        };
        self.device
            .output
            .encode(&self.frame, &self.brightness, &mut self.bytes);
        if let Err(e) = sender.send(&token, &self.bytes) {
            tracing::debug!("{}: sending a frame failed: {e}", self.device.id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn movie_ids_look_like_uuids() {
        let id = movie_id_from_hash(b"frames");
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..18], "7717");
        assert_eq!(id, movie_id_from_hash(b"frames"));
    }

    #[test]
    fn ramps_interpolate() {
        let r = Ramp {
            from: 0.0,
            to: 1.0,
            started: 1.0,
            duration: 2.0,
        };
        assert_eq!(r.value(0.0), 0.0);
        assert_eq!(r.value(2.0), 0.5);
        assert_eq!(r.value(9.0), 1.0);
    }
}
