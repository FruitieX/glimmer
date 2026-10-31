//! JSON API used by the web app. Every route needs a signed-in user.

use crate::{
    ai,
    app::{StatePatch, new_device, new_fixture},
    db,
    engine::Command,
    model::{
        Device, Fixture, FixtureState, Look, Playlist, PlaylistEntry, Preset, ScriptKind,
        ScriptSource, Season, slug,
    },
    playlist,
    script::Scripts,
    web::{ApiError, Result, Server},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Digest;

type S = State<Server>;

pub fn routes() -> Router<Server> {
    Router::new()
        .route("/api/state", get(state))
        .route("/api/devices", post(create_device))
        .route(
            "/api/devices/{id}",
            put(update_device).delete(delete_device),
        )
        .route("/api/devices/{id}/refresh", post(refresh_device))
        .route("/api/devices/{id}/identify", post(identify))
        .route("/api/devices/{id}/clear-movies", post(clear_movies))
        .route("/api/fixtures", post(create_fixture))
        .route(
            "/api/fixtures/{id}",
            put(update_fixture).delete(delete_fixture),
        )
        .route("/api/fixtures/{id}/state", post(set_state))
        .route("/api/fixtures/{id}/try", post(try_draft))
        .route("/api/fixtures/{id}/restore", post(restore))
        .route("/api/presets", post(create_preset))
        .route(
            "/api/presets/{id}",
            put(update_preset).delete(delete_preset),
        )
        .route("/api/playlists", get(list_playlists).post(create_playlist))
        .route(
            "/api/playlists/{id}",
            put(update_playlist).delete(delete_playlist),
        )
        .route("/api/scripts", post(create_script))
        .route("/api/scripts/check", post(check_script))
        .route(
            "/api/scripts/{id}",
            get(script).put(update_script).delete(delete_script),
        )
        .route("/api/scripts/{id}/versions/{version}", get(script_version))
        .route("/api/scripts/{id}/restore", post(restore_script))
        .route("/api/ai/generate", post(generate))
        .route(
            "/api/images",
            post(upload_image).layer(axum::extract::DefaultBodyLimit::max(20 * 1024 * 1024)),
        )
        .route("/api/docs/effects", get(effect_docs))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> std::result::Result<T, String> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError::bad(e.to_string()))?
        .map_err(ApiError::bad)
}

async fn state(State(s): S, headers: HeaderMap) -> Result<Response> {
    let (user, renewed) = s.session(&headers)?;
    let body = {
        let db = s.app.db()?;
        let devices = db::devices(&db)?;
        let fixtures: Vec<Value> = db::fixtures(&db)?
            .into_iter()
            .map(|(fixture, state)| {
                let points = devices.iter().find(|d| d.id == fixture.device_id).map(|d| {
                    let l = crate::layout::fixture_layout(d, &fixture);
                    let round = |v: f32| (v * 1000.0).round() / 1000.0;
                    json!({
                        "aspect": l.aspect,
                        "points": l.points.iter().map(|p| p.map(round)).collect::<Vec<_>>(),
                    })
                });
                let playing = s.app.playing(&fixture.id);
                json!({ "fixture": fixture, "state": state, "layout": points, "playing": playing })
            })
            .collect();
        json!({
            "user": user,
            "devices": devices,
            "fixtures": fixtures,
            "presets": db::presets(&db)?,
            "playlists": db::playlists(&db)?,
            "scripts": db::scripts(&db)?,
            "status": *s.app.engine.status.read().unwrap(),
            "ai": s.app.ai.is_some(),
        })
    };
    let mut response = Json(body).into_response();
    if let Some(c) = renewed {
        response
            .headers_mut()
            .insert(axum::http::header::SET_COOKIE, c);
    }
    Ok(response)
}

// ---- Devices ----

#[derive(Deserialize)]
struct NewDevice {
    name: String,
    ip: String,
}

fn valid_ip(ip: &str) -> std::result::Result<(), String> {
    let ip = ip.trim();
    if ip.is_empty()
        || ip.len() > 253
        || !ip
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c))
    {
        return Err("Enter the string's IP address or host name.".into());
    }
    Ok(())
}

