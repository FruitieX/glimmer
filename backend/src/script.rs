//! Sandboxed JavaScript effects and transitions, run in QuickJS.
//!
//! Each script is an ES module exporting `meta` and `render(ctx)`; see
//! `docs/effects.md`. A `Scripts` value owns one QuickJS runtime and is used
//! from a single thread. Every call into JavaScript runs under a time budget,
//! so a runaway script raises an error instead of stalling the lights.

use crate::layout::FixtureLayout;
use rquickjs::{Context, Ctx, Function, Module, Object, Runtime, TypedArray, Value};
use serde::{Deserialize, Serialize};
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

pub type Rgb = [f32; 3];

/// An uploaded image or GIF, scaled down to LED-friendly size.
#[derive(Debug)]
pub struct ImageAsset {
    pub width: u32,
    pub height: u32,
    /// RGB bytes per frame.
    pub frames: Vec<Vec<u8>>,
    /// Seconds per frame.
    pub delays: Vec<f32>,
}

pub type ImageLoader = Arc<dyn Fn(&str) -> Option<Arc<ImageAsset>> + Send + Sync>;

/// Where scripts' `image(id)` finds uploaded images; set once at startup.
pub static IMAGES: std::sync::OnceLock<ImageLoader> = std::sync::OnceLock::new();

const PRELUDE: &str = include_str!("../js/prelude.js");

/// What a script declares about itself.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Meta {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub params: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub colors: Vec<ColorSlot>,
    /// Group shown in the app, e.g. "Seasonal".
    #[serde(default)]
    pub category: String,
    /// Rendered at several sub-LED offsets and averaged (stateless effects only).
    #[serde(default)]
    pub antialias: bool,
    /// Whether the script exports `loop(params, colors)`, i.e. can repeat seamlessly.
    #[serde(default)]
    pub loops: bool,
    /// Named looks the effect ships with. Entries that aren't even shaped
    /// like a look are dropped here; [`Meta::look_problems`] checks the rest.
    #[serde(default, deserialize_with = "lenient_looks")]
    pub looks: Vec<EffectLook>,
}

/// A built-in look of an effect: a name, settings that differ from the
/// defaults, and a colour per slot. Not a user preset.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct EffectLook {
    pub name: String,
    #[serde(default)]
    pub params: serde_json::Map<String, serde_json::Value>,
    /// `#rrggbb` per colour slot.
    #[serde(default)]
    pub colors: Vec<String>,
}

