//! Effects and transitions that ship with the app (`js/effects`,
//! `js/transitions`), embedded by `build.rs`.

const ALL: &[(&str, &str, bool)] = include!(concat!(env!("OUT_DIR"), "/builtin.rs"));

/// Every built-in script as (id, source, is_transition).
pub fn all() -> impl Iterator<Item = (&'static str, &'static str, bool)> {
    ALL.iter().copied()
}

pub fn source(id: &str) -> Option<&'static str> {
    all().find(|(i, _, _)| *i == id).map(|(_, s, _)| s)
}