async fn create_device(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<NewDevice>,
) -> Result<Json<Device>> {
    s.user(&headers)?;
    valid_ip(&body.ip)?;
    if slug(&body.name).is_empty() {
        return Err(ApiError::bad("Give the string a name."));
    }
    let device = new_device(&body.name, &body.ip, true);
    {
        let db = s.app.db()?;
        if db::device(&db, &device.id)?.is_some() {
            return Err(ApiError::bad("A string with that name already exists."));
        }
        if db::fixture(&db, &device.name)?.is_some() {
            return Err(ApiError::bad("A light with that name already exists."));
        }
        db::save_device(&db, &device)?;
        let sort = db::fixtures(&db)?.len() as i64 + 1;
        db::save_fixture(
            &db,
            &new_fixture(&device.name, &device, 0, 0, sort),
            &FixtureState::default(),
        )?;
        crate::app::App::skip_running_schedules(&db, &device.name)?;
    }
    let app = s.app.clone();
    let id = device.id.clone();
    match blocking(move || app.refresh_device(&id)).await {
        Ok(device) => Ok(Json(device)),
        Err(e) => {
            s.app.changed();
            Err(ApiError::bad(format!(
                "Saved, but the string did not answer: {}",
                e.1
            )))
        }
    }
}

async fn update_device(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut body): Json<Device>,
) -> Result<Json<Device>> {
    s.user(&headers)?;
    valid_ip(&body.ip)?;
    let old = db::device(&*s.app.db()?, &id)?.ok_or_else(|| ApiError::not_found("The string"))?;
    body.id = id.clone();
    body.max_fps = body.max_fps.clamp(1.0, 60.0);
    body.output.gamma = body.output.gamma.clamp(1.0, 3.5);
    body.output.white = body.output.white.clamp(0.0, 1.0);
    body.output.gains = body.output.gains.map(|g| g.clamp(0.0, 2.0));
    let bytes = old.output.bytes_per_led();
    let order = body.output.order.to_uppercase();
    let mut letters: Vec<char> = order.chars().collect();
    letters.sort();
    let expected: &[char] = if bytes == 4 {
        &['B', 'G', 'R', 'W']
    } else {
        &['B', 'G', 'R']
    };
    if letters != expected {
        return Err(ApiError::bad(format!(
            "The channel order must use each of {} once.",
            expected.iter().collect::<String>()
        )));
    }
    body.output.order = order;
    // Read-only facts come from the string itself.
    body.led_count = old.led_count;
    body.info = old.info;
    body.layout = old.layout;
    db::save_device(&*s.app.db()?, &body)?;
    let app = s.app.clone();
    let enabled_now = body.enabled && !old.enabled;
    blocking(move || app.sync_device(&id, enabled_now)).await?;
    s.app.changed();
    Ok(Json(body))
}

async fn delete_device(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    let app = s.app.clone();
    let id2 = id.clone();
    blocking(move || {
        app.engine.remove(&id2);
        db::delete_device(&*app.db()?, &id2)
    })
    .await?;
    s.app.changed();
    Ok(Json(json!({})))
}

async fn refresh_device(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Device>> {
    s.user(&headers)?;
    let app = s.app.clone();
    Ok(Json(blocking(move || app.refresh_device(&id)).await?))
}

#[derive(Deserialize)]
struct Identify {
    start: Option<usize>,
    count: Option<usize>,
}

async fn identify(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Identify>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    let range = body
        .start
        .map(|start| (start, body.count.unwrap_or(1).max(1)));
    s.app.engine.send(&id, Command::Identify(range));
    Ok(Json(json!({})))
}

async fn clear_movies(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    s.app.engine.send(&id, Command::ClearMovies);
    Ok(Json(json!({})))
}

// ---- Fixtures ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewFixture {
    id: String,
    device_id: String,
    start: usize,
    count: usize,
}

fn check_range(device: &Device, f: &Fixture) -> std::result::Result<(), String> {
    if device.led_count > 0 && f.start + f.count > device.led_count {
        return Err(format!(
            "{} has {} LEDs; LEDs {}–{} don't exist.",
            device.name,
            device.led_count,
            f.start,
            f.start + f.count - 1
        ));
    }
    if f.count == 0 {
        return Err("A light needs at least one LED.".into());
    }
    Ok(())
}

