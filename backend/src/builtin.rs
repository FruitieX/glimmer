//! Effects and transitions that ship with the app (`js/effects`, `js/transitions`).

const EFFECTS: &[(&str, &str)] = &[
    ("aurora", include_str!("../js/effects/aurora.js")),
    ("breathe", include_str!("../js/effects/breathe.js")),
    ("candle", include_str!("../js/effects/candle.js")),
    ("comets", include_str!("../js/effects/comets.js")),
    ("fire", include_str!("../js/effects/fire.js")),
    ("gradient", include_str!("../js/effects/gradient.js")),
    ("plasma", include_str!("../js/effects/plasma.js")),
    ("rainbow", include_str!("../js/effects/rainbow.js")),
    ("ripple", include_str!("../js/effects/ripple.js")),
    ("snowfall", include_str!("../js/effects/snowfall.js")),
    ("solid", include_str!("../js/effects/solid.js")),
    ("twinkle", include_str!("../js/effects/twinkle.js")),
];

const TRANSITIONS: &[(&str, &str)] = &[
    ("dip", include_str!("../js/transitions/dip.js")),
    ("dissolve", include_str!("../js/transitions/dissolve.js")),
    ("fade", include_str!("../js/transitions/fade.js")),
    ("radial", include_str!("../js/transitions/radial.js")),
    ("sparkle", include_str!("../js/transitions/sparkle.js")),
    ("wipe", include_str!("../js/transitions/wipe.js")),
];

/// Every built-in script as (id, source, is_transition).
pub fn all() -> impl Iterator<Item = (&'static str, &'static str, bool)> {
    EFFECTS
        .iter()
        .map(|(id, s)| (*id, *s, false))
        .chain(TRANSITIONS.iter().map(|(id, s)| (*id, *s, true)))
}

pub fn source(id: &str) -> Option<&'static str> {
    all().find(|(i, _, _)| *i == id).map(|(_, s, _)| s)
}