fn lenient_looks<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<EffectLook>, D::Error> {
    let raw = Option::<serde_json::Value>::deserialize(d)?;
    Ok(match raw {
        Some(serde_json::Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect(),
        _ => vec![],
    })
}

fn is_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl Meta {
    /// What is wrong with each of `meta.looks`: settings the effect doesn't
    /// have or values it doesn't allow, or the wrong number of colours.
    pub fn look_problems(&self) -> Vec<String> {
        let mut problems = vec![];
        for (i, look) in self.looks.iter().enumerate() {
            let at = format!("meta.looks[{i}] ({:?})", look.name);
            if look.name.trim().is_empty() {
                problems.push(format!("{at} has no name"));
            }
            if self.looks[..i].iter().any(|l| l.name == look.name) {
                problems.push(format!("{at}: another look has the same name"));
            }
            for (key, value) in &look.params {
                let Some(param) = self.params.get(key) else {
                    problems.push(format!("{at}: there is no param {key:?}"));
                    continue;
                };
                if let Some(problem) = param_problem(param, value) {
                    problems.push(format!("{at}: {key} {problem}"));
                }
            }
            if look.colors.len() != self.colors.len() {
                problems.push(format!(
                    "{at} has {} colours, but the effect has {} colour slots",
                    look.colors.len(),
                    self.colors.len()
                ));
            }
            for c in &look.colors {
                if !is_hex_color(c) {
                    problems.push(format!("{at}: {c:?} is not a #rrggbb colour"));
                }
            }
        }
        problems
    }
}

/// Why `value` doesn't suit the param declared as `param`, if it doesn't.
fn param_problem(param: &serde_json::Value, value: &serde_json::Value) -> Option<String> {
    match param.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "number" => {
            let Some(v) = value.as_f64() else {
                return Some(format!("{value} is not a number"));
            };
            if let Some(min) = param.get("min").and_then(|m| m.as_f64())
                && v < min
            {
                return Some(format!("{v} is below its min {min}"));
            }
            if let Some(max) = param.get("max").and_then(|m| m.as_f64())
                && v > max
            {
                return Some(format!("{v} is above its max {max}"));
            }
            None
        }
        "boolean" => (!value.is_boolean()).then(|| format!("{value} is not true or false")),
        "select" => {
            let ok = param
                .get("options")
                .and_then(|o| o.as_array())
                .is_some_and(|o| o.contains(value));
            (!ok).then(|| format!("{value} is not one of its options"))
        }
        _ => None,
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct ColorSlot {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub default: String,
}

pub struct Scripts {
    _rt: Runtime,
    ctx: Context,
    start: Instant,
    /// Microseconds since `start` after which running JavaScript is interrupted.
    deadline: Arc<AtomicU64>,
    pub budget: Duration,
}

fn error_text(ctx: &Ctx<'_>, error: rquickjs::Error) -> String {
    if let rquickjs::Error::Exception = error {
        let value = ctx.catch();
        if let Some(object) = value.as_object() {
            let message: String = object.get("message").unwrap_or_default();
            let stack: String = object.get("stack").unwrap_or_default();
            let line = stack
                .lines()
                .find(|l| l.contains("script:"))
                .map(|l| format!(" ({})", l.trim().trim_start_matches("at ")))
                .unwrap_or_default();
            return format!("{message}{line}");
        }
        if let Some(s) = value.as_string() {
            return s.to_string().unwrap_or_default();
        }
        return format!("{value:?}");
    }
    error.to_string()
}

/// `__loadImage(id)` for the prelude's `image()`: the asset, or null.
fn load_image<'js>(ctx: Ctx<'js>, id: String) -> rquickjs::Result<Value<'js>> {
    let Some(asset) = IMAGES.get().and_then(|load| load(&id)) else {
        return Ok(Value::new_null(ctx));
    };
    let obj = Object::new(ctx.clone())?;
    obj.set("width", asset.width)?;
    obj.set("height", asset.height)?;
    obj.set("delays", asset.delays.clone())?;
    let frames = rquickjs::Array::new(ctx.clone())?;
    for (i, f) in asset.frames.iter().enumerate() {
        frames.set(i, rquickjs::ArrayBuffer::new(ctx.clone(), f.clone())?)?;
    }
    obj.set("frames", frames)?;
    Ok(obj.into_value())
}

fn js_json<'js>(ctx: &Ctx<'js>, value: &impl Serialize) -> rquickjs::Result<Value<'js>> {
    ctx.json_parse(serde_json::to_string(value).unwrap_or_else(|_| "null".into()))
}

impl Scripts {
    pub fn new() -> Result<Self, String> {
        let rt = Runtime::new().map_err(|e| e.to_string())?;
        rt.set_memory_limit(64 * 1024 * 1024);
        rt.set_max_stack_size(1024 * 1024);
        let start = Instant::now();
        let deadline = Arc::new(AtomicU64::new(u64::MAX));
        {
            let deadline = deadline.clone();
            rt.set_interrupt_handler(Some(Box::new(move || {
                start.elapsed().as_micros() as u64 > deadline.load(Ordering::Relaxed)
            })));
        }
        let ctx = Context::full(&rt).map_err(|e| e.to_string())?;
        let scripts = Self {
            _rt: rt,
            ctx,
            start,
            deadline,
            budget: Duration::from_millis(250),
        };
        scripts.run(|ctx| {
            let load = rquickjs::Function::new(ctx.clone(), load_image)?;
            ctx.globals().set("__loadImage", load)?;
            ctx.eval::<(), _>(PRELUDE)
        })?;
        Ok(scripts)
    }

