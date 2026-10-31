//! WebSockets: `/api/live` streams change notifications, device status and
//! the colours fixtures are showing; `/api/preview` renders a script that is
//! being edited without touching any lights.

use crate::{
    app::Event,
    color, db, layout,
    model::ScriptKind,
    script::{Rgb, Scripts},
    web::Server,
};
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    sync::mpsc,
    time::{Duration, Instant},
};

pub async fn live(State(s): State<Server>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if let Err(e) = s.user(&headers) {
        return e.into_response();
    }
    ws.on_upgrade(move |socket| live_socket(s, socket))
}

/// Binary messages: one byte of id length, the fixture id, then RGB bytes.
async fn live_socket(s: Server, socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();
    let mut frames = s.app.engine.subscribe();
    let mut events = s.app.events.subscribe();
    let mut status_tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        let message = tokio::select! {
            frame = frames.recv() => match frame {
                Ok(frame) => {
                    let id = frame.fixture.as_bytes();
                    let mut data = Vec::with_capacity(1 + id.len() + frame.rgb.len());
                    data.push(id.len().min(255) as u8);
                    data.extend_from_slice(&id[..id.len().min(255)]);
                    data.extend_from_slice(&frame.rgb);
                    Message::Binary(data.into())
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            event = events.recv() => match event {
                Ok(Event::State(id)) => Message::Text(json!({"type": "state", "id": id}).to_string().into()),
                Ok(Event::Config) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) =>
                    Message::Text(json!({"type": "changed"}).to_string().into()),
                Err(_) => break,
            },
            _ = status_tick.tick() => {
                let status = s.app.engine.status.read().unwrap().clone();
                Message::Text(json!({"type": "status", "status": status}).to_string().into())
            }
            incoming = rx.next() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => continue,
            },
        };
        if tx.send(message).await.is_err() {
            break;
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewRequest {
    kind: ScriptKind,
    source: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    colors: Vec<String>,
    /// Whose LED positions to use; a 10 × 21 grid otherwise.
    fixture_id: Option<String>,
    /// For transitions: how long one run takes.
    duration_ms: Option<u32>,
}

pub async fn preview(
    State(s): State<Server>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err(e) = s.user(&headers) {
        return e.into_response();
    }
    ws.on_upgrade(move |socket| preview_socket(s, socket))
}

/// A preview request with the LED positions to render it on.
type Job = (PreviewRequest, Option<layout::FixtureLayout>);

enum ToClient {
    Text(String),
    Frame(Vec<u8>),
}

async fn preview_socket(s: Server, socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();
    let (req_tx, req_rx) = mpsc::channel::<Job>();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<ToClient>(8);
    std::thread::spawn(move || preview_thread(req_rx, out_tx));
    loop {
        tokio::select! {
            incoming = rx.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    match serde_json::from_str::<PreviewRequest>(&text) {
                        Ok(req) => {
                            let layout = req
                                .fixture_id
                                .as_ref()
                                .and_then(|id| target_layout(&*s.app.db().ok()?, id));
                            if req_tx.send((req, layout)).is_err() {
                                break;
                            }
                        }
                        Err(e) => {
                            let msg = json!({"type": "error", "error": e.to_string()}).to_string();
                            if tx.send(Message::Text(msg.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            out = out_rx.recv() => match out {
                Some(ToClient::Text(t)) => { if tx.send(Message::Text(t.into())).await.is_err() { break; } }
                Some(ToClient::Frame(f)) => { if tx.send(Message::Binary(f.into())).await.is_err() { break; } }
                None => break,
            },
        }
    }
}

/// The default preview without a light: a 25 × 25 grid.
fn grid() -> layout::FixtureLayout {
    simulated_grid(25, 25)
}

/// A grid of `cols` strands of `rows` LEDs, hanging from the top like a curtain.
fn simulated_grid(cols: usize, rows: usize) -> layout::FixtureLayout {
    let span = |n: usize| (n.max(2) - 1) as f32;
    let points = (0..cols * rows)
        .map(|i| {
            [
                (i / rows) as f32 / span(cols),
                1.0 - (i % rows) as f32 / span(rows),
                0.5,
            ]
        })
        .collect();
    layout::FixtureLayout::plain(points, cols as f32 / rows as f32)
}

/// Where a preview renders: a light by id, or a simulated grid named like
/// `grid:50x50` (up to 100 × 100).
fn target_layout(db: &rusqlite::Connection, id: &str) -> Option<layout::FixtureLayout> {
    if let Some(size) = id.strip_prefix("grid:") {
        let (c, r) = size.split_once('x')?;
        let (c, r): (usize, usize) = (c.parse().ok()?, r.parse().ok()?);
        return ((1..=100).contains(&c) && (1..=100).contains(&r)).then(|| simulated_grid(c, r));
    }
    let (f, _) = db::fixture(db, id).ok()??;
    let d = db::device(db, &f.device_id).ok()??;
    Some(layout::fixture_layout(&d, &f))
}

fn preview_thread(rx: mpsc::Receiver<Job>, tx: tokio::sync::mpsc::Sender<ToClient>) {
    let Ok(scripts) = Scripts::new() else { return };
    let mut serial = 0u64;
    let mut keys: Vec<String> = vec![];
    // The LED positions and colour slot defaults of the running preview.
    let mut current_layout: Option<layout::FixtureLayout> = None;
    let mut current_slots: Vec<String> = vec![];
    let mut current: Option<(PreviewRequest, usize, Instant)> = None;
    let mut out = vec![];
    let mut a = vec![];
    let mut b = vec![];
    let send_text = |v: Value| tx.blocking_send(ToClient::Text(v.to_string())).is_ok();
    loop {
        // Newest request wins.
        let mut latest = None;
        loop {
            match rx.try_recv() {
                Ok(r) => latest = Some(r),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }
        // Only settings changed: update the running instance so the
        // animation carries on instead of restarting.
        let latest = match (latest, &mut current) {
            (Some((req, layout)), Some((cur, _, _)))
                if req.source == cur.source
                    && req.kind == cur.kind
                    && req.fixture_id == cur.fixture_id
                    && layout == current_layout =>
            {
                let slots = &current_slots;
                let colors: Vec<Rgb> = (0..req.colors.len().max(slots.len()))
                    .map(|i| {
                        req.colors
                            .get(i)
                            .and_then(|c| color::parse_hex(c))
                            .or_else(|| slots.get(i).and_then(|c| color::parse_hex(c)))
                            .unwrap_or([1.0, 1.0, 1.0])
                    })
                    .collect();
                if let Err(e) = scripts.update("main", &req.params, &colors)
                    && !send_text(json!({"type": "error", "error": e}))
                {
                    return;
                }
                cur.params = req.params;
                cur.colors = req.colors;
                cur.duration_ms = req.duration_ms;
                None
            }
            (latest, _) => latest,
        };
        if let Some((req, layout)) = latest {
            serial += 1;
            // Forget the previous version's modules.
            for k in keys.drain(..) {
                scripts.unregister(&k);
            }
            let key = format!("preview{serial}");
            keys.push(key.clone());
            let requested = layout.clone();
            let l = layout.unwrap_or_else(grid);
            let n = l.points.len();
            let layout_id = format!("l{serial}");
            let colors_of = |meta: &crate::script::Meta| -> Vec<Rgb> {
                let slots = req.colors.len().max(meta.colors.len());
                (0..slots)
                    .map(|i| {
                        req.colors
                            .get(i)
                            .and_then(|c| color::parse_hex(c))
                            .or_else(|| {
                                meta.colors
                                    .get(i)
                                    .and_then(|c| color::parse_hex(&c.default))
                            })
                            .unwrap_or([1.0, 1.0, 1.0])
                    })
                    .collect()
            };
            let result = (|| -> Result<crate::script::Meta, String> {
                scripts.fixture_layout(&layout_id, &l)?;
                let meta = scripts.register(&key, &req.source)?;
                let main_layout = match req.kind {
                    ScriptKind::Transition => Scripts::transition_layout(&layout_id),
                    _ => layout_id.clone(),
                };
                scripts.create("main", &key, &main_layout, &req.params, &colors_of(&meta))?;
                if req.kind == ScriptKind::Transition {
                    for (inst, id) in [("from", "rainbow"), ("to", "twinkle")] {
                        let src = crate::builtin::source(id).unwrap_or_default();
                        let k = format!("{id}{serial}");
                        keys.push(k.clone());
                        let m = scripts.register(&k, src)?;
                        let defaults: Vec<Rgb> = m
                            .colors
                            .iter()
                            .filter_map(|c| color::parse_hex(&c.default))
                            .collect();
                        scripts.create(inst, &k, &layout_id, &json!({}), &defaults)?;
                    }
                }
                Ok(meta)
            })();
            match result {
                Ok(meta) => {
                    if !send_text(json!({"type": "meta", "meta": meta, "points": l.points})) {
                        return;
                    }
                    out = vec![0.0; n * 3];
                    a = vec![0.0; n * 3];
                    b = vec![0.0; n * 3];
                    current_slots = meta.colors.iter().map(|c| c.default.clone()).collect();
                    current_layout = requested;
                    current = Some((req, n, Instant::now()));
                }
                Err(e) => {
                    if !send_text(json!({"type": "error", "error": e})) {
                        return;
                    }
                }
            }
        }
        let started = Instant::now();
        if let Some((req, _, t0)) = &current {
            let t = t0.elapsed().as_secs_f64();
            let result = if req.kind == ScriptKind::Transition {
                let duration = req.duration_ms.unwrap_or(1500).max(100) as f64 / 1000.0;
                let cycle = duration + 1.0;
                let phase = t % cycle;
                let progress = (phase / duration).min(1.0);
                scripts
                    .render("from", t, 0.04, &mut a)
                    .and_then(|_| scripts.render("to", t, 0.04, &mut b))
                    .and_then(|_| {
                        scripts.blend("main", Some(&a), Some(&b), progress, phase, 0.04, &mut out)
                    })
            } else {
                scripts.render("main", t, 0.04, &mut out)
            };
            match result {
                Ok(()) => {
                    let bytes = out
                        .iter()
                        .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
                        .collect();
                    if tx.blocking_send(ToClient::Frame(bytes)).is_err() {
                        return;
                    }
                }
                Err(e) => {
                    current = None;
                    if !send_text(json!({"type": "error", "error": e})) {
                        return;
                    }
                }
            }
        }
        let period = if current.is_some() {
            Duration::from_millis(40)
        } else {
            Duration::from_millis(100)
        };
        if let Some(rest) = period.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GalleryRequest {
    kind: ScriptKind,
    /// Whose LED positions to use; a 10 × 21 grid otherwise.
    fixture_id: Option<String>,
}

/// Live thumbnails of every effect (or transition) with default settings.
/// Binary messages: one byte of id length, the script id, then RGB bytes.
pub async fn gallery(
    State(s): State<Server>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err(e) = s.user(&headers) {
        return e.into_response();
    }
    ws.on_upgrade(move |socket| gallery_socket(s, socket))
}

/// What the gallery thread is rendering: kind, (script id, key) pairs, LED count, start.
type GalleryRun = (ScriptKind, Vec<(String, String)>, usize, Instant);

type GalleryJob = (
    ScriptKind,
    Vec<crate::model::ScriptSource>,
    layout::FixtureLayout,
);

enum GalleryMsg {
    Job(GalleryJob),
    /// Script ids whose cards are on screen; only these are rendered.
    Visible(HashSet<String>),
}

#[derive(Deserialize)]
struct GalleryVisible {
    visible: Vec<String>,
}

async fn gallery_socket(s: Server, socket: WebSocket) {
    let (mut tx, mut rx) = socket.split();
    let (job_tx, job_rx) = mpsc::channel::<GalleryMsg>();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    std::thread::spawn(move || gallery_thread(job_rx, out_tx));
    loop {
        tokio::select! {
            incoming = rx.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(v) = serde_json::from_str::<GalleryVisible>(&text) {
                        if job_tx.send(GalleryMsg::Visible(v.visible.into_iter().collect())).is_err() {
                            break;
                        }
                        continue;
                    }
                    let Ok(req) = serde_json::from_str::<GalleryRequest>(&text) else { continue };
                    let job = (|| -> Option<GalleryJob> {
                        let db = s.app.db().ok()?;
                        let sources = db::scripts(&db)
                            .ok()?
                            .into_iter()
                            .filter(|i| i.kind == req.kind)
                            .filter_map(|i| db::script_source(&db, &i.id, None).ok().flatten())
                            .collect();
                        let layout = req
                            .fixture_id
                            .as_ref()
                            .and_then(|id| target_layout(&db, id))
                            .unwrap_or_else(grid);
                        Some((req.kind, sources, layout))
                    })();
                    if let Some(job) = job
                        && job_tx.send(GalleryMsg::Job(job)).is_err() {
                            break;
                        }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            out = out_rx.recv() => match out {
                Some(frame) => { if tx.send(Message::Binary(frame.into())).await.is_err() { break; } }
                None => break,
            },
        }
    }
}

fn gallery_thread(rx: mpsc::Receiver<GalleryMsg>, tx: tokio::sync::mpsc::Sender<Vec<u8>>) {
    let mut job: Option<GalleryRun> = None;
    let mut scripts = None;
    // Older clients never say what's visible, so everything renders.
    let mut visible: Option<HashSet<String>> = None;
    loop {
        let mut latest = None;
        loop {
            match rx.try_recv() {
                Ok(GalleryMsg::Job(j)) => latest = Some(j),
                Ok(GalleryMsg::Visible(v)) => visible = Some(v),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }
        if let Some((kind, sources, l)) = latest {
            // A fresh runtime per request keeps old modules from piling up.
            let Ok(rt) = Scripts::new() else { return };
            let n = l.points.len();
            let mut ready = vec![];
            if rt.fixture_layout("l", &l).is_ok() {
                let defaults = |m: &crate::script::Meta| -> Vec<Rgb> {
                    m.colors
                        .iter()
                        .filter_map(|c| color::parse_hex(&c.default))
                        .collect()
                };
                if kind == ScriptKind::Transition {
                    for (inst, id) in [("from", "rainbow"), ("to", "twinkle")] {
                        let src = crate::builtin::source(id).unwrap_or_default();
                        if let Ok(m) = rt.register(id, src) {
                            let _ = rt.create(inst, id, "l", &json!({}), &defaults(&m));
                        }
                    }
                }
                let on = match kind {
                    ScriptKind::Transition => Scripts::transition_layout("l"),
                    _ => "l".to_string(),
                };
                for source in sources {
                    let key = source.key();
                    if let Ok(m) = rt.register(&key, &source.source)
                        && rt
                            .create(&key, &key, &on, &json!({}), &defaults(&m))
                            .is_ok()
                    {
                        ready.push((source.id.clone(), key));
                    }
                }
            }
            scripts = Some(rt);
            job = Some((kind, ready, n, Instant::now()));
        }
        let started = Instant::now();
        if let (Some((kind, items, n, t0)), Some(rt)) = (&job, &scripts) {
            let t = t0.elapsed().as_secs_f64();
            let mut out = vec![0.0; n * 3];
            let mut a = vec![0.0; n * 3];
            let mut b = vec![0.0; n * 3];
            let shown = |id: &String| visible.as_ref().is_none_or(|v| v.contains(id));
            if *kind == ScriptKind::Transition && items.iter().any(|(id, _)| shown(id)) {
                let _ = rt.render("from", t, 0.1, &mut a);
                let _ = rt.render("to", t, 0.1, &mut b);
            }
            for (id, key) in items {
                if !shown(id) {
                    continue;
                }
                let ok = if *kind == ScriptKind::Transition {
                    let phase = t % 3.0;
                    rt.blend(
                        key,
                        Some(&a),
                        Some(&b),
                        (phase / 2.0).min(1.0),
                        phase,
                        0.1,
                        &mut out,
                    )
                } else {
                    rt.render(key, t, 0.1, &mut out)
                };
                if ok.is_err() {
                    continue;
                }
                let idb = id.as_bytes();
                let mut msg = Vec::with_capacity(1 + idb.len() + n * 3);
                msg.push(idb.len().min(255) as u8);
                msg.extend_from_slice(&idb[..idb.len().min(255)]);
                msg.extend(
                    out.iter()
                        .map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8),
                );
                if tx.blocking_send(msg).is_err() {
                    return;
                }
            }
        }
        let period = Duration::from_millis(if job.is_some() { 80 } else { 200 });
        if let Some(rest) = period.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}
