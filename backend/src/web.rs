//! HTTP server: sessions, Pocket ID sign-in, the guard middleware and the router.

use crate::{api, app::App, db, oidc, ws};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Query, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rand::{TryRng, rngs::SysRng};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc};
use tower_http::services::{ServeDir, ServeFile};

pub const SESSION_COOKIE: &str = "glimmer_session";
/// Sessions last a year and renew themselves while in use.
const SESSION_SECONDS: i64 = 365 * 86400;

#[derive(Clone)]
pub struct Server {
    pub app: Arc<App>,
    pub origin: Arc<String>,
    pub oidc: Option<Arc<oidc::Oidc>>,
    /// Local development: `/auth/dev` signs in without a provider.
    pub dev_login: bool,
    csp: Arc<String>,
}

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);
pub type Result<T> = std::result::Result<T, ApiError>;

impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    pub fn unauthorized() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "Please sign in to continue.".into(),
        )
    }
    pub fn not_found(what: &str) -> Self {
        Self(StatusCode::NOT_FOUND, format!("{what} was not found."))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if self.0.is_server_error() {
            tracing::error!("{}", self.1);
        }
        (self.0, Json(json!({ "message": self.1 }))).into_response()
    }
}

impl From<String> for ApiError {
    fn from(value: String) -> Self {
        Self::bad(value)
    }
}

pub fn token() -> String {
    let mut bytes = [0u8; 32];
    SysRng
        .try_fill_bytes(&mut bytes)
        .expect("operating system random number generator failed");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn digest(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .map(str::trim)
                .find_map(|c| c.strip_prefix(name)?.strip_prefix('='))
        })
}

impl Server {
    fn secure(&self) -> &'static str {
        if self.origin.starts_with("https://") {
            "; Secure"
        } else {
            ""
        }
    }

    fn session_cookie(&self, raw: &str, max_age: i64) -> HeaderValue {
        format!(
            "{SESSION_COOKIE}={raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}",
            self.secure()
        )
        .parse()
        .expect("valid cookie")
    }

    /// The signed-in user's display name, and a renewed cookie when the session was extended.
    pub fn session(&self, headers: &HeaderMap) -> Result<(String, Option<HeaderValue>)> {
        let raw = cookie(headers, SESSION_COOKIE)
            .filter(|s| s.len() == 64)
            .ok_or_else(ApiError::unauthorized)?;
        let now = db::now();
        let db = self.app.db()?;
        let (name, expires): (String, i64) = db
            .query_row(
                "SELECT u.name, s.expires FROM sessions s JOIN users u ON u.sub=s.sub
                 WHERE s.hash=?1 AND s.expires>?2",
                params![digest(raw), now],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(ApiError::unauthorized)?;
        // Renew at most daily.
        if expires < now + SESSION_SECONDS - 86400 {
            db.execute(
                "UPDATE sessions SET expires=?1 WHERE hash=?2",
                params![now + SESSION_SECONDS, digest(raw)],
            )
            .map_err(|e| e.to_string())?;
            return Ok((name, Some(self.session_cookie(raw, SESSION_SECONDS))));
        }
        Ok((name, None))
    }

    pub fn user(&self, headers: &HeaderMap) -> Result<String> {
        self.session(headers).map(|(name, _)| name)
    }

    fn create_session(&self, sub: &str, username: &str, name: &str) -> Result<HeaderValue> {
        let raw = token();
        let now = db::now();
        let db = self.app.db()?;
        db.execute(
            "INSERT INTO users(sub,username,name,created) VALUES(?1,?2,?3,?4)
             ON CONFLICT(sub) DO UPDATE SET username=excluded.username, name=excluded.name",
            params![sub, username, name, now],
        )
        .map_err(|e| e.to_string())?;
        db.execute("DELETE FROM sessions WHERE expires<=?1", [now])
            .map_err(|e| e.to_string())?;
        db.execute(
            "INSERT INTO sessions(hash,sub,expires) VALUES(?1,?2,?3)",
            params![digest(&raw), sub, now + SESSION_SECONDS],
        )
        .map_err(|e| e.to_string())?;
        Ok(self.session_cookie(&raw, SESSION_SECONDS))
    }
}