    /// Runs `f` under the time budget, turning JavaScript errors into text.
    fn run<T>(
        &self,
        f: impl for<'js> FnOnce(&Ctx<'js>) -> rquickjs::Result<T>,
    ) -> Result<T, String> {
        self.run_for(self.budget, f)
    }

    fn run_for<T>(
        &self,
        budget: Duration,
        f: impl for<'js> FnOnce(&Ctx<'js>) -> rquickjs::Result<T>,
    ) -> Result<T, String> {
        let until = (self.start.elapsed() + budget).as_micros() as u64;
        self.deadline.store(until, Ordering::Relaxed);
        let result = self
            .ctx
            .with(|ctx| f(&ctx).map_err(|e| error_text(&ctx, e)));
        self.deadline.store(u64::MAX, Ordering::Relaxed);
        result.map_err(|e| {
            if e.contains("interrupted") {
                format!("took longer than {} ms: {e}", budget.as_millis())
            } else {
                e
            }
        })
    }

    fn host<'js>(ctx: &Ctx<'js>, name: &str) -> rquickjs::Result<(Object<'js>, Function<'js>)> {
        let host: Object = ctx.globals().get("__host")?;
        let f: Function = host.get(name)?;
        Ok((host, f))
    }

    /// Compiles a module under a unique `key` and returns what it declares,
    /// leaving out looks that don't fit its params and colour slots.
    pub fn register(&self, key: &str, source: &str) -> Result<Meta, String> {
        let mut meta = self.register_all(key, source)?;
        let looks = std::mem::take(&mut meta.looks);
        for look in looks {
            let alone = Meta {
                looks: vec![look],
                ..meta.clone()
            };
            if alone.look_problems().is_empty() {
                meta.looks.extend(alone.looks);
            }
        }
        for look in &mut meta.looks {
            for c in &mut look.colors {
                *c = c.to_ascii_lowercase();
            }
        }
        Ok(meta)
    }

    /// [`Scripts::register`], keeping every look.
    fn register_all(&self, key: &str, source: &str) -> Result<Meta, String> {
        let json: String = self.run(|ctx| {
            let (module, promise) =
                Module::declare(ctx.clone(), format!("script:{key}"), source)?.eval()?;
            promise.finish::<()>()?;
            let ns = module.namespace()?;
            let (_, register) = Self::host(ctx, "register")?;
            register.call((key, ns))
        })?;
        #[derive(Deserialize)]
        struct Registered {
            meta: Meta,
            loops: bool,
        }
        let registered: Registered = serde_json::from_str(&json)
            .map_err(|e| format!("meta must be a plain object with name/params/colors: {e}"))?;
        Ok(Meta {
            loops: registered.loops,
            ..registered.meta
        })
    }

    pub fn unregister(&self, key: &str) {
        let _ = self.run(|ctx| Self::host(ctx, "unregister")?.1.call::<_, ()>((key,)));
    }

    /// Positions are normalised to 0..1, in LED order; `aspect` is width / height.
    pub fn layout(&self, id: &str, points: &[[f32; 3]], aspect: f32) -> Result<(), String> {
        self.fixture_layout(id, &FixtureLayout::plain(points.to_vec(), aspect))
    }

    /// A fixture's layout: `id` for effects, with its effect size applied,
    /// and [`Scripts::transition_layout`]`(id)` for transitions, which always
    /// cover the whole light.
    pub fn fixture_layout(&self, id: &str, layout: &FixtureLayout) -> Result<(), String> {
        let whole = FixtureLayout {
            scale: 1.0,
            ..layout.clone()
        };
        for (id, l) in [
            (id.to_string(), layout.for_scripts()),
            (Self::transition_layout(id), whole.for_scripts()),
        ] {
            self.run(|ctx| {
                Self::host(ctx, "layout")?
                    .1
                    .call::<_, ()>((id, l.x, l.y, l.z, l.aspect, l.u, l.spacing))
            })?;
        }
        Ok(())
    }

    /// The layout id transitions on fixture layout `id` use.
    pub fn transition_layout(id: &str) -> String {
        format!("{id}/transition")
    }

    pub fn create(
        &self,
        instance: &str,
        key: &str,
        layout: &str,
        params: &serde_json::Value,
        colors: &[Rgb],
    ) -> Result<(), String> {
        // `setup` runs once and may precompute (a transition's sampler, say),
        // so it gets more time than a frame.
        self.run_for(self.budget * 8, |ctx| {
            let p = js_json(ctx, params)?;
            let c = js_json(ctx, &colors)?;
            Self::host(ctx, "create")?
                .1
                .call((instance, key, layout, p, c))
        })
    }

    pub fn update(
        &self,
        instance: &str,
        params: &serde_json::Value,
        colors: &[Rgb],
    ) -> Result<(), String> {
        self.run(|ctx| {
            let p = js_json(ctx, params)?;
            let c = js_json(ctx, &colors)?;
            Self::host(ctx, "update")?.1.call((instance, p, c))
        })
    }

    pub fn drop_instance(&self, instance: &str) {
        let _ = self.run(|ctx| Self::host(ctx, "drop")?.1.call::<_, ()>((instance,)));
    }

    pub fn loop_of(&self, instance: &str) -> Option<f64> {
        self.run(|ctx| {
            Self::host(ctx, "loopOf")?
                .1
                .call::<_, Option<f64>>((instance,))
        })
        .ok()
        .flatten()
    }

    fn copy_out(array: &TypedArray<'_, f32>, out: &mut [f32]) {
        // SAFETY: the array is alive for the duration of this call and nothing
        // else touches the runtime meanwhile.
        let data = unsafe { array.as_slice() };
        for (o, v) in out.iter_mut().zip(data) {
            // Tests see broken values; the lights get black instead.
            *o = if v.is_finite() || cfg!(test) { *v } else { 0.0 };
        }
    }

    pub fn render(&self, instance: &str, t: f64, dt: f64, out: &mut [f32]) -> Result<(), String> {
        self.run(|ctx| {
            let array: TypedArray<f32> = Self::host(ctx, "render")?.1.call((instance, t, dt))?;
            Self::copy_out(&array, out);
            Ok(())
        })
    }

    /// Blends two frames (`None` is black) with a transition instance.
    #[allow(clippy::too_many_arguments)]
    pub fn blend(
        &self,
        instance: &str,
        a: Option<&[f32]>,
        b: Option<&[f32]>,
        progress: f64,
        t: f64,
        dt: f64,
        out: &mut [f32],
    ) -> Result<(), String> {
        self.run(|ctx| {
            let frame = |f: Option<&[f32]>| -> rquickjs::Result<Value<'_>> {
                match f {
                    Some(f) => TypedArray::<f32>::new_copy(ctx.clone(), f).map(|a| a.into_value()),
                    None => Ok(Value::new_null(ctx.clone())),
                }
            };
            let (a, b) = (frame(a)?, frame(b)?);
            let array: TypedArray<f32> = Self::host(ctx, "blend")?.1.call((
                instance,
                a,
                b,
                progress.clamp(0.0, 1.0),
                t,
                dt,
            ))?;
            Self::copy_out(&array, out);
            Ok(())
        })
    }

    /// Checks a script without keeping it: compiles it, renders a few frames
    /// on a small grid, and reports what it declares and how long a frame took.
    pub fn check(source: &str, transition: bool) -> Result<(Meta, Duration), String> {
        let scripts = Scripts::new()?;
        let mut meta = scripts.register_all("check", source)?;
        let problems = meta.look_problems();
        if !problems.is_empty() {
            return Err(problems.join("; "));
        }
        for look in &mut meta.looks {
            for c in &mut look.colors {
                *c = c.to_ascii_lowercase();
            }
        }
        let points: Vec<[f32; 3]> = (0..210)
            .map(|i| [(i / 21) as f32 / 9.0, (i % 21) as f32 / 20.0, 0.0])
            .collect();
        scripts.layout("grid", &points, 1.0)?;
        let colors: Vec<Rgb> = meta
            .colors
            .iter()
            .map(|c| crate::color::parse_hex(&c.default).unwrap_or([1.0, 1.0, 1.0]))
            .collect();
        scripts.create("i", "check", "grid", &serde_json::json!({}), &colors)?;
        let mut out = vec![0.0; points.len() * 3];
        let a: Vec<f32> = (0..out.len()).map(|i| (i % 3) as f32 / 2.0).collect();
        let start = Instant::now();
        for frame in 0..10 {
            let t = frame as f64 / 25.0;
            if transition {
                scripts.blend("i", Some(&a), None, frame as f64 / 9.0, t, 0.04, &mut out)?;
            } else {
                scripts.render("i", t, 0.04, &mut out)?;
            }
        }
        Ok((meta, start.elapsed() / 10))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EFFECT: &str = r##"
        export const meta = {
            name: "Test",
            params: { level: { type: "number", min: 0, max: 1, default: 0.5 } },
            colors: [{ id: "a", label: "A", default: "#ff0000" }],
        };
        export function loop(params) { return 4; }
        export function render(ctx) {
            for (let i = 0; i < ctx.n; i++) ctx.out.set(scale(ctx.colors[0], ctx.params.level * ctx.x[i]), i * 3);
        }
    "##;

    fn scripts() -> Scripts {
        let s = Scripts::new().unwrap();
        s.layout("l", &[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]], 1.0)
            .unwrap();
        s
    }

    #[test]
    fn renders_effects_with_params_and_colors() {
        let s = scripts();
        let meta = s.register("e", EFFECT).unwrap();
        assert_eq!(meta.name, "Test");
        assert!(meta.loops);
        assert_eq!(meta.colors[0].default, "#ff0000");
        s.create("i", "e", "l", &serde_json::json!({}), &[[1.0, 0.0, 0.0]])
            .unwrap();
        let mut out = [9.0; 6];
        s.render("i", 0.0, 0.0, &mut out).unwrap();
        assert_eq!(out, [0.0, 0.0, 0.0, 0.5, 0.0, 0.0]);
        s.update("i", &serde_json::json!({"level": 1}), &[[0.0, 1.0, 0.0]])
            .unwrap();
        s.render("i", 0.0, 0.0, &mut out).unwrap();
        assert_eq!(out, [0.0, 0.0, 0.0, 0.0, 1.0, 0.0]);
        assert_eq!(s.loop_of("i"), Some(4.0));
    }

    #[test]
    fn reports_errors_and_runaway_scripts() {
        let s = scripts();
        let err = s.register("bad", "export const meta = {};").unwrap_err();
        assert!(err.contains("render"), "{err}");
        assert!(s.register("syntax", "export function render( {").is_err());
        s.register(
            "throws",
            "export function render(ctx) { throw new Error('boom'); }",
        )
        .unwrap();
        s.create("t", "throws", "l", &serde_json::json!({}), &[])
            .unwrap();
        let mut out = [0.0; 6];
        assert!(
            s.render("t", 0.0, 0.0, &mut out)
                .unwrap_err()
                .contains("boom")
        );

        let mut s = scripts();
        s.budget = Duration::from_millis(20);
        s.register("spin", "export function render(ctx) { for (;;) {} }")
            .unwrap();
        s.create("s", "spin", "l", &serde_json::json!({}), &[])
            .unwrap();
        let err = s.render("s", 0.0, 0.0, &mut out).unwrap_err();
        assert!(err.contains("longer than"), "{err}");
        // The runtime is still usable afterwards.
        s.register("ok", EFFECT).unwrap();
    }

    #[test]
    fn builtin_scripts_compile_and_render() {
        for (name, source, transition) in crate::builtin::all() {
            let (meta, took) =
                Scripts::check(source, transition).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert!(!meta.name.is_empty(), "{name} has no name");
            // Debug builds on shared CI machines run several times slower.
            let limit = Duration::from_millis(if cfg!(debug_assertions) { 60 } else { 20 });
            assert!(took < limit, "{name} took {took:?}");
        }
    }

    #[test]
    fn looks_must_fit_the_params_and_colour_slots() {
        let source = |looks: &str| {
            format!(
                r##"export const meta = {{
                    name: "Looks",
                    params: {{
                        speed: {{ type: "number", min: 0, max: 2, default: 1 }},
                        mirror: {{ type: "boolean", default: false }},
                        axis: {{ type: "select", options: ["x", "y"], default: "x" }},
                    }},
                    colors: [{{ id: "a", default: "#ff0000" }}, {{ id: "b", default: "#0000ff" }}],
                    looks: {looks},
                }};
                export function render(ctx) {{}}"##
            )
        };
        let good = r##"[{ name: "Ice", params: { speed: 0.5, axis: "y" }, colors: ["#AABBFF", "#ffffff"] }]"##;
        let (meta, _) = Scripts::check(&source(good), false).unwrap();
        assert_eq!(meta.looks.len(), 1);
        assert_eq!(meta.looks[0].colors, vec!["#aabbff", "#ffffff"]);
        for (bad, why) in [
            (
                r##"[{ name: "A", params: { pace: 1 }, colors: ["#000000", "#000000"] }]"##,
                "no param",
            ),
            (
                r##"[{ name: "A", params: { speed: 3 }, colors: ["#000000", "#000000"] }]"##,
                "above its max",
            ),
            (
                r##"[{ name: "A", params: { axis: "z" }, colors: ["#000000", "#000000"] }]"##,
                "options",
            ),
            (
                r##"[{ name: "A", params: { mirror: 1 }, colors: ["#000000", "#000000"] }]"##,
                "true or false",
            ),
            (r##"[{ name: "A", colors: ["#000000"] }]"##, "colour slots"),
            (
                r##"[{ name: "A", colors: ["red", "#000000"] }]"##,
                "#rrggbb",
            ),
            (
                r##"[{ name: "A", colors: ["#000000", "#000000"] }, { name: "A", colors: ["#000000", "#000000"] }]"##,
                "same name",
            ),
        ] {
            let err = Scripts::check(&source(bad), false).unwrap_err();
            assert!(err.contains(why), "{bad}: {err}");
        }
        // Running effects keep the looks that fit and drop the rest, also
        // ones that aren't shaped like looks at all.
        let s = scripts();
        let mixed = format!(
            r##"[{good_one}, {{ name: "Bad", params: {{ speed: 9 }}, colors: ["#000000", "#000000"] }}, 7]"##,
            good_one = &good[1..good.len() - 1]
        );
        let meta = s.register("m", &source(&mixed)).unwrap();
        let names: Vec<&str> = meta.looks.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["Ice"]);
        let meta = s.register("n", &source("\"nope\"")).unwrap();
        assert!(meta.looks.is_empty());
        assert_eq!(meta.colors.len(), 2);
    }

    #[test]
    fn builtin_effects_have_looks() {
        // Effects without colours or settings worth varying.
        const WITHOUT: &[&str] = &[];
        for (name, source, _) in crate::builtin::all().filter(|(_, _, t)| !*t) {
            let (meta, _) = Scripts::check(source, false).unwrap_or_else(|e| panic!("{name}: {e}"));
            if WITHOUT.contains(&name) {
                continue;
            }
            assert!(
                (3..=5).contains(&meta.looks.len()),
                "{name} has {} looks",
                meta.looks.len()
            );
            for look in &meta.looks {
                assert_ne!(
                    look.name, "Default",
                    "{name}: the defaults are already Default"
                );
                let defaults: Vec<String> = meta
                    .colors
                    .iter()
                    .map(|c| c.default.to_ascii_lowercase())
                    .collect();
                let same_params = look
                    .params
                    .iter()
                    .all(|(k, v)| meta.params.get(k).and_then(|p| p.get("default")) == Some(v));
                assert!(
                    !(same_params && look.colors == defaults),
                    "{name}: {} is just the defaults",
                    look.name
                );
            }
        }
    }

    #[test]
    fn builtin_effects_render_at_any_effect_size() {
        let curtain: Vec<[f32; 3]> = (0..210)
            .map(|i| [(i / 21) as f32 / 9.0, (i % 21) as f32 / 20.0, 0.5])
            .collect();
        let strip: Vec<f32> = (0..150).map(|i| i as f32 / 149.0).collect();
        let along = FixtureLayout {
            points: strip.iter().map(|&u| [u, 0.5, 0.5]).collect(),
            aspect: 25.0,
            u: Some(strip.clone()),
            spacing: Some(1.0 / 149.0),
            scale: 1.0,
        };
        for (name, source, _) in crate::builtin::all().filter(|(_, _, t)| !*t) {
            let s = Scripts::new().unwrap();
            let meta = s.register("e", source).unwrap();
            let colors: Vec<Rgb> = meta
                .colors
                .iter()
                .filter_map(|c| crate::color::parse_hex(&c.default))
                .collect();
            for scale in [crate::layout::MIN_SCALE, crate::layout::MAX_SCALE] {
                for (id, base) in [
                    ("curtain", FixtureLayout::plain(curtain.clone(), 0.95)),
                    ("along", along.clone()),
                ] {
                    let l = FixtureLayout { scale, ..base };
                    s.fixture_layout(id, &l).unwrap();
                    s.create(id, "e", id, &serde_json::json!({}), &colors)
                        .unwrap_or_else(|e| panic!("{name}: {e}"));
                    let mut out = vec![0.0; l.points.len() * 3];
                    for f in 0..5 {
                        s.render(id, f as f64 * 0.7, 0.04, &mut out)
                            .unwrap_or_else(|e| panic!("{name} on the {id} at {scale}: {e}"));
                        assert!(
                            out.iter().all(|v| v.is_finite()),
                            "{name} on the {id} at {scale} gives {:?}",
                            out.iter().find(|v| !v.is_finite())
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn fixtures_supply_u_spacing_and_effect_size() {
        let s = Scripts::new().unwrap();
        let l = FixtureLayout {
            points: vec![[1.0, 0.5, 0.5], [0.0, 0.5, 0.5], [0.5, 0.5, 0.5]],
            aspect: 10.0,
            u: Some(vec![1.0, 0.0, 0.5]),
            spacing: Some(0.5),
            scale: 2.0,
        };
        s.fixture_layout("l", &l).unwrap();
        s.register(
            "e",
            r#"
            export function setup(ctx) { return sampler(ctx); }
            export function render(ctx, s) {
                const f = new Float32Array(ctx.n * 3), rgb = [0, 0, 0];
                for (let i = 0; i < ctx.n; i++) f[i * 3] = i / 10;
                for (let i = 0; i < ctx.n; i++) {
                    // Between LEDs 1 (u 0.25) and 2 (u 0.5) along u.
                    s.along(f, 0.375, rgb);
                    ctx.out.set([ctx.u[i], ctx.spacing, i === 0 ? rgb[0] : ctx.x[i]], i * 3);
                }
            }
            "#,
        )
        .unwrap();
        s.create("i", "e", "l", &serde_json::json!({}), &[])
            .unwrap();
        let mut out = [0.0; 9];
        s.render("i", 0.0, 0.0, &mut out).unwrap();
        let want = [0.75, 0.25, 0.15, 0.25, 0.25, 0.25, 0.5, 0.25, 0.5];
        for (o, w) in out.iter().zip(want) {
            assert!((o - w).abs() < 1e-6, "{out:?}");
        }
    }

    #[test]
    fn builtin_transitions_start_at_a_and_end_at_b() {
        let curtain: Vec<[f32; 3]> = (0..210)
            .map(|i| [(i / 21) as f32 / 9.0, (i % 21) as f32 / 20.0, 0.5])
            .collect();
        let strip: Vec<[f32; 3]> = (0..600).map(|i| [i as f32 / 599.0, 0.5, 0.5]).collect();
        // A light laid out along its length, LEDs zigzagging, at double size.
        let zigzag: Vec<f32> = (0..300)
            .map(|i| ((i ^ 1).min(299)) as f32 / 299.0)
            .collect();
        let along = FixtureLayout {
            points: zigzag.iter().map(|&u| [u, 0.5, 0.5]).collect(),
            aspect: 50.0,
            u: Some(zigzag.clone()),
            spacing: Some(1.0 / 299.0),
            scale: 2.0,
        };
        let small = FixtureLayout {
            scale: 0.5,
            ..FixtureLayout::plain(curtain.clone(), 0.95)
        };
        let layouts = [
            ("curtain", FixtureLayout::plain(curtain.clone(), 0.95)),
            ("strip", FixtureLayout::plain(strip, 1.0)),
            ("small curtain", small),
            ("along", along),
        ];
        for (name, source, _) in crate::builtin::all().filter(|(_, _, t)| *t) {
            let s = Scripts::new().unwrap();
            s.register("t", source).unwrap();
            for (id, l) in &layouts {
                s.fixture_layout(id, l).unwrap();
                s.create(
                    id,
                    "t",
                    &Scripts::transition_layout(id),
                    &serde_json::json!({}),
                    &[],
                )
                .unwrap();
                let len = l.points.len() * 3;
                let a: Vec<f32> = (0..len).map(|i| (i * 37 % 101) as f32 / 100.0).collect();
                let b: Vec<f32> = (0..len).map(|i| (i * 53 % 97) as f32 / 96.0).collect();
                let mut out = vec![0.0; len];
                for (progress, want) in [(0.0, &a), (1.0, &b)] {
                    s.blend(id, Some(&a), Some(&b), progress, 0.7, 0.04, &mut out)
                        .unwrap_or_else(|e| panic!("{name}: {e}"));
                    let worst = out
                        .iter()
                        .zip(want.iter())
                        .map(|(o, w)| (o - w).abs())
                        .fold(0.0, f32::max);
                    assert!(
                        worst < 1e-3,
                        "{name} on the {id} at {progress} is off by {worst}"
                    );
                }
            }
        }
    }

    #[test]
    fn blends_frames() {
        let s = scripts();
        s.register("fade", crate::builtin::source("fade").unwrap())
            .unwrap();
        s.create("f", "fade", "l", &serde_json::json!({}), &[])
            .unwrap();
        let a = [1.0; 6];
        let mut out = [0.0; 6];
        s.blend("f", Some(&a), None, 0.5, 0.0, 0.0, &mut out)
            .unwrap();
        assert_eq!(out, [0.5; 6]);
        s.blend("f", Some(&a), None, 1.0, 0.0, 0.0, &mut out)
            .unwrap();
        assert_eq!(out, [0.0; 6]);
    }
}
