//! Checks what the AI proposes before anyone sees it: names for presets,
//! looks for an effect, and playlists with new presets. Nothing here saves
//! anything; the UI shows proposals for approval and applies them through
//! the normal endpoints.

use crate::{
    model::{Look, Preset, Season, TransitionSpec},
    script::{EffectLook, Meta, is_hex_color, param_problem},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Longest name the AI may give a preset or look.
pub const NAME_MAX: usize = 30;
/// Most looks one suggestion returns.
pub const LOOKS_MAX: usize = 4;
/// Most entries an AI playlist keeps.
pub const ENTRIES_MAX: usize = 30;

fn same(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// "Preset N" with the lowest N no preset is called.
pub fn next_preset_name(presets: &[Preset]) -> String {
    (1..)
        .map(|n| format!("Preset {n}"))
        .find(|name| !presets.iter().any(|p| same(&p.name, name)))
        .unwrap_or_default()
}

/// `name`, or `name 2`, `name 3`… when another name in `taken` matches
/// (ignoring case). Long names are shortened to make room for the number.
pub fn unique_name<'a>(name: &str, taken: impl IntoIterator<Item = &'a str> + Clone) -> String {
    let free = |n: &str| !taken.clone().into_iter().any(|t| same(t, n));
    if free(name) {
        return name.to_string();
    }
    for n in 2.. {
        let suffix = format!(" {n}");
        let room = NAME_MAX.saturating_sub(suffix.len()).max(1);
        let base: String = name.chars().take(room).collect();
        let candidate = format!("{}{suffix}", base.trim_end());
        if free(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

/// Tidies a name the AI wrote: its first line, without quotes, markup or
/// a closing full stop. 1–[`NAME_MAX`] characters, or an error.
pub fn clean_name(raw: &str) -> Result<String, String> {
    let line = raw.trim().lines().next().unwrap_or("");
    let trimmed = line
        .trim()
        .trim_matches(|c: char| "\"'`*_“”‘’".contains(c) || c.is_whitespace())
        .trim_end_matches('.')
        .trim();
    let name = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = name.chars().count();
    if count == 0 {
        return Err("the AI gave no name".into());
    }
    if count > NAME_MAX {
        return Err(format!(
            "the AI's name {name:?} is longer than {NAME_MAX} characters"
        ));
    }
    if name.chars().any(char::is_control) {
        return Err("the AI's name has control characters".into());
    }
    Ok(name)
}

/// Params that suit `meta`: unknown ones and values that aren't allowed
/// are left out, and numbers are kept within their range.
pub fn fit_params(meta: &Meta, params: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (key, value) in params {
        let Some(param) = meta.params.get(key) else {
            continue;
        };
        let mut value = value.clone();
        if let Some(v) = value.as_f64() {
            let min = param.get("min").and_then(Value::as_f64).unwrap_or(f64::MIN);
            let max = param.get("max").and_then(Value::as_f64).unwrap_or(f64::MAX);
            if v < min || v > max {
                value = serde_json::json!(v.clamp(min, max));
            }
        }
        if param_problem(param, &value).is_none() {
            out.insert(key.clone(), value);
        }
    }
    out
}

/// Fits a proposed look to an effect: its params as [`fit_params`], one
/// `#rrggbb` colour per slot (missing or broken ones from `fallback`, then
/// the slot's default) and a clean name. Then checks it as the effect's own
/// looks are checked.
pub fn fit_look(meta: &Meta, look: &EffectLook, fallback: &[String]) -> Result<EffectLook, String> {
    let name = clean_name(&look.name)?;
    let colors = meta
        .colors
        .iter()
        .enumerate()
        .map(|(i, slot)| {
            [look.colors.get(i), fallback.get(i), Some(&slot.default)]
                .into_iter()
                .flatten()
                .map(|c| c.trim().to_ascii_lowercase())
                .find(|c| is_hex_color(c))
                .unwrap_or_else(|| "#ffffff".into())
        })
        .collect();
    let fitted = EffectLook {
        name,
        params: fit_params(meta, &look.params),
        colors,
    };
    meta.look_fits(&fitted)?;
    Ok(fitted)
}

/// Up to [`LOOKS_MAX`] proposed looks that fit, named apart from each
/// other and from the presets; an error naming the problems when none do.
pub fn fit_looks(
    meta: &Meta,
    proposed: &[EffectLook],
    fallback: &[String],
    presets: &[Preset],
) -> Result<Vec<EffectLook>, String> {
    let mut problems = vec![];
    let mut looks: Vec<EffectLook> = vec![];
    for look in proposed {
        match fit_look(meta, look, fallback) {
            Ok(mut look) => {
                let taken: Vec<&str> = presets
                    .iter()
                    .map(|p| p.name.as_str())
                    .chain(looks.iter().map(|l| l.name.as_str()))
                    .collect();
                look.name = unique_name(&look.name, taken.iter().copied());
                looks.push(look);
            }
            Err(e) => problems.push(format!("{:?}: {e}", look.name)),
        }
        if looks.len() == LOOKS_MAX {
            break;
        }
    }
    if looks.is_empty() {
        return Err(if problems.is_empty() {
            "the AI proposed no looks".into()
        } else {
            format!("none of the AI's looks fit: {}", problems.join("; "))
        });
    }
    Ok(looks)
}

/// A playlist as the AI writes it, read leniently.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawPlaylist {
    pub name: String,
    pub shuffle: Option<bool>,
    pub season: Option<Value>,
    pub transitions: Vec<Value>,
    pub entries: Vec<Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawEntry {
    script_id: String,
    duration_s: Option<f64>,
    preset_id: Option<String>,
    look: Option<String>,
    preset: Option<Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RawTransition {
    script_id: String,
    duration_ms: Option<f64>,
    params: Map<String, Value>,
}

/// What exists, for checking a proposed playlist.
pub struct Catalog {
    /// Effect ids and what they declare.
    pub effects: Vec<(String, Meta)>,
    pub transitions: Vec<(String, Meta)>,
    pub presets: Vec<Preset>,
    pub playlist_names: Vec<String>,
}

/// A checked AI playlist, shown for approval. Entries carry their look's
/// params and colours, so an entry still works when its new preset isn't
/// approved.
#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistProposal {
    pub name: String,
    pub shuffle: bool,
    pub season: Option<Season>,
    pub transitions: Vec<TransitionSpec>,
    pub entries: Vec<ProposedEntry>,
    pub new_presets: Vec<NewPreset>,
    /// What was left out or changed, in words.
    pub notes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProposedEntry {
    pub script_id: String,
    pub duration_s: f64,
    /// An existing preset.
    pub preset_id: Option<String>,
    /// One of the effect's built-in looks, by name.
    pub look: Option<String>,
    /// Index into `new_presets`.
    pub new_preset: Option<usize>,
    pub params: Map<String, Value>,
    pub colors: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewPreset {
    pub name: String,
    pub look: Look,
}

fn defaults(meta: &Meta) -> Vec<String> {
    meta.colors
        .iter()
        .map(|c| c.default.to_ascii_lowercase())
        .collect()
}

/// Checks a proposed playlist against what exists. Entries naming effects,
/// presets or looks that don't exist are left out or fall back to the
/// effect's defaults (with a note); an error only when no entry is left.
pub fn check_playlist(raw: RawPlaylist, catalog: &Catalog) -> Result<PlaylistProposal, String> {
    let mut notes = vec![];
    let mut entries = vec![];
    let mut new_presets: Vec<NewPreset> = vec![];
    for value in raw.entries.into_iter().take(ENTRIES_MAX) {
        let Ok(raw) = serde_json::from_value::<RawEntry>(value) else {
            notes.push("Left out an entry the AI wrote wrongly.".into());
            continue;
        };
        let Some((script_id, meta)) = catalog.effects.iter().find(|(id, _)| *id == raw.script_id)
        else {
            notes.push(format!(
                "Left out {:?}: there is no such effect.",
                raw.script_id
            ));
            continue;
        };
        let mut entry = ProposedEntry {
            script_id: script_id.clone(),
            duration_s: raw.duration_s.unwrap_or(120.0).clamp(5.0, 86_400.0).round(),
            preset_id: None,
            look: None,
            new_preset: None,
            params: Map::new(),
            colors: defaults(meta),
        };
        if let Some(id) = raw.preset_id.filter(|p| !p.is_empty()) {
            match catalog.presets.iter().find(|p| p.id == id) {
                Some(p) if p.look.script_id == *script_id => {
                    entry.preset_id = Some(p.id.clone());
                    entry.params = p.look.params.as_object().cloned().unwrap_or_default();
                    entry.colors = p.look.colors.clone();
                }
                _ => notes.push(format!(
                    "{}: there is no preset {id:?} for it, so it plays its defaults.",
                    meta.name
                )),
            }
        } else if let Some(preset) = raw.preset {
            let look = serde_json::from_value::<EffectLook>(preset)
                .map_err(|e| e.to_string())
                .and_then(|l| fit_look(meta, &l, &defaults(meta)));
            match look {
                Ok(look) => {
                    let taken: Vec<&str> = catalog
                        .presets
                        .iter()
                        .map(|p| p.name.as_str())
                        .chain(new_presets.iter().map(|p| p.name.as_str()))
                        .collect();
                    let name = unique_name(&look.name, taken.iter().copied());
                    entry.params = look.params.clone();
                    entry.colors = look.colors.clone();
                    entry.new_preset = Some(new_presets.len());
                    new_presets.push(NewPreset {
                        name,
                        look: Look {
                            script_id: script_id.clone(),
                            params: Value::Object(look.params),
                            colors: look.colors,
                        },
                    });
                }
                Err(e) => notes.push(format!(
                    "{}: its new preset didn't fit ({e}), so it plays its defaults.",
                    meta.name
                )),
            }
        } else if let Some(name) = raw.look.filter(|l| !l.is_empty() && !same(l, "Default")) {
            match meta.looks.iter().find(|l| same(&l.name, &name)) {
                Some(look) => {
                    entry.look = Some(look.name.clone());
                    entry.params = look.params.clone();
                    entry.colors = look.colors.clone();
                }
                None => notes.push(format!(
                    "{} has no look {name:?}, so it plays its defaults.",
                    meta.name
                )),
            }
        }
        entries.push(entry);
    }
    if entries.is_empty() {
        return Err("the AI's playlist had no effects that exist".into());
    }
    let mut transitions = vec![];
    for value in raw.transitions {
        let raw = serde_json::from_value::<RawTransition>(value).unwrap_or_default();
        match catalog
            .transitions
            .iter()
            .find(|(id, _)| *id == raw.script_id)
        {
            Some((id, meta)) => transitions.push(TransitionSpec::new(
                id,
                raw.duration_ms.unwrap_or(1500.0).clamp(200.0, 10_000.0) as u32,
                Value::Object(fit_params(meta, &raw.params)),
            )),
            None => notes.push(format!(
                "Left out the transition {:?}: there is no such transition.",
                raw.script_id
            )),
        }
    }
    let season =
        raw.season.filter(|s| !s.is_null()).and_then(|s| {
            match serde_json::from_value::<Season>(s.clone())
                .map_err(|e| e.to_string())
                .and_then(|season| season.validate().map(|_| season))
            {
                Ok(season) => Some(season),
                Err(e) => {
                    notes.push(format!("Left out the season {s}: {e}"));
                    None
                }
            }
        });
    let name: String = raw
        .name
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| "\"'`*".contains(c))
        .chars()
        .take(40)
        .collect();
    let name = if name.trim().is_empty() {
        "AI playlist".to_string()
    } else {
        name.trim().to_string()
    };
    let name = unique_name(&name, catalog.playlist_names.iter().map(String::as_str));
    Ok(PlaylistProposal {
        name,
        shuffle: raw.shuffle.unwrap_or(true),
        season,
        transitions,
        entries,
        new_presets,
        notes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta() -> Meta {
        serde_json::from_value(json!({
            "name": "Glow",
            "params": {
                "speed": { "type": "number", "min": 0, "max": 2, "default": 1 },
                "mirror": { "type": "boolean", "default": false },
                "axis": { "type": "select", "options": ["x", "y"], "default": "x" }
            },
            "colors": [{ "id": "a", "default": "#FF0000" }, { "id": "b", "default": "#0000ff" }],
            "looks": [{ "name": "Ice", "params": { "speed": 0.5 }, "colors": ["#aabbff", "#ffffff"] }]
        }))
        .unwrap()
    }

    fn preset(id: &str, name: &str, script: &str) -> Preset {
        Preset {
            id: id.into(),
            name: name.into(),
            look: Look {
                script_id: script.into(),
                params: json!({ "speed": 2 }),
                colors: vec!["#111111".into(), "#222222".into()],
            },
            sort: 0,
        }
    }

    fn look(name: &str, params: Value, colors: &[&str]) -> EffectLook {
        EffectLook {
            name: name.into(),
            params: params.as_object().cloned().unwrap_or_default(),
            colors: colors.iter().map(|c| c.to_string()).collect(),
        }
    }

    #[test]
    fn placeholder_names_take_the_next_free_number() {
        assert_eq!(next_preset_name(&[]), "Preset 1");
        let presets = [
            preset("a", "Party", "glow"),
            preset("b", "preset 1", "glow"),
        ];
        assert_eq!(next_preset_name(&presets), "Preset 2");
        let presets = [preset("a", "Preset 2", "glow")];
        assert_eq!(next_preset_name(&presets), "Preset 1");
    }

    #[test]
    fn names_are_made_unique_and_short() {
        assert_eq!(unique_name("Ember", ["Party"]), "Ember");
        assert_eq!(unique_name("Ember", ["ember", "Ember 2"]), "Ember 3");
        let long = "A very long name of thirty ch";
        let unique = unique_name(long, [long]);
        assert!(unique.chars().count() <= NAME_MAX, "{unique}");
        assert!(unique.ends_with(" 2"));
        assert_eq!(
            clean_name("  \"Ember Glow.\"  \nmore").unwrap(),
            "Ember Glow"
        );
        assert_eq!(clean_name("**Northern   Hush**").unwrap(), "Northern Hush");
        assert!(clean_name("  ").is_err());
        assert!(clean_name(&"x".repeat(31)).is_err());
    }

    #[test]
    fn looks_are_fitted_to_the_effect() {
        let m = meta();
        // Out of range clamps; unknown params and bad options go; missing
        // colours come from the fallback, then the slot default.
        let fitted = fit_look(
            &m,
            &look(
                "Warm",
                json!({ "speed": 9, "pace": 1, "axis": "z", "mirror": true }),
                &["#FFAA00"],
            ),
            &["nope".into()],
        )
        .unwrap();
        assert_eq!(
            Value::Object(fitted.params),
            json!({ "speed": 2.0, "mirror": true })
        );
        assert_eq!(fitted.colors, ["#ffaa00", "#0000ff"]);
        assert!(fit_look(&m, &look("", json!({}), &[]), &[]).is_err());

        let presets = [preset("a", "Warm", "glow")];
        let looks = fit_looks(
            &m,
            &[
                look("Warm", json!({}), &[]),
                look("warm", json!({}), &[]),
                look("", json!({}), &[]),
                look("C", json!({}), &[]),
                look("D", json!({}), &[]),
                look("E", json!({}), &[]),
            ],
            &[],
            &presets,
        )
        .unwrap();
        let names: Vec<&str> = looks.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["Warm 2", "warm 3", "C", "D"]);
        assert!(fit_looks(&m, &[look("", json!({}), &[])], &[], &[]).is_err());
    }

    fn catalog() -> Catalog {
        let wipe: Meta = serde_json::from_value(json!({
            "name": "Wipe",
            "params": { "direction": { "type": "select", "options": ["up", "down"], "default": "up" } }
        }))
        .unwrap();
        Catalog {
            effects: vec![("glow".into(), meta())],
            transitions: vec![("wipe".into(), wipe)],
            presets: vec![
                preset("cosy", "Cosy", "glow"),
                preset("other", "Autumn", "glow"),
            ],
            playlist_names: vec!["Evening".into()],
        }
    }

    #[test]
    fn playlists_are_checked_against_what_exists() {
        let raw: RawPlaylist = serde_json::from_value(json!({
            "name": "Evening",
            "shuffle": false,
            "season": { "from": "09-01", "to": "11-30" },
            "transitions": [
                { "scriptId": "wipe", "durationMs": 99999, "params": { "direction": "down", "x": 1 } },
                { "scriptId": "nope" }
            ],
            "entries": [
                { "scriptId": "glow", "durationS": 300, "presetId": "cosy" },
                { "scriptId": "glow", "look": "ice" },
                { "scriptId": "glow", "preset": { "name": "Autumn", "params": { "speed": 0.2 }, "colors": ["#aa5500", "#331100"] } },
                { "scriptId": "glow", "preset": { "name": "Autumn", "params": {}, "colors": [] } },
                { "scriptId": "glow", "look": "Missing", "presetId": "" },
                { "scriptId": "missing" },
                7
            ]
        }))
        .unwrap();
        let p = check_playlist(raw, &catalog()).unwrap();
        assert_eq!(p.name, "Evening 2");
        assert!(!p.shuffle);
        assert_eq!(
            p.season,
            Some(Season::Dates {
                from: "09-01".into(),
                to: "11-30".into()
            })
        );
        assert_eq!(p.transitions.len(), 1);
        assert_eq!(p.transitions[0].duration_ms, 10_000);
        assert_eq!(p.transitions[0].params, json!({ "direction": "down" }));
        assert_eq!(p.entries.len(), 5);
        assert_eq!(p.entries[0].preset_id.as_deref(), Some("cosy"));
        assert_eq!(p.entries[0].duration_s, 300.0);
        assert_eq!(p.entries[1].look.as_deref(), Some("Ice"));
        assert_eq!(p.entries[1].colors, ["#aabbff", "#ffffff"]);
        assert_eq!(p.entries[1].duration_s, 120.0);
        assert_eq!(p.entries[2].new_preset, Some(0));
        assert_eq!(p.entries[3].new_preset, Some(1));
        assert_eq!(
            p.entries[4],
            ProposedEntry {
                script_id: "glow".into(),
                duration_s: 120.0,
                preset_id: None,
                look: None,
                new_preset: None,
                params: Map::new(),
                colors: vec!["#ff0000".into(), "#0000ff".into()],
            }
        );
        // New presets get names no preset (or other new preset) has.
        let names: Vec<&str> = p.new_presets.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(names, ["Autumn 2", "Autumn 3"]);
        assert_eq!(p.new_presets[0].look.params, json!({ "speed": 0.2 }));
        assert_eq!(p.new_presets[1].look.colors, ["#ff0000", "#0000ff"]);
        assert_eq!(p.notes.len(), 4, "{:?}", p.notes);

        let empty: RawPlaylist =
            serde_json::from_value(json!({ "entries": [{ "scriptId": "missing" }] })).unwrap();
        assert!(check_playlist(empty, &catalog()).is_err());
        let bad_season: RawPlaylist = serde_json::from_value(json!({
            "season": { "from": "13-40", "to": "01-01" },
            "entries": [{ "scriptId": "glow" }]
        }))
        .unwrap();
        let p = check_playlist(bad_season, &catalog()).unwrap();
        assert_eq!(p.season, None);
        assert_eq!(p.name, "AI playlist");
        assert!(p.shuffle);
    }
}
