//! Talks to an OpenAI-compatible chat completions endpoint (the owner's
//! Hermes agent, which runs Codex models): writes effects and transitions,
//! names presets, suggests looks and proposes playlists. All prompts live
//! here; [`crate::proposals`] checks what comes back.

use crate::{
    model::ScriptKind,
    proposals::{self, Catalog, PlaylistProposal, RawPlaylist},
    script::{EffectLook, Meta, Scripts},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

const GUIDE: &str = include_str!("../../docs/effects.md");
const EXAMPLE_EFFECT: &str = include_str!("../js/effects/aurora.js");
const EXAMPLE_TRANSITION: &str = include_str!("../js/transitions/wipe.js");

/// Effect code longer than this is cut short in prompts about looks.
const CODE_MAX: usize = 8000;

#[derive(Clone)]
pub struct Ai {
    /// Base URL ending in `/v1`.
    url: String,
    key: Option<String>,
    model: String,
    agent: ureq::Agent,
    /// Cleared, for the rest of the process, once a request with an image
    /// failed and the same request without it worked.
    images: Arc<AtomicBool>,
}

/// One look of an effect, as the AI is told about it.
pub struct LookInfo<'a> {
    pub source: &'a str,
    pub meta: &'a Meta,
    pub params: &'a Value,
    pub colors: &'a [String],
}