/// The page's CSP; `feedback_hub` is the origin of an injected feedback widget, if any.
fn content_security_policy(feedback_hub: Option<&str>) -> String {
    // Hash of the inline WebGL patch the homelab gateway injects with the feedback
    // widget (`EARLY_PATCH` in homelab's `apps/feedback-hub/widget-injection.lua`).
    const EARLY_PATCH: &str = "'sha256-7Arh+CajVFiRR3s4fb+pZF1SzlEm2jLxki4eJ/fC7Ig='";
    let (script, connect) = match feedback_hub {
        Some(hub) => (
            format!("'self' {hub} {EARLY_PATCH}"),
            format!("'self' {hub}"),
        ),
        None => ("'self'".into(), "'self'".into()),
    };
    format!(
        "default-src 'self'; script-src {script}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src {connect}; manifest-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    )
}

async fn guard(State(server): State<Server>, request: Request, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    let is_ws = request
        .headers()
        .get(header::UPGRADE)
        .is_some_and(|v| v.as_bytes().eq_ignore_ascii_case(b"websocket"));
    let unsafe_method = !["GET", "HEAD", "OPTIONS"].contains(&request.method().as_str());
    if (unsafe_method || is_ws) && origin != Some(server.origin.as_str()) {
        return ApiError(
            StatusCode::FORBIDDEN,
            "Open the app at its configured address before making changes.".into(),
        )
        .into_response();
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("referrer-policy", HeaderValue::from_static("same-origin"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    if !headers.contains_key(header::CACHE_CONTROL) {
        headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    }
    if let Ok(csp) = HeaderValue::from_str(&server.csp) {
        headers.insert("content-security-policy", csp);
    }
    response
}

fn redirect(location: &str, cookies: Vec<HeaderValue>) -> Response {
    let mut response = (StatusCode::SEE_OTHER, [(header::LOCATION, location)]).into_response();
    for c in cookies {
        response.headers_mut().append(header::SET_COOKIE, c);
    }
    response
}

fn clear_state_cookie(server: &Server) -> HeaderValue {
    format!(
        "{}=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0{}",
        oidc::STATE_COOKIE,
        server.secure()
    )
    .parse()
    .expect("valid cookie")
}

async fn status(State(server): State<Server>, headers: HeaderMap) -> Response {
    let (user, renewed) = match server.session(&headers) {
        Ok((name, renewed)) => (Some(name), renewed),
        Err(_) => (None, None),
    };
    let mut response = Json(json!({
        "user": user,
        "oidc": server.oidc.is_some(),
        "devLogin": server.dev_login,
    }))
    .into_response();
    if let Some(c) = renewed {
        response.headers_mut().insert(header::SET_COOKIE, c);
    }
    response
}

async fn login(State(server): State<Server>) -> Response {
    let Some(provider) = server.oidc.clone() else {
        return redirect("/?signin=unavailable", vec![]);
    };
    match tokio::task::spawn_blocking(move || provider.start()).await {
        Ok(Ok((url, state))) => {
            let cookie = format!(
                "{}={state}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age={}{}",
                oidc::STATE_COOKIE,
                oidc::STATE_SECONDS,
                server.secure()
            );
            redirect(&url, cookie.parse().into_iter().collect())
        }
        Ok(Err(e)) => {
            tracing::warn!("sign-in could not start: {e}");
            redirect("/?signin=failed", vec![])
        }
        Err(e) => {
            tracing::warn!("sign-in could not start: {e}");
            redirect("/?signin=failed", vec![])
        }
    }
}

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn callback(
    State(server): State<Server>,
    headers: HeaderMap,
    Query(q): Query<Callback>,
) -> Response {
    let Some(provider) = server.oidc.clone() else {
        return redirect("/?signin=unavailable", vec![]);
    };
    let refused = |code: &str, detail: &dyn std::fmt::Display| {
        tracing::warn!("sign-in refused: {detail}");
        redirect(
            &format!("/?signin={code}"),
            vec![clear_state_cookie(&server)],
        )
    };
    if let Some(e) = q.error {
        return refused("failed", &e);
    }
    let (Some(code), Some(state)) = (q.code, q.state) else {
        return refused("failed", &"missing code or state");
    };
    let login = match provider.take_login(&state, cookie(&headers, oidc::STATE_COOKIE)) {
        Ok(l) => l,
        Err(e) => return refused(e.code(), &e),
    };
    let identity = {
        let provider = provider.clone();
        tokio::task::spawn_blocking(move || provider.finish(&login, &code)).await
    };
    match identity {
        Ok(Ok(identity)) => {
            let username = identity
                .username
                .clone()
                .unwrap_or_else(|| identity.sub.clone());
            let name = identity.name.clone().unwrap_or_else(|| username.clone());
            match server.create_session(
                &format!("{}|{}", identity.issuer, identity.sub),
                &username,
                &name,
            ) {
                Ok(session) => redirect("/", vec![clear_state_cookie(&server), session]),
                Err(e) => refused("failed", &e.1),
            }
        }
        Ok(Err(e)) => refused(e.code(), &e),
        Err(e) => refused("failed", &e),
    }
}

async fn dev_login(State(server): State<Server>) -> Response {
    if !server.dev_login {
        return ApiError::not_found("This page").into_response();
    }
    match server.create_session("dev|sam", "sam", "Sam") {
        Ok(c) => redirect("/", vec![c]),
        Err(e) => e.into_response(),
    }
}

async fn logout(State(server): State<Server>, headers: HeaderMap) -> Result<Response> {
    if let Some(raw) = cookie(&headers, SESSION_COOKIE) {
        server
            .app
            .db()?
            .execute("DELETE FROM sessions WHERE hash=?1", [digest(raw)])
            .map_err(|e| e.to_string())?;
    }
    let mut response = Json(json!({})).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, server.session_cookie("", 0));
    Ok(response)
}

async fn ready(State(server): State<Server>) -> Result<Json<Value>> {
    server
        .app
        .db()?
        .query_row("SELECT 1", [], |r| r.get::<_, i64>(0))
        .map_err(|e| ApiError(StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    Ok(Json(json!({ "status": "ok" })))
}

pub fn router(server: Server, static_dir: PathBuf) -> Router {
    let index = static_dir.join("index.html");
    Router::new()
        .route(
            "/api/health",
            get(|| async { Json(json!({ "status": "ok" })) }),
        )
        .route("/api/ready", get(ready))
        .route("/api/auth/status", get(status))
        .route("/api/auth/logout", post(logout))
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/dev", get(dev_login))
        .route("/api/live", get(ws::live))
        .route("/api/preview", get(ws::preview))
        .merge(api::routes())
        .fallback_service(ServeDir::new(&static_dir).fallback(ServeFile::new(index)))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(server.clone(), guard))
        .with_state(server)
}

pub fn server(
    app: Arc<App>,
    origin: String,
    oidc: Option<Arc<oidc::Oidc>>,
    dev_login: bool,
    feedback_hub: Option<&str>,
) -> Server {
    Server {
        app,
        origin: Arc::new(origin),
        oidc,
        dev_login,
        csp: Arc::new(content_security_policy(feedback_hub)),
    }
}
