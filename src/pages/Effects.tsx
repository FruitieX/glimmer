import { useRef, useState } from "react";
import { ImagePlus, Plus, Sparkles, Wand2 } from "lucide-react";
import {
  ApiError,
  post,
  type FixtureLayout,
  type ScriptInfo,
  type ScriptKind,
} from "../api";
import { CategoryChips, groupByCategory } from "../components/Categories";
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
  useToast,
} from "../components/ui";
import { TEMPLATES } from "./templates";

function Grid({
  scripts,
  frames,
  layout,
}: {
  scripts: ScriptInfo[];
  frames: Map<string, Uint8Array>;
  layout: FixtureLayout;
}) {
  const { navigate } = useRoute();
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

const heading = "text-[13px] font-semibold tracking-wide text-muted uppercase";

export function EffectsPage() {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const { run, busy } = useAction();
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<ScriptKind>("effect");
  const effects = state.scripts.filter((s) => s.kind === "effect");
  const transitions = state.scripts.filter((s) => s.kind === "transition");
  const groups = groupByCategory(effects);
  const [category, setCategory] = useState("All");
  // Thumbnails render on the first mapped light, so they look like the real thing.
  const light = state.fixtures.find((f) => f.layout?.points.length);
  const layout = light?.layout ?? { points: GRID, aspect: 1 };
  const effectFrames = useGallery("effect", light?.fixture.id);
  const transitionFrames = useGallery("transition", light?.fixture.id);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

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

      <div className="sticky top-16 z-20 -mx-4 bg-ink/80 px-4 py-2 backdrop-blur-xl">
        <CategoryChips
          groups={[...groups, ["Transitions", transitions]]}
          value={category}
          onChange={setCategory}
        />
      </div>

      {groups
        .filter(([c]) => category === "All" || category === c)
        .map(([c, scripts]) => (
          <section key={c} className="space-y-3">
            <h2 className={heading}>{c}</h2>
            <Grid scripts={scripts} frames={effectFrames} layout={layout} />
          </section>
        ))}
      {(category === "All" || category === "Transitions") && (
        <section className="space-y-3">
          <h2 className={heading}>Transitions</h2>
          <Grid
            scripts={transitions}
            frames={transitionFrames}
            layout={layout}
          />
        </section>
      )}

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
          {kind === "effect" && (
            <div className="space-y-2 border-t border-line pt-4">
              <Button
                className="w-full"
                disabled={uploading}
                onClick={() => uploadRef.current?.click()}
              >
                <ImagePlus size={16} />{" "}
                {uploading ? "Reading the image…" : "From a GIF or picture"}
              </Button>
              <p className="text-xs text-muted">
                Plays an animated GIF (or a still image) across the LEDs; the
                new effect lets you adjust its speed, fit and panning.
              </p>
              <input
                ref={uploadRef}
                type="file"
                accept="image/gif,image/png,image/jpeg"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setUploading(true);
                  try {
                    const name = file.name.replace(/\.[^.]+$/, "");
                    const r = await fetch(
                      `/api/images?name=${encodeURIComponent(name)}`,
                      {
                        method: "POST",
                        headers: {
                          "Content-Type":
                            file.type || "application/octet-stream",
                        },
                        body: file,
                      },
                    );
                    const data = await r.json().catch(() => null);
                    if (!r.ok)
                      throw new ApiError(
                        data?.message ?? `Upload failed (${r.status})`,
                        r.status,
                      );
                    await reload();
                    navigate(
                      `/effects/${encodeURIComponent((data as ScriptInfo).id)}`,
                    );
                  } catch (err) {
                    toast(
                      err instanceof Error ? err.message : String(err),
                      "bad",
                    );
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </div>
          )}
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