impl LookInfo<'_> {
    fn describe(&self) -> String {
        let code: String = self.source.chars().take(CODE_MAX).collect();
        let meta = json!({
            "name": self.meta.name,
            "description": self.meta.description,
            "params": self.meta.params,
            "colors": self.meta.colors,
        });
        format!(
            "Effect: {}\nSettings: {}\nColours: {}\n\n<meta>\n{meta}\n</meta>\n\n<code>\n{code}\n</code>",
            self.meta.name,
            self.params,
            json!(self.colors),
        )
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub kind: ScriptKind,
    pub prompt: String,
    /// The script to change, when refining an existing one.
    #[serde(default)]
    pub source: Option<String>,
    /// What the fixture looks like, so the effect can suit it.
    #[serde(default)]
    pub fixture: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub source: String,
    pub summary: String,
    /// Set when the final script still failed its check.
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct Answer {
    source: String,
    summary: String,
}

impl Ai {
    /// `GLIMMER_AI_URL` (e.g. `http://hermes.example.com:8642/v1`), optional
    /// `GLIMMER_AI_KEY` and `GLIMMER_AI_MODEL` (default `hermes-agent`).
    pub fn from_env() -> Option<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        let url = var("GLIMMER_AI_URL")?.trim_end_matches('/').to_string();
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(600)))
            .http_status_as_error(false)
            .build()
            .new_agent();
        Some(Self {
            url,
            key: var("GLIMMER_AI_KEY"),
            model: var("GLIMMER_AI_MODEL").unwrap_or("hermes-agent".into()),
            agent,
            images: Arc::new(AtomicBool::new(true)),
        })
    }

    /// Whether requests still include pictures (until one is turned down).
    pub fn sends_images(&self) -> bool {
        self.images.load(Ordering::Relaxed)
    }

    fn system(kind: ScriptKind) -> String {
        let (what, example) = match kind {
            ScriptKind::Effect => ("an effect", EXAMPLE_EFFECT),
            ScriptKind::Transition => ("a transition", EXAMPLE_TRANSITION),
        };
        format!(
            "You write lighting scripts for Twinkly LED strings (curtains, strings and trees of a few hundred LEDs, \
             viewed from a few metres away in a home). Write {what} as a single JavaScript module that follows the guide \
             below exactly. It runs in QuickJS with only the documented globals. Make it look beautiful on real LEDs: \
             smooth motion, rich but not garish colour, sensible defaults, parameters with friendly labels and, for effects, 3–4 looks. \
             Don't use tools or write files: reply with only a JSON object {{\"source\": <the complete module>, \"summary\": <one or two plain sentences for the person>}}.\n\n\
             <guide>\n{GUIDE}\n</guide>\n\n<example>\n{example}\n</example>"
        )
    }

    fn ask(&self, system: &str, messages: &[Value]) -> Result<Answer, String> {
        parse_answer(&self.chat(system, messages)?)
    }

    /// The text of the AI's reply to `messages` after `system`.
    fn chat(&self, system: &str, messages: &[Value]) -> Result<String, String> {
        let mut all = vec![json!({"role": "system", "content": system})];
        all.extend_from_slice(messages);
        let mut request = self.agent.post(format!("{}/chat/completions", self.url));
        if let Some(key) = &self.key {
            request = request.header("Authorization", format!("Bearer {key}"));
        }
        let mut response = request
            .send_json(json!({ "model": self.model, "messages": all }))
            .map_err(|e| format!("the AI service could not be reached: {e}"))?;
        let status = response.status().as_u16();
        let value: Value = response
            .body_mut()
            .read_json()
            .map_err(|e| format!("reading the AI's answer failed: {e}"))?;
        if status != 200 {
            let message = value["error"]["message"]
                .as_str()
                .unwrap_or("unknown error");
            return Err(format!("the AI service returned HTTP {status}: {message}"));
        }
        let text = value["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("the AI's answer had no text")?;
        Ok(text.to_string())
    }

    /// Asks with `text` and, while the endpoint takes pictures, `png`. When
    /// the request with the picture fails, asks again without it and, if
    /// that works, sends no more pictures.
    fn chat_with_image(
        &self,
        system: &str,
        text: &str,
        png: Option<&[u8]>,
    ) -> Result<String, String> {
        let plain = [json!({"role": "user", "content": text})];
        let Some(png) = png.filter(|_| self.sends_images()) else {
            return self.chat(system, &plain);
        };
        let url = format!("data:image/png;base64,{}", STANDARD.encode(png));
        let with_image = [json!({"role": "user", "content": [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": url}},
        ]})];
        match self.chat(system, &with_image) {
            Ok(reply) => Ok(reply),
            Err(first) => {
                let reply = self.chat(system, &plain)?;
                tracing::warn!(
                    "the AI turned down a picture ({first}); sending text only from now on"
                );
                self.images.store(false, Ordering::Relaxed);
                Ok(reply)
            }
        }
    }

    /// A short, evocative name for a saved look; `png` is a contact sheet of it.
    pub fn name_look(&self, look: &LookInfo, png: Option<&[u8]>) -> Result<String, String> {
        let system = "You name saved looks of LED light effects in a home lighting app. \
            Reply with only JSON {\"name\": <the name>}: one to four evocative words, at most 30 characters, \
            about how the look feels (like \"Ember Glow\" or \"Northern Hush\"). \
            Don't repeat the effect's name, and use no quotes or emoji.";
        let mut text = format!("Name this look.\n\n{}", look.describe());
        if png.is_some() && self.sends_images() {
            text.push_str(
                "\n\nThe picture shows six frames over six seconds, each a 10 × 21 curtain with a straight string below.",
            );
        }
        let reply = self.chat_with_image(system, &text, png)?;
        #[derive(Deserialize)]
        struct Named {
            name: String,
        }
        let name = json_in::<Named>(&reply).map(|n| n.name).unwrap_or(reply);
        proposals::clean_name(&name)
    }

    /// 1–4 looks for an effect that answer `prompt`, fitted to its params
    /// and colour slots. Asks again once when none fit.
    pub fn suggest_looks(
        &self,
        look: &LookInfo,
        prompt: &str,
        fit: impl Fn(&[EffectLook]) -> Result<Vec<EffectLook>, String>,
    ) -> Result<Vec<EffectLook>, String> {
        let system = "You suggest looks for one LED light effect in a home lighting app: values for its params and \
            colour slots. Reply with only JSON {\"looks\": [{\"name\": <one to four evocative words, at most 30 characters>, \
            \"params\": {<param id>: <value>}, \"colors\": [<\"#rrggbb\" for each colour slot, in order>]}]} \
            with 1 to 4 looks that answer the request, each clearly different. Use only the effect's params, within \
            their min, max and options; params you leave out keep their defaults. Rich, not garish, colours look best on LEDs.";
        let text = format!(
            "Request: {prompt}\n\nThe effect's current settings and colours are a starting point.\n\n{}",
            look.describe()
        );
        let mut messages = vec![json!({"role": "user", "content": text})];
        let reply = self.chat(system, &messages)?;
        match fit(&looks_in(&reply)) {
            Ok(looks) => Ok(looks),
            Err(e) => {
                messages.push(json!({"role": "assistant", "content": reply}));
                messages.push(json!({"role": "user", "content": format!("Those don't fit the effect: {e}. Reply with corrected JSON.")}));
                fit(&looks_in(&self.chat(system, &messages)?))
            }
        }
    }

    /// A playlist for `prompt` made of what `catalog` has, checked. Asks
    /// again once when it can't be used at all.
    pub fn playlist(&self, prompt: &str, catalog: &Catalog) -> Result<PlaylistProposal, String> {
        let system = "You build playlists for Twinkly LED lights in a home: effects that take turns. Reply with only JSON \
            {\"name\": <a short playlist name>, \"shuffle\": <bool>, \"season\": <null, or {\"from\": \"MM-DD\", \"to\": \"MM-DD\"}>, \
            \"transitions\": [<none, or {\"scriptId\": <transition id>, \"durationMs\": <800–3000>}>], \
            \"entries\": [{\"scriptId\": <effect id>, \"durationS\": <seconds>, and at most one of \
            \"presetId\": <an existing preset of that effect>, \"look\": <one of the effect's look names>, or \
            \"preset\": {\"name\": <a new preset name, at most 30 characters>, \"params\": {<param id>: <value>}, \"colors\": [<\"#rrggbb\" per colour slot>]}}]}. \
            Use only the effects, looks, presets and transitions listed. Prefer the listed looks and presets; make a new preset \
            only when none suits. Give a season only when the request names a time of year. \
            Unless asked otherwise, use 6 to 10 entries of 2 to 5 minutes.";
        let line = |v: Value| v.to_string();
        let effects: Vec<String> = catalog
            .effects
            .iter()
            .map(|(id, m)| {
                line(json!({
                    "id": id, "name": m.name, "description": m.description, "category": m.category,
                    "params": m.params, "colors": m.colors,
                    "looks": m.looks.iter().map(|l| &l.name).collect::<Vec<_>>(),
                }))
            })
            .collect();
        let presets: Vec<String> = catalog
            .presets
            .iter()
            .map(|p| line(json!({"id": p.id, "name": p.name, "scriptId": p.look.script_id})))
            .collect();
        let transitions: Vec<String> = catalog
            .transitions
            .iter()
            .map(|(id, m)| line(json!({"id": id, "name": m.name})))
            .collect();
        let text = format!(
            "Request: {prompt}\n\n<effects>\n{}\n</effects>\n\n<presets>\n{}\n</presets>\n\n<transitions>\n{}\n</transitions>",
            effects.join("\n"),
            presets.join("\n"),
            transitions.join("\n"),
        );
        let check = |reply: &str| {
            json_in::<RawPlaylist>(reply).and_then(|raw| proposals::check_playlist(raw, catalog))
        };
        let mut messages = vec![json!({"role": "user", "content": text})];
        let reply = self.chat(system, &messages)?;
        match check(&reply) {
            Ok(p) => Ok(p),
            Err(e) => {
                messages.push(json!({"role": "assistant", "content": reply}));
                messages.push(json!({"role": "user", "content": format!("That can't be used: {e}. Reply with corrected JSON.")}));
                check(&self.chat(system, &messages)?)
            }
        }
    }

    /// Generates a script, checks it, and asks for a fix once if it fails.
    pub fn generate(&self, request: &Request) -> Result<Reply, String> {
        let system = Self::system(request.kind);
        let mut prompt = String::new();
        if let Some(fixture) = &request.fixture {
            prompt.push_str(&format!("The fixture: {fixture}\n\n"));
        }
        match &request.source {
            Some(source) => prompt.push_str(&format!(
                "Change this script as follows: {}\n\n<script>\n{source}\n</script>",
                request.prompt
            )),
            None => prompt.push_str(&request.prompt),
        }
        let mut messages = vec![json!({"role": "user", "content": prompt})];
        let transition = request.kind == ScriptKind::Transition;
        let mut answer = self.ask(&system, &messages)?;
        let mut error = Scripts::check(&answer.source, transition).err();
        if let Some(e) = &error {
            messages.push(json!({"role": "assistant", "content": json!({"source": answer.source, "summary": answer.summary}).to_string()}));
            messages.push(json!({"role": "user", "content": format!("Running the script failed: {e}\nReturn a corrected complete script.")}));
            answer = self.ask(&system, &messages)?;
            error = Scripts::check(&answer.source, transition).err();
        }
        Ok(Reply {
            source: answer.source,
            summary: answer.summary,
            error,
        })
    }
}

