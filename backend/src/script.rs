//! Sandboxed JavaScript effects and transitions, run in QuickJS.
//!
//! Each script is an ES module exporting `meta` and `render(ctx)`; see
//! `docs/effects.md`. A `Scripts` value owns one QuickJS runtime and is used
//! from a single thread. Every call into JavaScript runs under a time budget,
//! so a runaway script raises an error instead of stalling the lights.

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

    /// Compiles a module under a unique `key` and returns what it declares.
    pub fn register(&self, key: &str, source: &str) -> Result<Meta, String> {
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

    /// Positions are normalised to 0..1; `aspect` is width / height.
    pub fn layout(&self, id: &str, points: &[[f32; 3]], aspect: f32) -> Result<(), String> {
        let xs: Vec<f32> = points.iter().map(|p| p[0]).collect();
        let ys: Vec<f32> = points.iter().map(|p| p[1]).collect();
        let zs: Vec<f32> = points.iter().map(|p| p[2]).collect();
        self.run(|ctx| Self::host(ctx, "layout")?.1.call((id, xs, ys, zs, aspect)))
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
            *o = if v.is_finite() { *v } else { 0.0 };
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
        let meta = scripts.register("check", source)?;
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
            assert!(took < Duration::from_millis(20), "{name} took {took:?}");
        }
    }

    #[test]
    fn builtin_transitions_start_at_a_and_end_at_b() {
        let curtain: Vec<[f32; 3]> = (0..210)
            .map(|i| [(i / 21) as f32 / 9.0, (i % 21) as f32 / 20.0, 0.5])
            .collect();
        let strip: Vec<[f32; 3]> = (0..600).map(|i| [i as f32 / 599.0, 0.5, 0.5]).collect();
        for (name, source, _) in crate::builtin::all().filter(|(_, _, t)| *t) {
            let s = Scripts::new().unwrap();
            s.register("t", source).unwrap();
            for (id, points, aspect) in [("curtain", &curtain, 0.95), ("strip", &strip, 1.0)] {
                s.layout(id, points, aspect).unwrap();
                s.create(id, "t", id, &serde_json::json!({}), &[]).unwrap();
                let len = points.len() * 3;
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
