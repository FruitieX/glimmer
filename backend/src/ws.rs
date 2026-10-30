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
type Job = (PreviewRequest, Option<(Vec<[f32; 3]>, f32)>);

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
                            let layout = req.fixture_id.as_ref().and_then(|id| {
                                let db = s.app.db().ok()?;
                                let (f, _) = db::fixture(&db, id).ok()??;
                                let d = db::device(&db, &f.device_id).ok()??;
                                let l = layout::fixture_layout(&d, &f);
                                Some((l.points, l.aspect))
                            });
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

fn grid() -> (Vec<[f32; 3]>, f32) {
    let points = (0..210)
        .map(|i| [(i / 21) as f32 / 9.0, 1.0 - (i % 21) as f32 / 20.0, 0.5])
        .collect();
    (points, 1.0)
}

fn preview_thread(rx: mpsc::Receiver<Job>, tx: tokio::sync::mpsc::Sender<ToClient>) {
    let Ok(scripts) = Scripts::new() else { return };
    let mut serial = 0u64;
    let mut keys: Vec<String> = vec![];
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
        if let Some((req, layout)) = latest {
            serial += 1;
            // Forget the previous version's modules.
            for k in keys.drain(..) {
                scripts.unregister(&k);
            }
            let key = format!("preview{serial}");
            keys.push(key.clone());
            let (points, aspect) = layout.unwrap_or_else(grid);
            let n = points.len();
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
                scripts.layout(&layout_id, &points, aspect)?;
                let meta = scripts.register(&key, &req.source)?;
                scripts.create("main", &key, &layout_id, &req.params, &colors_of(&meta))?;
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
                    if !send_text(json!({"type": "meta", "meta": meta, "points": points})) {
                        return;
                    }
                    out = vec![0.0; n * 3];
                    a = vec![0.0; n * 3];
                    b = vec![0.0; n * 3];
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
