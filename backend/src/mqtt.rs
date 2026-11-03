//! MQTT bridge for homectl, compatible with twinkly-mqtt's topics:
//! state is published (retained) on `<prefix>/<fixture id>`, commands
//! arrive on `<prefix>/<fixture id>/set`, and the presets homectl can pick
//! are published on `<prefix>/<fixture id>/presets`. Playlists appear among
//! the presets as `Playlist: <name>`.

use crate::{
    app::{App, Event, StatePatch},
    color, db,
    model::{DeviceKind, Playlist, Preset},
    playlist,
};
use rumqttc::{AsyncClient, Event as MqttEvent, MqttOptions, Packet, QoS};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Arc, time::Duration};

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    /// Twinkly fixtures, whose topics homectl already knows.
    pub prefix: String,
    /// LIFX fixtures, kept on lifx-mqtt's old topics so existing homectl
    /// devices keep working.
    pub lifx_prefix: String,
}

impl Config {
    pub fn from_env() -> Option<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Some(Self {
            host: var("GLIMMER_MQTT_HOST")?,
            port: var("GLIMMER_MQTT_PORT")
                .and_then(|p| p.parse().ok())
                .unwrap_or(1883),
            username: var("GLIMMER_MQTT_USERNAME"),
            password: var("GLIMMER_MQTT_PASSWORD"),
            prefix: var("GLIMMER_MQTT_PREFIX")
                .unwrap_or("home/lights/twinkly".into())
                .trim_end_matches('/')
                .to_string(),
            lifx_prefix: {
                let prefix = var("GLIMMER_MQTT_LIFX_PREFIX").unwrap_or_else(|| {
                    let base = var("GLIMMER_MQTT_PREFIX").unwrap_or("home/lights/twinkly".into());
                    match base.trim_end_matches('/').rsplit_once('/') {
                        Some((base, _)) => format!("{base}/lifx"),
                        None => "lifx".into(),
                    }
                });
                prefix.trim_end_matches('/').to_string()
            },
        })
    }
}

/// A homectl command. Colours may be in any homectl form.
#[derive(Debug, Default, Deserialize)]
struct SetMessage {
    power: Option<bool>,
    brightness: Option<f32>,
    color: Option<Value>,
    colors: Option<Vec<Value>>,
    preset: Option<String>,
    /// An effect id, as the HTTP API takes it (e.g. `solid`).
    #[serde(rename = "scriptId")]
    script_id: Option<String>,
    transition_ms: Option<f32>,
    /// Seconds, as some homectl integrations send it.
    transition: Option<f32>,
}

fn patch_from(msg: SetMessage) -> Result<StatePatch, String> {
    let to_hex = |v: &Value| {
        color::from_json(v)
            .map(color::to_hex)
            .ok_or_else(|| format!("unreadable colour {v}"))
    };
    Ok(StatePatch {
        power: msg.power,
        brightness: msg.brightness,
        preset: msg.preset.filter(|p| !p.trim().is_empty()),
        script_id: msg.script_id,
        color: msg
            .color
            .as_ref()
            .filter(|c| !c.is_null())
            .map(to_hex)
            .transpose()?,
        colors: msg
            .colors
            .map(|cs| cs.iter().map(to_hex).collect::<Result<Vec<_>, _>>())
            .transpose()?,
        transition_ms: msg
            .transition_ms
            .or(msg.transition.map(|s| s * 1000.0))
            .map(|ms| ms.max(0.0) as u32),
        ..Default::default()
    })
}

fn state_payload(app: &App, id: &str) -> Result<Value, String> {
    let db = app.db()?;
    let (fixture, state) = db::fixture(&db, id)?.ok_or("gone")?;
    let colors: Vec<Value> = state
        .look
        .colors
        .iter()
        .filter_map(|c| color::parse_hex(c))
        .map(color::to_json)
        .collect();
    let presets = db::presets(&db)?;
    let playlists = db::playlists(&db)?;
    let preset = match &state.playlist_id {
        Some(id) => playlists
            .iter()
            .find(|p| p.id == *id)
            .map(playlist::preset_name),
        None => state
            .preset_id
            .as_ref()
            .and_then(|p| presets.iter().find(|x| x.id == *p))
            .map(|p| p.name.clone()),
    };
    let names = preset_names(&presets, &playlists);
    Ok(json!({
        "id": fixture.id,
        "name": fixture.name,
        "power": state.power,
        "brightness": state.brightness,
        "color": colors.first(),
        "colors": colors,
        "preset": preset,
        "presets": names,
        "effect": state.look.script_id,
        // lifx-mqtt published this, and homectl uses it to allow HS commands.
        "capabilities": { "hs": true, "brightness": true },
    }))
}

/// What homectl can pick: the presets, then the playlists.
fn preset_names(presets: &[Preset], playlists: &[Playlist]) -> Vec<String> {
    presets
        .iter()
        .map(|p| p.name.clone())
        .chain(playlists.iter().map(playlist::preset_name))
        .collect()
}

/// The MQTT prefix a fixture's device uses.
fn prefix_for(app: &App, config: &Config, id: &str) -> Option<String> {
    let db = app.db().ok()?;
    let (fixture, _) = db::fixture(&db, id).ok()??;
    let device = db::device(&db, &fixture.device_id).ok()??;
    Some(match device.kind {
        DeviceKind::Twinkly => config.prefix.clone(),
        DeviceKind::Lifx => config.lifx_prefix.clone(),
    })
}