async fn create_fixture(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<NewFixture>,
) -> Result<Json<Fixture>> {
    s.user(&headers)?;
    let id = body.id.trim().to_string();
    if id.is_empty() || id.contains(['/', '+', '#']) {
        return Err(ApiError::bad(
            "Use a name without /, + or #; it is also the light's MQTT id.",
        ));
    }
    let fixture = {
        let db = s.app.db()?;
        let device =
            db::device(&db, &body.device_id)?.ok_or_else(|| ApiError::not_found("The string"))?;
        if db::fixture(&db, &id)?.is_some() {
            return Err(ApiError::bad("A light with that name already exists."));
        }
        let sort = db::fixtures(&db)?.len() as i64 + 1;
        let fixture = new_fixture(&id, &device, body.start, body.count, sort);
        check_range(&device, &fixture)?;
        db::save_fixture(&db, &fixture, &FixtureState::default())?;
        crate::app::App::skip_running_schedules(&db, &fixture.id)?;
        fixture
    };
    let app = s.app.clone();
    let device = fixture.device_id.clone();
    blocking(move || app.sync_device(&device, false)).await?;
    s.app.changed();
    Ok(Json(fixture))
}

async fn update_fixture(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(mut body): Json<Fixture>,
) -> Result<Json<Fixture>> {
    s.user(&headers)?;
    body.id = id.clone();
    if body.name.trim().is_empty() {
        return Err(ApiError::bad("Give the light a name."));
    }
    let device = {
        let db = s.app.db()?;
        let (old, state) =
            db::fixture(&db, &id)?.ok_or_else(|| ApiError::not_found("The light"))?;
        body.device_id = old.device_id;
        let device =
            db::device(&db, &body.device_id)?.ok_or_else(|| ApiError::not_found("The string"))?;
        check_range(&device, &body)?;
        for t in [
            &body.transitions.on,
            &body.transitions.off,
            &body.transitions.change,
        ] {
            if db::script_source(&db, &t.script_id, None)?
                .is_none_or(|s| s.kind != ScriptKind::Transition)
            {
                return Err(ApiError::bad(format!(
                    "No transition called {}.",
                    t.script_id
                )));
            }
        }
        db::save_fixture(&db, &body, &state)?;
        device.id
    };
    let app = s.app.clone();
    blocking(move || app.sync_device(&device, false)).await?;
    s.app.changed();
    Ok(Json(body))
}

async fn delete_fixture(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    let (fixture, _) = s.app.fixture(&id)?;
    // Switch it off first so its LEDs go dark.
    let _ = s.app.set_state(
        &id,
        StatePatch {
            power: Some(false),
            transition_ms: Some(0),
            ..Default::default()
        },
    );
    db::delete_fixture(&*s.app.db()?, &id)?;
    let app = s.app.clone();
    blocking(move || app.sync_device(&fixture.device_id, false)).await?;
    s.app.changed();
    Ok(Json(json!({})))
}

async fn set_state(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(patch): Json<StatePatch>,
) -> Result<Json<FixtureState>> {
    s.user(&headers)?;
    Ok(Json(s.app.set_state(&id, patch)?))
}

#[derive(Deserialize)]
struct Draft {
    source: String,
    #[serde(default)]
    params: Value,
    #[serde(default)]
    colors: Vec<String>,
}

async fn try_draft(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<Draft>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    let source = body.source.clone();
    blocking(move || Scripts::check(&source, false).map(|_| ())).await?;
    // The same code keeps the same version, so trying settings doesn't restart it.
    let digest = sha2::Sha256::digest(body.source.as_bytes());
    let version =
        -(i64::from_le_bytes(digest[..8].try_into().unwrap_or_default()) & 0x7fff_ffff_ffff);
    s.app.try_draft(
        &id,
        ScriptSource {
            id: "draft".into(),
            version,
            kind: ScriptKind::Effect,
            source: body.source,
        },
        Look {
            script_id: "draft".into(),
            params: body.params,
            colors: body.colors,
        },
    )?;
    Ok(Json(json!({})))
}

async fn restore(State(s): S, headers: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>> {
    s.user(&headers)?;
    s.app.restore(&id)?;
    Ok(Json(json!({})))
}

// ---- Presets ----

#[derive(Deserialize)]
struct PresetBody {
    name: String,
    look: Look,
}

async fn create_preset(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<PresetBody>,
) -> Result<Json<Preset>> {
    s.user(&headers)?;
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad("Give the preset a name."));
    }
    let preset = {
        let db = s.app.db()?;
        let presets = db::presets(&db)?;
        if presets.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
            return Err(ApiError::bad("A preset with that name already exists."));
        }
        let mut id = slug(&name);
        if id.is_empty() || presets.iter().any(|p| p.id == id) {
            id = format!("preset-{}", &crate::web::token()[..8]);
        }
        let preset = Preset {
            id,
            name,
            look: body.look,
            sort: presets.len() as i64 + 1,
        };
        db::save_preset(&db, &preset)?;
        preset
    };
    s.app.changed();
    Ok(Json(preset))
}

