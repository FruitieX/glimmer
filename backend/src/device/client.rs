//! Blocking client for the Twinkly local HTTP API (`/xled/v1`), as reverse
//! engineered by the xled project (https://xled-docs.readthedocs.io).
//! Only Generation II firmware (2.5.6 and later) is supported.

use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

pub type Result<T> = std::result::Result<T, String>;

/// Tokens are re-verified when older than this.
const VERIFY_EVERY: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Gestalt {
    pub product_code: Option<String>,
    pub device_name: Option<String>,
    pub fw_family: Option<String>,
    pub hardware_version: Option<String>,
    pub mac: Option<String>,
    pub number_of_led: usize,
    pub bytes_per_led: Option<usize>,
    pub led_profile: Option<String>,
    pub frame_rate: Option<f64>,
    pub measured_frame_rate: Option<f64>,
    pub movie_capacity: Option<u64>,
    pub max_movies: Option<u64>,
}

impl Gestalt {
    pub fn bytes_per_led(&self) -> usize {
        match (self.bytes_per_led, self.led_profile.as_deref()) {
            (Some(n), _) => n,
            (None, Some("RGBW")) => 4,
            _ => 3,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub z: f32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Layout {
    /// `2d` or `3d` when mapped in the Twinkly app; a straight line otherwise.
    pub source: String,
    #[serde(default)]
    pub synthesized: bool,
    pub coordinates: Vec<Point>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Movie {
    pub id: u32,
    pub name: String,
    pub unique_id: String,
    pub descriptor_type: Option<String>,
    pub leds_per_frame: Option<usize>,
    pub frames_number: Option<usize>,
    pub fps: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Movies {
    pub movies: Vec<Movie>,
    pub available_frames: Option<u64>,
    pub max_capacity: Option<u64>,
}

struct Token {
    text: String,
    raw: [u8; 8],
    verified: Instant,
}

pub struct Client {
    base: String,
    agent: ureq::Agent,
    token: Mutex<Option<Token>>,
}

fn code_ok(value: &Value) -> Result<()> {
    match value.get("code").and_then(Value::as_u64) {
        Some(1000) | None => Ok(()),
        Some(code) => Err(format!("device answered with code {code}")),
    }
}

impl Client {
    pub fn new(ip: &str) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(4)))
            .http_status_as_error(false)
            .build()
            .new_agent();
        Self {
            base: format!("http://{ip}/xled/v1"),
            agent,
            token: Mutex::new(None),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.base)
    }

    fn read<T: DeserializeOwned>(
        response: std::result::Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<(u16, T)> {
        let mut response = response.map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .read_to_string()
            .map_err(|e| e.to_string())?;
        if status == 401 {
            return Err("401 unauthorized".into());
        }
        if !(200..300).contains(&status) {
            return Err(format!("HTTP {status}: {}", body.trim()));
        }
        serde_json::from_str(&body)
            .map(|v| (status, v))
            .map_err(|e| format!("{e}: {}", body.trim()))
    }

    /// Unauthenticated device information.
    pub fn gestalt(&self) -> Result<Gestalt> {
        Self::read(self.agent.get(self.url("gestalt")).call()).map(|(_, v)| v)
    }

    pub fn firmware(&self) -> Result<String> {
        let (_, v): (_, Value) = Self::read(self.agent.get(self.url("fw/version")).call())?;
        v["version"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "no firmware version".into())
    }

    fn login(&self) -> Result<Token> {
        let challenge = STANDARD.encode(rand::random::<[u8; 32]>());
        let (_, v): (_, Value) = Self::read(
            self.agent
                .post(self.url("login"))
                .send_json(json!({ "challenge": challenge })),
        )?;
        let text = v["authentication_token"]
            .as_str()
            .ok_or("login returned no token")?
            .to_string();
        let raw: [u8; 8] = STANDARD
            .decode(&text)
            .map_err(|e| e.to_string())?
            .try_into()
            .map_err(|_| "token is not 8 bytes".to_string())?;
        let (_, v): (_, Value) = Self::read(
            self.agent
                .post(self.url("verify"))
                .header("X-Auth-Token", &text)
                .send_json(json!({})),
        )?;
        code_ok(&v)?;
        Ok(Token {
            text,
            raw,
            verified: Instant::now(),
        })
    }

    /// A verified token, logging in again when needed.
    fn token(&self) -> Result<(String, [u8; 8])> {
        let mut guard = self.token.lock().map_err(|e| e.to_string())?;
        if let Some(token) = guard.as_mut() {
            if token.verified.elapsed() < VERIFY_EVERY {
                return Ok((token.text.clone(), token.raw));
            }
            let verified = Self::read::<Value>(
                self.agent
                    .post(self.url("verify"))
                    .header("X-Auth-Token", &token.text)
                    .send_json(json!({})),
            )
            .and_then(|(_, v)| code_ok(&v));
            if verified.is_ok() {
                token.verified = Instant::now();
                return Ok((token.text.clone(), token.raw));
            }
        }
        let token = self.login()?;
        let result = (token.text.clone(), token.raw);
        *guard = Some(token);
        Ok(result)
    }

    /// The raw token used in realtime UDP datagrams.
    pub fn realtime_token(&self) -> Result<[u8; 8]> {
        self.token().map(|(_, raw)| raw)
    }

    pub fn forget_token(&self) {
        if let Ok(mut guard) = self.token.lock() {
            *guard = None;
        }
    }

    /// Authenticated request; retries once with a fresh token on 401.
    fn call<T: DeserializeOwned>(
        &self,
        method: &str,
        path: &str,
        body: Option<Body<'_>>,
    ) -> Result<T> {
        for attempt in 0..2 {
            let (token, _) = self.token()?;
            let url = self.url(path);
            let response = match (method, &body) {
                ("GET", _) => self.agent.get(&url).header("X-Auth-Token", &token).call(),
                ("DELETE", _) => self
                    .agent
                    .delete(&url)
                    .header("X-Auth-Token", &token)
                    .call(),
                (_, Some(Body::Json(v))) => self
                    .agent
                    .post(&url)
                    .header("X-Auth-Token", &token)
                    .send_json(v),
                (_, Some(Body::Bytes(b))) => self
                    .agent
                    .post(&url)
                    .header("X-Auth-Token", &token)
                    .header("Content-Type", "application/octet-stream")
                    .send(*b),
                (_, None) => self
                    .agent
                    .post(&url)
                    .header("X-Auth-Token", &token)
                    .send_json(json!({})),
            };
            match Self::read::<Value>(response) {
                Err(e) if e.starts_with("401") && attempt == 0 => self.forget_token(),
                Err(e) => return Err(format!("{method} {path}: {e}")),
                Ok((_, v)) => {
                    code_ok(&v).map_err(|e| format!("{method} {path}: {e}"))?;
                    return serde_json::from_value(v).map_err(|e| format!("{path}: {e}"));
                }
            }
        }
        Err(format!("{method} {path}: unauthorized"))
    }

    pub fn mode(&self) -> Result<String> {
        let v: Value = self.call("GET", "led/mode", None)?;
        v["mode"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| "no mode".into())
    }

    pub fn set_mode(&self, mode: &str) -> Result<()> {
        self.call::<Value>(
            "POST",
            "led/mode",
            Some(Body::Json(json!({ "mode": mode }))),
        )
        .map(|_| ())
    }

    pub fn layout(&self) -> Result<Layout> {
        self.call("GET", "led/layout/full", None)
    }

    /// Hardware brightness, 0–100.
    pub fn set_brightness(&self, value: u8) -> Result<()> {
        self.call::<Value>(
            "POST",
            "led/out/brightness",
            Some(Body::Json(
                json!({ "mode": "enabled", "type": "A", "value": value.min(100) }),
            )),
        )
        .map(|_| ())
    }

    pub fn movies(&self) -> Result<Movies> {
        self.call("GET", "movies", None)
    }

    /// Removes every movie on the device, including ones made in the Twinkly
    /// app. The firmware has no way to delete a single movie.
    pub fn delete_all_movies(&self) -> Result<()> {
        self.call::<Value>("DELETE", "movies", None).map(|_| ())
    }

    /// Uploads a movie (frames in device byte order) and returns its id.
    #[allow(clippy::too_many_arguments)]
    pub fn upload_movie(
        &self,
        name: &str,
        unique_id: &str,
        leds: usize,
        frames: usize,
        fps: u32,
        rgbw: bool,
        data: &[u8],
    ) -> Result<u32> {
        self.call::<Value>(
            "POST",
            "movies/new",
            Some(Body::Json(json!({
                "name": name.chars().take(15).collect::<String>(),
                "unique_id": unique_id,
                "descriptor_type": if rgbw { "rgbw_raw" } else { "rgb_raw" },
                "leds_per_frame": leds,
                "frames_number": frames,
                "fps": fps,
            }))),
        )?;
        self.call::<Value>("POST", "movies/full", Some(Body::Bytes(data)))?;
        self.movies()?
            .movies
            .into_iter()
            .find(|m| m.unique_id.eq_ignore_ascii_case(unique_id))
            .map(|m| m.id)
            .ok_or_else(|| "uploaded movie is missing from the device's list".into())
    }

    pub fn play_movie(&self, id: u32) -> Result<()> {
        self.call::<Value>(
            "POST",
            "movies/current",
            Some(Body::Json(json!({ "id": id }))),
        )?;
        self.set_mode("movie")
    }
}

enum Body<'a> {
    Json(Value),
    Bytes(&'a [u8]),
}
