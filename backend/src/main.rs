mod ai;
mod api;
mod app;
mod builtin;
mod color;
mod db;
mod device;
mod engine;
mod layout;
mod model;
mod mqtt;
mod oidc;
mod script;
mod web;
mod ws;

use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

/// `twinkly probe <ip> [seconds] [fps]`: streams a test pattern and reports timing.
fn probe(ip: &str, seconds: f64, fps: f64) -> Result<(), String> {
    let client = device::Client::new(ip);
    let gestalt = client.gestalt()?;
    println!("{gestalt:?} fw {}", client.firmware()?);
    let before = client.mode()?;
    println!("mode before: {before}");
    let n = gestalt.number_of_led;
    let bpl = gestalt.bytes_per_led();
    let sender = device::rt::Sender::new(ip).map_err(|e| e.to_string())?;
    let token = client.realtime_token()?;
    client.set_mode("rt")?;
    let start = Instant::now();
    let period = Duration::from_secs_f64(1.0 / fps);
    let mut next = start;
    let mut frames = 0;
    let mut worst = Duration::ZERO;
    while start.elapsed().as_secs_f64() < seconds {
        let t = start.elapsed().as_secs_f64();
        let mut frame = vec![0u8; n * bpl];
        for i in 0..n {
            let phase = (i as f64 / 20.0 - t * 2.0).sin() * 0.5 + 0.5;
            let px = &mut frame[i * bpl..(i + 1) * bpl];
            let (r, g, b) = ((phase * 120.0) as u8, 0, ((1.0 - phase) * 120.0) as u8);
            if bpl == 4 {
                px.copy_from_slice(&[0, r, g, b]);
            } else {
                px.copy_from_slice(&[r, g, b]);
            }
        }
        sender.send(&token, &frame).map_err(|e| e.to_string())?;
        frames += 1;
        next += period;
        let now = Instant::now();
        if now > next {
            worst = worst.max(now - next);
            next = now;
        } else {
            std::thread::sleep(next - now);
        }
    }
    println!(
        "sent {frames} frames in {:.2}s ({:.1} fps), worst lateness {worst:?}",
        start.elapsed().as_secs_f64(),
        frames as f64 / start.elapsed().as_secs_f64()
    );
    println!("mode while streaming: {}", client.mode()?);
    let stopped = Instant::now();
    for _ in 0..90 {
        let mode = client.mode()?;
        if mode != "rt" {
            println!("left rt after {:?}: now {mode}", stopped.elapsed());
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    if client.mode()? != before {
        client.set_mode(&before)?;
    }
    println!("restored mode: {}", client.mode()?);
    Ok(())
}

fn env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "twinkly=info".into()),
        )
        .init();
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("probe") {
        let ip = args
            .get(2)
            .ok_or("usage: twinkly probe <ip> [seconds] [fps]")?;
        let seconds = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(10.0);
        let fps = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(25.0);
        probe(ip, seconds, fps)?;
        return Ok(());
    }

    let data = PathBuf::from(env("TWINKLY_DATA_DIR").unwrap_or("data".into()));
    std::fs::create_dir_all(&data)?;
    let path = data.join("twinkly.sqlite3");
    let conn = db::open(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    if args.get(1).map(String::as_str) == Some("--backup") {
        let dest = args.get(2).ok_or("Supply a destination for --backup")?;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dest)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        conn.backup("main", dest, None::<fn(rusqlite::backup::Progress)>)?;
        return Ok(());
    }
    db::sync_builtins(&conn)?;

    let origin = env("TWINKLY_ORIGIN").unwrap_or("http://localhost:3110".into());
    let origin = origin.trim_end_matches('/').to_string();
    if !(origin.starts_with("http://") || origin.starts_with("https://")) {
        return Err("TWINKLY_ORIGIN must be an HTTP(S) origin".into());
    }
    let feedback_hub = env("TWINKLY_FEEDBACK_HUB").map(|h| h.trim_end_matches('/').to_string());
    if let Some(hub) = &feedback_hub
        && (!(hub.starts_with("http://") || hub.starts_with("https://"))
            || hub.contains([' ', ';', '\'', '"']))
    {
        return Err("TWINKLY_FEEDBACK_HUB must be an HTTP(S) origin".into());
    }
    let oidc = oidc::OidcConfig::from_env(&origin)?.map(|config| {
        tracing::info!("sign-in through {}", config.issuer);
        Arc::new(oidc::Oidc::new(config))
    });
    let dev_login = env("TWINKLY_DEV_LOGIN").as_deref() == Some("1");
    if dev_login && oidc.is_some() {
        return Err("TWINKLY_DEV_LOGIN can't be combined with OIDC sign-in".into());
    }
    if oidc.is_none() && !dev_login {
        tracing::warn!(
            "no sign-in method configured; set TWINKLY_OIDC_* (or TWINKLY_DEV_LOGIN=1 locally)"
        );
    }

    let ai = ai::Ai::from_env();
    let app = app::App::new(conn, ai);
    if let Some(seed) = env("TWINKLY_SEED") {
        let json = if seed.starts_with('[') {
            seed
        } else {
            std::fs::read_to_string(&seed)?
        };
        app.seed(&json)?;
    }
    app.start()?;
    if let Some(config) = mqtt::Config::from_env() {
        mqtt::spawn(app.clone(), config);
    } else {
        tracing::info!("MQTT is off (set TWINKLY_MQTT_HOST)");
    }

    let server = web::server(
        app.clone(),
        origin,
        oidc,
        dev_login,
        feedback_hub.as_deref(),
    );
    let bind = env("TWINKLY_BIND").unwrap_or("127.0.0.1:3111".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on {bind}");
    let static_dir = PathBuf::from(env("TWINKLY_STATIC_DIR").unwrap_or("dist".into()));
    axum::serve(listener, web::router(server, static_dir))
        .with_graceful_shutdown(async {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("signal handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = term.recv() => {}
            }
        })
        .await?;
    // Stop streaming cleanly; the strings keep their last frame, then return to their own mode.
    tokio::task::spawn_blocking(move || app.engine.shutdown()).await?;
    Ok(())
}