async fn update_preset(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PresetBody>,
) -> Result<Json<Preset>> {
    s.user(&headers)?;
    let preset = {
        let db = s.app.db()?;
        let presets = db::presets(&db)?;
        let old = presets
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| ApiError::not_found("The preset"))?;
        let name = body.name.trim().to_string();
        if presets
            .iter()
            .any(|p| p.id != id && p.name.eq_ignore_ascii_case(&name))
        {
            return Err(ApiError::bad("A preset with that name already exists."));
        }
        let preset = Preset {
            id: id.clone(),
            name,
            look: body.look,
            sort: old.sort,
        };
        db::save_preset(&db, &preset)?;
        preset
    };
    s.app.changed();
    Ok(Json(preset))
}

async fn delete_preset(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    {
        let db = s.app.db()?;
        db::delete_preset(&db, &id)?;
        // Playlist entries fall back to their own effect.
        for mut p in db::playlists(&db)? {
            if p.entries
                .iter()
                .any(|e| e.preset_id.as_deref() == Some(&id))
            {
                for e in &mut p.entries {
                    if e.preset_id.as_deref() == Some(&id) {
                        e.preset_id = None;
                    }
                }
                db::save_playlist(&db, &p)?;
            }
        }
    }
    s.app.changed();
    Ok(Json(json!({})))
}

// ---- Playlists ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistBody {
    name: String,
    entries: Vec<PlaylistEntry>,
    #[serde(default)]
    shuffle: bool,
    #[serde(default)]
    season: Option<Season>,
    #[serde(default)]
    auto_enabled: bool,
    #[serde(default)]
    lights: Option<Vec<String>>,
}

/// Checks a playlist and fills in its id and order; `id` is set for an update.
fn checked_playlist(
    db: &rusqlite::Connection,
    id: Option<&str>,
    body: PlaylistBody,
) -> std::result::Result<Playlist, ApiError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::bad("Give the playlist a name."));
    }
    let playlists = db::playlists(db)?;
    if playlists
        .iter()
        .any(|p| Some(p.id.as_str()) != id && p.name.eq_ignore_ascii_case(&name))
    {
        return Err(ApiError::bad("A playlist with that name already exists."));
    }
    let presets = db::presets(db)?;
    for e in &body.entries {
        if db::script_source(db, &e.script_id, None)?.is_none_or(|s| s.kind != ScriptKind::Effect) {
            return Err(ApiError::bad(format!("No effect called {}.", e.script_id)));
        }
        if let Some(p) = &e.preset_id
            && !presets.iter().any(|x| x.id == *p)
        {
            return Err(ApiError::bad(format!("No preset called {p}.")));
        }
        if !(1.0..=86_400.0).contains(&e.duration_s) {
            return Err(ApiError::bad("Each entry plays for 1 second to 24 hours."));
        }
    }
    if let Some(season) = &body.season {
        season.validate().map_err(ApiError::bad)?;
    }
    let lights = match body.lights {
        Some(lights) => {
            let fixtures = db::fixtures(db)?;
            if let Some(l) = lights
                .iter()
                .find(|l| !fixtures.iter().any(|(f, _)| f.id == **l))
            {
                return Err(ApiError::bad(format!("No light called {l}.")));
            }
            Some(lights)
        }
        None => None,
    };
    let (id, builtin, sort, removed) = match id {
        Some(id) => {
            let old = playlists
                .iter()
                .find(|p| p.id == id)
                .ok_or_else(|| ApiError::not_found("The playlist"))?;
            // Effects taken out stay out when new built-in effects are added.
            let mut removed: Vec<String> = old
                .removed
                .iter()
                .chain(old.entries.iter().map(|e| &e.script_id))
                .filter(|s| !body.entries.iter().any(|e| e.script_id == **s))
                .cloned()
                .collect();
            removed.sort();
            removed.dedup();
            (id.to_string(), old.builtin, old.sort, removed)
        }
        None => {
            let mut id = slug(&name);
            if id.is_empty() || playlists.iter().any(|p| p.id == id) {
                id = format!("playlist-{}", &crate::web::token()[..8]);
            }
            let sort = playlists.iter().map(|p| p.sort).max().unwrap_or(0) + 1;
            (id, false, sort, vec![])
        }
    };
    Ok(Playlist {
        id,
        name,
        entries: body.entries,
        shuffle: body.shuffle,
        auto_enabled: body.auto_enabled && body.season.is_some(),
        season: body.season,
        lights,
        builtin,
        removed,
        sort,
    })
}

