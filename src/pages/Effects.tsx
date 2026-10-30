import { useState } from "react";
import { Plus, Sparkles, Wand2 } from "lucide-react";
import { post, type ScriptInfo, type ScriptKind } from "../api";
import { useApp, useRoute } from "../main";
import { GRID, useGallery } from "../live";
import { EffectCard } from "../components/EffectCard";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Select,
  useAction,
} from "../components/ui";
import { TEMPLATES } from "./templates";

function Gallery({
  kind,
  scripts,
}: {
  kind: ScriptKind;
  scripts: ScriptInfo[];
}) {
  const { state } = useApp();
  const { navigate } = useRoute();
  // Preview on the first mapped light, so thumbnails look like the real thing.
  const light = state.fixtures.find((f) => f.layout?.points.length);
  const frames = useGallery(kind, light?.fixture.id);
  const layout = light?.layout ?? { points: GRID, aspect: 1 };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {scripts.map((s) => (
        <EffectCard
          key={s.id}
          script={s}
          frames={frames}
          layout={layout}
          badge={!s.builtin && <Badge tone="glow">v{s.version}</Badge>}
          onClick={() => navigate(`/effects/${encodeURIComponent(s.id)}`)}
        />
      ))}
    </div>
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
            describe one and let the AI write it.
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
        <Gallery kind="effect" scripts={effects} />
      </section>
      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">
          Transitions
        </h2>
        <Gallery kind="transition" scripts={transitions} />
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
              AI writing needs an AI endpoint configured on the server.
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