/// Reads `{"source", "summary"}` from a reply, tolerating code fences or
/// prose around it; a bare JavaScript block is accepted as the source.
fn parse_answer(text: &str) -> Result<Answer, String> {
    let trimmed = text.trim();
    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}'))
        && let Ok(answer) = serde_json::from_str::<Answer>(&trimmed[start..=end])
    {
        return Ok(answer);
    }
    for fence in ["```javascript", "```js", "```"] {
        if let Some(start) = trimmed.find(fence) {
            let body = &trimmed[start + fence.len()..];
            if let Some(end) = body.find("```") {
                let source = body[..end].trim().to_string();
                if source.contains("render") {
                    let summary = trimmed[..start].trim().to_string();
                    return Ok(Answer { source, summary });
                }
            }
        }
    }
    Err("the AI's answer did not contain a script".into())
}

/// The JSON object in a reply, tolerating code fences or prose around it.
fn json_in<T: DeserializeOwned>(text: &str) -> Result<T, String> {
    let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) else {
        return Err("the AI's answer had no JSON".into());
    };
    if end < start {
        return Err("the AI's answer had no JSON".into());
    }
    serde_json::from_str(&text[start..=end]).map_err(|e| format!("the AI's JSON didn't fit: {e}"))
}

/// The looks in a reply: `{"looks": [...]}` or a bare list, skipping
/// entries that aren't shaped like looks.
fn looks_in(text: &str) -> Vec<EffectLook> {
    #[derive(Deserialize)]
    struct Looks {
        looks: Vec<Value>,
    }
    let items = json_in::<Looks>(text).map(|l| l.looks).or_else(|_| {
        let (start, end) = (text.find('['), text.rfind(']'));
        match (start, end) {
            (Some(s), Some(e)) if s < e => {
                serde_json::from_str::<Vec<Value>>(&text[s..=e]).map_err(|e| e.to_string())
            }
            _ => Err(String::new()),
        }
    });
    items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_json_fenced_or_plain_answers() {
        let a = parse_answer(
            "```json\n{\"source\": \"export function render(ctx) {}\", \"summary\": \"Hi\"}\n```",
        )
        .unwrap();
        assert_eq!(a.summary, "Hi");
        let a = parse_answer("Here you go:\n```js\nexport function render(ctx) {}\n```").unwrap();
        assert_eq!(a.source, "export function render(ctx) {}");
        assert!(parse_answer("no idea").is_err());
    }

    #[test]
    fn reads_looks_and_names_from_fenced_json() {
        let looks = looks_in(
            "Sure!\n```json\n{\"looks\": [{\"name\": \"Ember\", \"params\": {\"speed\": 0.3}, \"colors\": [\"#ff8800\"]}, 5]}\n```",
        );
        assert_eq!(looks.len(), 1);
        assert_eq!(looks[0].name, "Ember");
        let looks = looks_in("[{\"name\": \"A\"}, {\"name\": \"B\", \"colors\": []}]");
        assert_eq!(looks.len(), 2);
        assert!(looks_in("nothing").is_empty());
        #[derive(Deserialize)]
        struct Named {
            name: String,
        }
        let n: Named = json_in("```json\n{\"name\": \"Northern Hush\"}\n```").unwrap();
        assert_eq!(n.name, "Northern Hush");
        assert!(json_in::<Named>("} no {").is_err());
    }
}