async fn list_playlists(State(s): S, headers: HeaderMap) -> Result<Json<Vec<Playlist>>> {
    s.user(&headers)?;
    Ok(Json(db::playlists(&*s.app.db()?)?))
}

async fn create_playlist(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<PlaylistBody>,
) -> Result<Json<Playlist>> {
    s.user(&headers)?;
    let playlist = {
        let db = s.app.db()?;
        let playlist = checked_playlist(&db, None, body)?;
        db::save_playlist(&db, &playlist)?;
        playlist
    };
    s.app.run_schedules(playlist::today())?;
    s.app.changed();
    Ok(Json(playlist))
}

/// Lights playing the playlist pick up the change at their next entry; a
/// changed schedule starts or ends right away.
async fn update_playlist(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PlaylistBody>,
) -> Result<Json<Playlist>> {
    s.user(&headers)?;
    let playlist = {
        let db = s.app.db()?;
        let playlist = checked_playlist(&db, Some(&id), body)?;
        db::save_playlist(&db, &playlist)?;
        playlist
    };
    s.app.run_schedules(playlist::today())?;
    s.app.changed();
    Ok(Json(playlist))
}

async fn delete_playlist(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    db::delete_playlist(&*s.app.db()?, &id)?;
    s.app.playlist_deleted(&id)?;
    s.app.changed();
    Ok(Json(json!({})))
}

// ---- Scripts ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewScript {
    kind: ScriptKind,
    source: String,
    #[serde(default)]
    note: String,
}

#[derive(Deserialize)]
struct ScriptBody {
    source: String,
    #[serde(default)]
    note: String,
}

