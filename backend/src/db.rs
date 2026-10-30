//! SQLite storage. Devices, fixtures and presets are JSON documents; scripts
//! keep every saved version.

use crate::{
    builtin,
    model::{Device, Fixture, FixtureState, Preset, ScriptKind, ScriptSource},
    script::{Meta, Scripts},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::Path;

pub type Result<T> = std::result::Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

pub fn open(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(err)?;
    let mode = std::env::var("GLIMMER_SQLITE_JOURNAL_MODE").unwrap_or("WAL".into());
    if !["WAL", "DELETE"].contains(&mode.as_str()) {
        return Err("GLIMMER_SQLITE_JOURNAL_MODE must be WAL or DELETE".into());
    }
    db.pragma_update(None, "journal_mode", &mode).map_err(err)?;
    db.pragma_update(None, "synchronous", "FULL").map_err(err)?;
    db.pragma_update(None, "foreign_keys", "ON").map_err(err)?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(err)?;
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, data TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS fixtures(id TEXT PRIMARY KEY, data TEXT NOT NULL, state TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY, data TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS scripts(
            id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, builtin INTEGER NOT NULL,
            version INTEGER NOT NULL, meta TEXT NOT NULL, updated INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS script_versions(
            script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE, version INTEGER NOT NULL,
            source TEXT NOT NULL, note TEXT NOT NULL, author TEXT NOT NULL, created INTEGER NOT NULL,
            PRIMARY KEY(script_id, version));
         CREATE TABLE IF NOT EXISTS users(sub TEXT PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, sub TEXT NOT NULL, expires INTEGER NOT NULL);",
    )
    .map_err(err)?;
    Ok(db)
}

// ---- Devices and fixtures ----

pub fn devices(db: &Connection) -> Result<Vec<Device>> {
    let mut stmt = db
        .prepare("SELECT data FROM devices ORDER BY id")
        .map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}

pub fn device(db: &Connection, id: &str) -> Result<Option<Device>> {
    db.query_row("SELECT data FROM devices WHERE id=?1", [id], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(err)?
    .map(|d| serde_json::from_str(&d).map_err(err))
    .transpose()
}

pub fn save_device(db: &Connection, d: &Device) -> Result<()> {
    db.execute(
        "INSERT INTO devices(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![d.id, serde_json::to_string(d).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

pub fn delete_device(db: &Connection, id: &str) -> Result<()> {
    for f in fixtures(db)?.iter().filter(|f| f.0.device_id == id) {
        delete_fixture(db, &f.0.id)?;
    }
    db.execute("DELETE FROM devices WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}

pub fn fixtures(db: &Connection) -> Result<Vec<(Fixture, FixtureState)>> {
    let mut stmt = db
        .prepare("SELECT data, state FROM fixtures")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?;
    let mut out: Vec<(Fixture, FixtureState)> = rows
        .map(|r| {
            let (f, s) = r.map_err(err)?;
            Ok((
                serde_json::from_str(&f).map_err(err)?,
                serde_json::from_str(&s).map_err(err)?,
            ))
        })
        .collect::<Result<_>>()?;
    out.sort_by(|a, b| (a.0.sort, &a.0.name).cmp(&(b.0.sort, &b.0.name)));
    Ok(out)
}

pub fn fixture(db: &Connection, id: &str) -> Result<Option<(Fixture, FixtureState)>> {
    Ok(fixtures(db)?.into_iter().find(|f| f.0.id == id))
}

pub fn save_fixture(db: &Connection, f: &Fixture, state: &FixtureState) -> Result<()> {
    db.execute(
        "INSERT INTO fixtures(id,data,state) VALUES(?1,?2,?3)
         ON CONFLICT(id) DO UPDATE SET data=excluded.data, state=excluded.state",
        params![
            f.id,
            serde_json::to_string(f).map_err(err)?,
            serde_json::to_string(state).map_err(err)?
        ],
    )
    .map_err(err)?;
    Ok(())
}

pub fn save_state(db: &Connection, id: &str, state: &FixtureState) -> Result<()> {
    db.execute(
        "UPDATE fixtures SET state=?2 WHERE id=?1",
        params![id, serde_json::to_string(state).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

pub fn delete_fixture(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM fixtures WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}

// ---- Presets ----

pub fn presets(db: &Connection) -> Result<Vec<Preset>> {
    let mut stmt = db.prepare("SELECT data FROM presets").map_err(err)?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    let mut out: Vec<Preset> = rows
        .map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect::<Result<_>>()?;
    out.sort_by(|a, b| (a.sort, &a.name).cmp(&(b.sort, &b.name)));
    Ok(out)
}

pub fn save_preset(db: &Connection, p: &Preset) -> Result<()> {
    db.execute(
        "INSERT INTO presets(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![p.id, serde_json::to_string(p).map_err(err)?],
    )
    .map_err(err)?;
    Ok(())
}

pub fn delete_preset(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM presets WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}

// ---- Scripts ----

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptInfo {
    pub id: String,
    pub kind: ScriptKind,
    pub name: String,
    pub builtin: bool,
    pub version: i64,
    pub meta: Meta,
    pub updated: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub version: i64,
    pub note: String,
    pub author: String,
    pub created: i64,
}

fn kind_str(kind: ScriptKind) -> &'static str {
    match kind {
        ScriptKind::Effect => "effect",
        ScriptKind::Transition => "transition",
    }
}

fn parse_kind(s: &str) -> ScriptKind {
    if s == "transition" {
        ScriptKind::Transition
    } else {
        ScriptKind::Effect
    }
}

pub fn scripts(db: &Connection) -> Result<Vec<ScriptInfo>> {
    let mut stmt = db
        .prepare("SELECT id,kind,name,builtin,version,meta,updated FROM scripts ORDER BY builtin DESC, name")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(err)?;
    rows.map(|r| {
        let (id, kind, name, builtin, version, meta, updated) = r.map_err(err)?;
        Ok(ScriptInfo {
            id,
            kind: parse_kind(&kind),
            name,
            builtin,
            version,
            meta: serde_json::from_str(&meta).unwrap_or_default(),
            updated,
        })
    })
    .collect()
}

pub fn script(db: &Connection, id: &str) -> Result<Option<ScriptInfo>> {
    Ok(scripts(db)?.into_iter().find(|s| s.id == id))
}

/// The current version of a script, or a specific one.
pub fn script_source(
    db: &Connection,
    id: &str,
    version: Option<i64>,
) -> Result<Option<ScriptSource>> {
    db.query_row(
        "SELECT s.kind, v.version, v.source FROM scripts s JOIN script_versions v ON v.script_id=s.id
         WHERE s.id=?1 AND v.version=COALESCE(?2, s.version)",
        params![id, version],
        |r| {
            Ok(ScriptSource {
                id: id.to_string(),
                kind: parse_kind(&r.get::<_, String>(0)?),
                version: r.get(1)?,
                source: r.get(2)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

pub fn script_versions(db: &Connection, id: &str) -> Result<Vec<VersionInfo>> {
    let mut stmt = db
        .prepare("SELECT version,note,author,created FROM script_versions WHERE script_id=?1 ORDER BY version DESC")
        .map_err(err)?;
    let rows = stmt
        .query_map([id], |r| {
            Ok(VersionInfo {
                version: r.get(0)?,
                note: r.get(1)?,
                author: r.get(2)?,
                created: r.get(3)?,
            })
        })
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}

/// Checks and stores a new version (creating the script if needed).
#[allow(clippy::too_many_arguments)]
pub fn save_script(
    db: &Connection,
    id: &str,
    kind: ScriptKind,
    source: &str,
    note: &str,
    author: &str,
    builtin: bool,
) -> Result<ScriptInfo> {
    let (meta, _) = Scripts::check(source, kind == ScriptKind::Transition)?;
    let name = if meta.name.trim().is_empty() {
        id.to_string()
    } else {
        meta.name.clone()
    };
    let existing = script(db, id)?;
    if let Some(e) = &existing
        && e.kind != kind
    {
        return Err(format!("{id} is a {}", kind_str(e.kind)));
    }
    let version = existing.as_ref().map_or(1, |e| e.version + 1);
    let now = now();
    let meta_json = serde_json::to_string(&meta).map_err(err)?;
    db.execute(
        "INSERT INTO scripts(id,kind,name,builtin,version,meta,updated) VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, meta=excluded.meta, updated=excluded.updated",
        params![id, kind_str(kind), name, builtin, version, meta_json, now],
    )
    .map_err(err)?;
    db.execute(
        "INSERT INTO script_versions(script_id,version,source,note,author,created) VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, version, source, note, author, now],
    )
    .map_err(err)?;
    script(db, id)?.ok_or_else(|| "saved script is missing".into())
}

pub fn delete_script(db: &Connection, id: &str) -> Result<()> {
    db.execute("DELETE FROM scripts WHERE id=?1 AND builtin=0", [id])
        .map_err(err)?;
    Ok(())
}

/// Adds built-in scripts, and a new version when the app's copy changed.
pub fn sync_builtins(db: &Connection) -> Result<()> {
    for (id, source, transition) in builtin::all() {
        let kind = if transition {
            ScriptKind::Transition
        } else {
            ScriptKind::Effect
        };
        let current = script_source(db, id, None)?;
        if current.as_ref().is_some_and(|c| c.source == source) {
            continue;
        }
        let note = if current.is_some() {
            "Updated with the app"
        } else {
            "Built in"
        };
        save_script(db, id, kind, source, note, "app", true).map_err(|e| format!("{id}: {e}"))?;
    }
    Ok(())
}

/// A free id for a new script, derived from its name.
pub fn new_script_id(db: &Connection, name: &str) -> Result<String> {
    let base = crate::model::slug(name);
    let base = if base.is_empty() {
        "effect".into()
    } else {
        base
    };
    let mut id = base.clone();
    let mut n = 2;
    while script(db, &id)?.is_some() {
        id = format!("{base}-{n}");
        n += 1;
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_are_versioned_and_builtins_sync_once() {
        let dir = tempfile::tempdir().unwrap();
        let db = open(&dir.path().join("t.sqlite3")).unwrap();
        sync_builtins(&db).unwrap();
        sync_builtins(&db).unwrap();
        let solid = script(&db, "solid").unwrap().unwrap();
        assert!(solid.builtin);
        assert_eq!(solid.version, 1);
        let src = "export const meta = {name: 'Mine'}; export function render(ctx) {}";
        let id = new_script_id(&db, "Solid").unwrap();
        assert_eq!(id, "solid-2");
        save_script(&db, &id, ScriptKind::Effect, src, "first", "sam", false).unwrap();
        let v2 = save_script(&db, &id, ScriptKind::Effect, src, "second", "sam", false).unwrap();
        assert_eq!((v2.version, v2.name.as_str()), (2, "Mine"));
        assert_eq!(script_versions(&db, &id).unwrap().len(), 2);
        assert_eq!(
            script_source(&db, &id, Some(1)).unwrap().unwrap().version,
            1
        );
        assert!(save_script(&db, &id, ScriptKind::Effect, "nope(", "bad", "sam", false).is_err());
        assert!(save_script(&db, &id, ScriptKind::Transition, src, "x", "sam", false).is_err());
        delete_script(&db, "solid").unwrap();
        assert!(script(&db, "solid").unwrap().is_some(), "built-ins stay");
        delete_script(&db, &id).unwrap();
        assert!(script_source(&db, &id, None).unwrap().is_none());
    }
}
