//! Writes effects and transitions with Claude (Messages API over HTTPS).

use crate::{model::ScriptKind, script::Scripts};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

const GUIDE: &str = include_str!("../../docs/effects.md");
const MODEL: &str = "claude-opus-5-5";
const EXAMPLE_EFFECT: &str = include_str!("../js/effects/aurora.js");
const EXAMPLE_TRANSITION: &str = include_str!("../js/transitions/wipe.js");

#[derive(Clone)]
pub struct Ai {
    key: String,
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
    pub fn from_env() -> Option<Self> {
        let key = std::env::var("ANTHROPIC_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())?;
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(600)))
            .http_status_as_error(false)
            .build()
            .new_agent();
        Some(Self { key, agent })
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
             Return the complete module in `source` and one or two plain sentences for the person in `summary`.\n\n\
             <guide>\n{GUIDE}\n</guide>\n\n<example>\n{example}\n</example>"
        )
    }

    fn ask(&self, system: &str, messages: &[Value]) -> Result<Answer, String> {
        let body = json!({
            "model": MODEL,
            "max_tokens": 16000,
            "thinking": {"type": "adaptive"},
            "output_config": {
                "effort": "medium",
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "source": {"type": "string"},
                            "summary": {"type": "string"}
                        },
                        "required": ["source", "summary"],
                        "additionalProperties": false
                    }
                }
            },
            "fallbacks": "default",
            "system": system,
            "messages": messages,
        });
        let mut response = self
            .agent
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.key)
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", "server-side-fallback-2026-07-01")
            .send_json(&body)
            .map_err(|e| format!("calling Claude failed: {e}"))?;
        let status = response.status().as_u16();
        let value: Value = response
            .body_mut()
            .read_json()
            .map_err(|e| format!("reading Claude's answer failed: {e}"))?;
        if status != 200 {
            let message = value["error"]["message"]
                .as_str()
                .unwrap_or("unknown error");
            return Err(format!("Claude returned HTTP {status}: {message}"));
        }
        match value["stop_reason"].as_str() {
            Some("refusal") => return Err("Claude declined this request.".into()),
            Some("max_tokens") => {
                return Err("Claude's answer was cut off; try a simpler request.".into());
            }
            _ => {}
        }
        let text: String = value["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect();
        serde_json::from_str(&text).map_err(|e| format!("Claude's answer was not valid JSON: {e}"))
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
            messages.push(json!({"role": "assistant", "content": serde_json::to_string(&json!({"source": answer.source, "summary": answer.summary})).unwrap_or_default()}));
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