async fn script(State(s): S, headers: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>> {
    s.user(&headers)?;
    let db = s.app.db()?;
    let info = db::script(&db, &id)?.ok_or_else(|| ApiError::not_found("The script"))?;
    let source = db::script_source(&db, &id, None)?
        .map(|s| s.source)
        .unwrap_or_default();
    Ok(Json(
        json!({ "info": info, "source": source, "versions": db::script_versions(&db, &id)? }),
    ))
}

async fn script_version(
    State(s): S,
    headers: HeaderMap,
    Path((id, version)): Path<(String, i64)>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    let source = db::script_source(&*s.app.db()?, &id, Some(version))?
        .ok_or_else(|| ApiError::not_found("That version"))?;
    Ok(Json(
        json!({ "source": source.source, "version": source.version }),
    ))
}

async fn create_script(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<NewScript>,
) -> Result<Json<db::ScriptInfo>> {
    let user = s.user(&headers)?;
    let app = s.app.clone();
    let info = blocking(move || {
        let transition = body.kind == ScriptKind::Transition;
        let (meta, _) = Scripts::check(&body.source, transition)?;
        let db = app.db()?;
        let id = db::new_script_id(&db, &meta.name)?;
        let note = if body.note.trim().is_empty() {
            "Created".to_string()
        } else {
            body.note
        };
        db::save_script(&db, &id, body.kind, &body.source, &note, &user, false)
    })
    .await?;
    s.app.changed();
    Ok(Json(info))
}

async fn update_script(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ScriptBody>,
) -> Result<Json<db::ScriptInfo>> {
    let user = s.user(&headers)?;
    let app = s.app.clone();
    let id2 = id.clone();
    let info = blocking(move || {
        let db = app.db()?;
        let current = db::script(&db, &id2)?.ok_or("The script was not found.")?;
        if current.builtin {
            return Err("Built-in scripts can't be changed; duplicate it first.".to_string());
        }
        let note = if body.note.trim().is_empty() {
            "Edited".to_string()
        } else {
            body.note
        };
        db::save_script(&db, &id2, current.kind, &body.source, &note, &user, false)
    })
    .await?;
    s.app.engine.broadcast_script_change(&id);
    s.app.changed();
    Ok(Json(info))
}

#[derive(Deserialize)]
struct RestoreBody {
    version: i64,
}

async fn restore_script(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<RestoreBody>,
) -> Result<Json<db::ScriptInfo>> {
    let user = s.user(&headers)?;
    let app = s.app.clone();
    let id2 = id.clone();
    let info = blocking(move || {
        let db = app.db()?;
        let current = db::script(&db, &id2)?.ok_or("The script was not found.")?;
        if current.builtin {
            return Err("Built-in scripts can't be changed.".to_string());
        }
        let old = db::script_source(&db, &id2, Some(body.version))?
            .ok_or("That version was not found.")?;
        db::save_script(
            &db,
            &id2,
            current.kind,
            &old.source,
            &format!("Restored version {}", body.version),
            &user,
            false,
        )
    })
    .await?;
    s.app.engine.broadcast_script_change(&id);
    s.app.changed();
    Ok(Json(info))
}

async fn delete_script(
    State(s): S,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    {
        let db = s.app.db()?;
        let info = db::script(&db, &id)?.ok_or_else(|| ApiError::not_found("The script"))?;
        if info.builtin {
            return Err(ApiError::bad("Built-in scripts can't be deleted."));
        }
        let used_by: Vec<String> = db::fixtures(&db)?
            .into_iter()
            .filter(|(f, s)| {
                s.look.script_id == id
                    || [&f.transitions.on, &f.transitions.off, &f.transitions.change]
                        .iter()
                        .any(|t| t.script_id == id)
            })
            .map(|(f, _)| f.name)
            .chain(
                db::presets(&db)?
                    .into_iter()
                    .filter(|p| p.look.script_id == id)
                    .map(|p| p.name),
            )
            .chain(
                db::playlists(&db)?
                    .into_iter()
                    .filter(|p| p.entries.iter().any(|e| e.script_id == id))
                    .map(|p| format!("the {} playlist", p.name)),
            )
            .collect();
        if !used_by.is_empty() {
            return Err(ApiError::bad(format!(
                "Still used by {}.",
                used_by.join(", ")
            )));
        }
        db::delete_script(&db, &id)?;
    }
    s.app.changed();
    Ok(Json(json!({})))
}

#[derive(Deserialize)]
struct CheckBody {
    kind: ScriptKind,
    source: String,
}

async fn check_script(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<CheckBody>,
) -> Result<Json<Value>> {
    s.user(&headers)?;
    let result = tokio::task::spawn_blocking(move || {
        Scripts::check(&body.source, body.kind == ScriptKind::Transition)
    })
    .await
    .map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(match result {
        Ok((meta, took)) => {
            json!({ "ok": true, "meta": meta, "frameMs": took.as_secs_f64() * 1000.0 })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }))
}

async fn generate(
    State(s): S,
    headers: HeaderMap,
    Json(body): Json<ai::Request>,
) -> Result<Json<ai::Reply>> {
    s.user(&headers)?;
    let ai = s
        .app
        .ai
        .clone()
        .ok_or_else(|| ApiError::bad("AI writing is not set up (no GLIMMER_AI_URL)."))?;
    if body.prompt.trim().is_empty() {
        return Err(ApiError::bad("Describe what you'd like to see."));
    }
    Ok(Json(blocking(move || ai.generate(&body)).await?))
}

async fn effect_docs(State(s): S, headers: HeaderMap) -> Result<String> {
    s.user(&headers)?;
    Ok(include_str!("../../docs/effects.md").to_string())
}

#[derive(Deserialize)]
struct UploadQuery {
    name: Option<String>,
}

/// Stores an uploaded GIF/PNG/JPEG and creates an effect that plays it.
async fn upload_image(
    State(s): S,
    headers: HeaderMap,
    axum::extract::Query(q): axum::extract::Query<UploadQuery>,
    body: axum::body::Bytes,
) -> Result<Json<db::ScriptInfo>> {
    let user = s.user(&headers)?;
    let app = s.app.clone();
    let info = blocking(move || {
        let asset = crate::images::decode(&body)?;
        let name = q
            .name
            .map(|n| {
                n.trim()
                    .trim_end_matches(".gif")
                    .trim_end_matches(".png")
                    .to_string()
            })
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| "Image".into());
        let id = format!("img-{}", &crate::web::token()[..10]);
        let db = app.db()?;
        crate::images::save(&db, &id, &name, &asset)?;
        let script_id = db::new_script_id(&db, &name)?;
        let source = crate::images::effect_source(&id, &name);
        db::save_script(
            &db,
            &script_id,
            ScriptKind::Effect,
            &source,
            "Created from an image",
            &user,
            false,
        )
    })
    .await?;
    s.app.changed();
    Ok(Json(info))
}