async fn publish_all(
    app: &App,
    client: &AsyncClient,
    config: &Config,
    known: &mut HashSet<(String, String)>,
) {
    let (fixtures, names) = {
        let Ok(db) = app.db() else { return };
        (
            db::fixtures(&db).unwrap_or_default(),
            preset_names(
                &db::presets(&db).unwrap_or_default(),
                &db::playlists(&db).unwrap_or_default(),
            ),
        )
    };
    let current: HashSet<(String, String)> = fixtures
        .iter()
        .filter_map(|(f, _)| Some((prefix_for(app, config, &f.id)?, f.id.clone())))
        .collect();
    for (f, _) in &fixtures {
        let Some(prefix) = prefix_for(app, config, &f.id) else {
            continue;
        };
        publish_state(app, client, &prefix, &f.id).await;
        let _ = client
            .publish(
                format!("{prefix}/{}/presets", f.id),
                QoS::AtLeastOnce,
                true,
                json!(names).to_string(),
            )
            .await;
    }
    // Clear retained state of removed fixtures.
    for (prefix, gone) in known.difference(&current) {
        let _ = client
            .publish(format!("{prefix}/{gone}"), QoS::AtLeastOnce, true, "")
            .await;
        let _ = client
            .publish(
                format!("{prefix}/{gone}/presets"),
                QoS::AtLeastOnce,
                true,
                "",
            )
            .await;
    }
    *known = current;
}

async fn publish_state(app: &App, client: &AsyncClient, prefix: &str, id: &str) {
    if let Ok(payload) = state_payload(app, id) {
        let _ = client
            .publish(
                format!("{prefix}/{id}"),
                QoS::AtLeastOnce,
                true,
                payload.to_string(),
            )
            .await;
    }
}

pub fn spawn(app: Arc<App>, config: Config) {
    let suffix: String = (0..6)
        .map(|_| (b'a' + rand::random_range(0..26u8)) as char)
        .collect();
    let mut options = MqttOptions::new(format!("glimmer-{suffix}"), &config.host, config.port);
    options.set_keep_alive(Duration::from_secs(15));
    if let (Some(u), Some(p)) = (&config.username, &config.password) {
        options.set_credentials(u, p);
    }
    let (client, mut eventloop) = AsyncClient::new(options, 64);
    let prefix = config.prefix.clone();
    let lifx_prefix = config.lifx_prefix.clone();
    let event_config = config.clone();

    {
        let app = app.clone();
        let client = client.clone();
        tokio::spawn(async move {
            let mut events = app.events.subscribe();
            let mut known = HashSet::new();
            loop {
                match events.recv().await {
                    Ok(Event::State(id)) => {
                        if let Some(prefix) = prefix_for(&app, &event_config, &id) {
                            publish_state(&app, &client, &prefix, &id).await;
                        }
                    }
                    Ok(Event::Config) | Err(_) => {
                        publish_all(&app, &client, &event_config, &mut known).await
                    }
                }
            }
        });
    }

    tokio::spawn(async move {
        loop {
            match eventloop.poll().await {
                Ok(MqttEvent::Incoming(Packet::ConnAck(_))) => {
                    tracing::info!("MQTT connected to {}", config.host);
                    for prefix in [&prefix, &lifx_prefix] {
                        let _ = client
                            .subscribe(format!("{prefix}/+/set"), QoS::AtLeastOnce)
                            .await;
                    }
                    app.changed();
                }
                Ok(MqttEvent::Incoming(Packet::Publish(msg))) => {
                    // A retained command is an old one replayed on subscribe; the
                    // database already holds the current state.
                    if msg.retain {
                        continue;
                    }
                    let id = [&prefix, &lifx_prefix].iter().find_map(|prefix| {
                        msg.topic
                            .strip_prefix(&format!("{prefix}/"))
                            .and_then(|t| t.strip_suffix("/set"))
                    });
                    let Some(id) = id else {
                        continue;
                    };
                    let result = serde_json::from_slice::<SetMessage>(&msg.payload)
                        .map_err(|e| e.to_string())
                        .and_then(patch_from)
                        .and_then(|patch| app.set_state(id, patch));
                    if let Err(e) = result {
                        tracing::warn!("MQTT command for {id}: {e}");
                    }
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!("MQTT: {e}");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_homectl_commands() {
        let msg: SetMessage = serde_json::from_str(
            r#"{"id":"Curtain","name":"Curtain","power":true,"brightness":0.5,"color":{"h":0,"s":1.0},"transition_ms":800}"#,
        )
        .unwrap();
        let patch = patch_from(msg).unwrap();
        assert_eq!(patch.power, Some(true));
        assert_eq!(patch.brightness, Some(0.5));
        assert_eq!(patch.color.as_deref(), Some("#ff0000"));
        assert_eq!(patch.transition_ms, Some(800));
        let msg: SetMessage =
            serde_json::from_str(r#"{"power":false,"transition":1.5,"preset":"Aurora"}"#).unwrap();
        let patch = patch_from(msg).unwrap();
        assert_eq!(patch.transition_ms, Some(1500));
        assert_eq!(patch.preset.as_deref(), Some("Aurora"));
        let msg: SetMessage = serde_json::from_str(r#"{"scriptId":"solid"}"#).unwrap();
        assert_eq!(patch_from(msg).unwrap().script_id.as_deref(), Some("solid"));
    }
}
