import { useState } from "react";
import { Plus, Sparkles, Wand2 } from "lucide-react";
import { post, type ScriptInfo, type ScriptKind } from "../api";
import { Link, useApp, useRoute } from "../main";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Select,
  useAction,
} from "../components/ui";
import { TEMPLATES } from "./templates";

function ScriptCard({ s }: { s: ScriptInfo }) {
  const params = Object.keys(s.meta.params).length;
  return (
    <Link to={`/effects/${encodeURIComponent(s.id)}`} className="block">
      <Card className="h-full p-4 transition hover:ring-glow/40">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium">{s.name}</h3>
          {s.builtin ? (
            <Badge>Built in</Badge>
          ) : (
            <Badge tone="glow">v{s.version}</Badge>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm text-muted">
          {s.meta.description || "No description"}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {s.meta.colors.length > 0 && (
            <span>{s.meta.colors.length} colours</span>
          )}
          {params > 0 && <span>· {params} settings</span>}
          {s.meta.loops && <span>· loops</span>}
        </div>
      </Card>
    </Link>
  );
}

export function EffectsPage() {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const { run, busy } = useAction();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<ScriptKind>("effect");
  const effects = state.scripts.filter((s) => s.kind === "effect");
  const transitions = state.scripts.filter((s) => s.kind === "transition");

  const create = async (ai: boolean) => {
    if (ai) {
      navigate(`/effects/new?kind=${kind}&ai=1`);
      return;
    }
    const info = await run(() =>
      post<ScriptInfo>("/scripts", {
        kind,
        source: TEMPLATES[kind],
        note: "Created",
      }),
    );
    if (info) {
      await reload();
      navigate(`/effects/${encodeURIComponent(info.id)}`);
    }
  };

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Effects</h1>
          <p className="mt-1 text-sm text-muted">
            Small JavaScript programs that colour the LEDs. Edit them live, or
            describe one and let Claude write it.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> New
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
          Effects
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {effects.map((s) => (
            <ScriptCard key={s.id} s={s} />
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
          Transitions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {transitions.map((s) => (
            <ScriptCard key={s.id} s={s} />
          ))}
        </div>
      </section>

      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Create"
        description="Start from a description or from a simple template."
      >
        <div className="space-y-5">
          <Field label="Kind">
            <Select
              label="Kind"
              value={kind}
              onChange={(v) => setKind(v as ScriptKind)}
              options={[
                { value: "effect", label: "Effect: what a light shows" },
                { value: "transition", label: "Transition: how it changes" },
              ]}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              variant="primary"
              disabled={!state.ai}
              onClick={() => create(true)}
            >
              <Wand2 size={16} /> Describe it
            </Button>
            <Button disabled={busy} onClick={() => create(false)}>
              <Sparkles size={16} /> Start from code
            </Button>
          </div>
          {!state.ai && (
            <p className="text-xs text-muted">
              AI writing needs an Anthropic API key on the server.
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
