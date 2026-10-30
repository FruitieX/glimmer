//! Writes effects and transitions through an OpenAI-compatible chat
//! completions endpoint: the owner's Hermes agent, which runs Codex models.

use crate::{model::ScriptKind, script::Scripts};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

const GUIDE: &str = include_str!("../../docs/effects.md");
const EXAMPLE_EFFECT: &str = include_str!("../js/effects/aurora.js");
const EXAMPLE_TRANSITION: &str = include_str!("../js/transitions/wipe.js");

#[derive(Clone)]
pub struct Ai {
    /// Base URL ending in `/v1`.
    url: String,
    key: Option<String>,
    model: String,
    agent: ureq::Agent,
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
        })
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
             smooth motion, rich but not garish colour, sensible defaults, and parameters with friendly labels. \
             Don't use tools or write files: reply with only a JSON object {{\"source\": <the complete module>, \"summary\": <one or two plain sentences for the person>}}.\n\n\
             <guide>\n{GUIDE}\n</guide>\n\n<example>\n{example}\n</example>"
        )
    }

    fn ask(&self, system: &str, messages: &[Value]) -> Result<Answer, String> {
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
        parse_answer(text)
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
}
