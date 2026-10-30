//! MQTT bridge for homectl, compatible with twinkly-mqtt's topics:
//! state is published (retained) on `<prefix>/<fixture id>`, commands
//! arrive on `<prefix>/<fixture id>/set`, and the presets homectl can pick
//! are published on `<prefix>/<fixture id>/presets`.

use crate::{
    app::{App, Event, StatePatch},
    color, db,
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
    pub prefix: String,
}

impl Config {
    pub fn from_env() -> Option<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Some(Self {
            host: var("TWINKLY_MQTT_HOST")?,
            port: var("TWINKLY_MQTT_PORT")
                .and_then(|p| p.parse().ok())
                .unwrap_or(1883),
            username: var("TWINKLY_MQTT_USERNAME"),
            password: var("TWINKLY_MQTT_PASSWORD"),
            prefix: var("TWINKLY_MQTT_PREFIX")
                .unwrap_or("home/lights/twinkly".into())
                .trim_end_matches('/')
                .to_string(),
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
    let preset = state
        .preset_id
        .as_ref()
        .and_then(|p| presets.iter().find(|x| x.id == *p))
        .map(|p| p.name.clone());
    let names: Vec<&str> = presets.iter().map(|p| p.name.as_str()).collect();
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
    }))
}

async fn publish_all(app: &App, client: &AsyncClient, prefix: &str, known: &mut HashSet<String>) {
    let (fixtures, presets) = {
        let Ok(db) = app.db() else { return };
        (
            db::fixtures(&db).unwrap_or_default(),
            db::presets(&db).unwrap_or_default(),
        )
    };
    let names: Vec<&str> = presets.iter().map(|p| p.name.as_str()).collect();
    let current: HashSet<String> = fixtures.iter().map(|(f, _)| f.id.clone()).collect();
    for (f, _) in &fixtures {
        publish_state(app, client, prefix, &f.id).await;
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
    for gone in known.difference(&current) {
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
    let mut options = MqttOptions::new(format!("twinkly-{suffix}"), &config.host, config.port);
    options.set_keep_alive(Duration::from_secs(15));
    if let (Some(u), Some(p)) = (&config.username, &config.password) {
        options.set_credentials(u, p);
    }
    let (client, mut eventloop) = AsyncClient::new(options, 64);
    let prefix = config.prefix.clone();

    {
        let app = app.clone();
        let client = client.clone();
        let prefix = prefix.clone();
        tokio::spawn(async move {
            let mut events = app.events.subscribe();
            let mut known = HashSet::new();
            loop {
                match events.recv().await {
                    Ok(Event::State(id)) => publish_state(&app, &client, &prefix, &id).await,
                    Ok(Event::Config) | Err(_) => {
                        publish_all(&app, &client, &prefix, &mut known).await
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
                    let _ = client
                        .subscribe(format!("{prefix}/+/set"), QoS::AtLeastOnce)
                        .await;
                    app.changed();
                }
                Ok(MqttEvent::Incoming(Packet::Publish(msg))) => {
                    // A retained command is an old one replayed on subscribe; the
                    // database already holds the current state.
                    if msg.retain {
                        continue;
                    }
                    let Some(id) = msg
                        .topic
                        .strip_prefix(&format!("{prefix}/"))
                        .and_then(|t| t.strip_suffix("/set"))
                    else {
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
    }
}
