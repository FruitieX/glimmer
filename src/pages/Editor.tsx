import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Code2,
  Copy,
  Pencil,
  History,
  Lightbulb,
  LightbulbOff,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  api,
  colorValues,
  del,
  paramValues,
  post,
  put,
  type Meta,
  type Preset,
  type ScriptInfo,
  type ScriptKind,
  type VersionInfo,
} from "../api";
import { usePreview } from "../live";
import { Link, useApp, useRoute } from "../main";
import { CodeEditor } from "../components/CodeEditor";
import { Mirror } from "../components/Mirror";
import { ColorControls, ParamControls } from "../components/controls";
import {
  Badge,
  Button,
  Card,
  cx,
  Dialog,
  Field,
  Input,
  Section,
  Select,
  Slider,
  useAction,
  useToast,
} from "../components/ui";
import { TEMPLATES } from "./templates";

interface Loaded {
  info: ScriptInfo;
  source: string;
  versions: VersionInfo[];
}

export function EditorPage({ id }: { id: string }) {
  const isNew = id === "new";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      setLoaded(await api<Loaded>(`/scripts/${encodeURIComponent(id)}`));
    } catch {
      setMissing(true);
    }
  }, [id, isNew]);
  useEffect(() => {
    load();
  }, [load]);
  if (missing)
    return (
      <div className="py-20 text-center text-muted">
        This script doesn't exist.{" "}
        <Link to="/effects" className="text-glow">
          Back to effects
        </Link>
      </div>
    );
  if (!isNew && !loaded)
    return <div className="py-20 text-center text-sm text-muted">Loading…</div>;
  const params = new URLSearchParams(location.search);
  const kind = (loaded?.info.kind ??
    (params.get("kind") === "transition"
      ? "transition"
      : "effect")) as ScriptKind;
  return (
    <Editor
      key={id}
      loaded={loaded}
      kind={kind}
      reloadScript={load}
      startWithAi={params.get("ai") === "1"}
    />
  );
}

function Editor({
  loaded,
  kind,
  reloadScript,
  startWithAi,
}: {
  loaded: Loaded | null;
  kind: ScriptKind;
  reloadScript: () => Promise<void>;
  startWithAi: boolean;
}) {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const { run, busy } = useAction();
  const toast = useToast();
  const saved = loaded?.source ?? "";
  const [source, setSource] = useState(loaded?.source ?? TEMPLATES[kind]);
  useEffect(() => {
    if (loaded) setSource(loaded.source);
  }, [loaded]);
  const dirty = !loaded || source !== saved;
  const builtin = loaded?.info.builtin ?? false;
  const lights = state.fixtures.filter((f) => f.layout?.points.length);
  const [fixtureId, setFixtureId] = useState<string>(
    lights[0]?.fixture.id ?? "",
  );
  const [previewParams, setPreviewParams] = useState<Record<string, unknown>>(
    {},
  );
  const [previewColors, setPreviewColors] = useState<string[]>([]);
  const [duration, setDuration] = useState(1500);
  const [trying, setTrying] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(startWithAi);
  const [saving, setSaving] = useState(false);
  // Phones show the preview and settings first; the code opens on request.
  const [showCode, setShowCode] = useState(false);
  const [note, setNote] = useState("");

  const request = useMemo(
    () => ({
      kind,
      source,
      params: previewParams,
      colors: previewColors,
      fixtureId: fixtureId || undefined,
      durationMs: duration,
    }),
    [kind, source, previewParams, previewColors, fixtureId, duration],
  );
  const preview = usePreview(request);
  const meta = (preview.meta as Meta | null) ?? loaded?.info.meta ?? null;
  const points = preview.points;
  const fixture = state.fixtures.find((f) => f.fixture.id === fixtureId);
  const frameSource = useCallback(() => preview.frame.current, [preview.frame]);

  // Trying a draft on real lights follows the editor.
  useEffect(() => {
    if (!trying || kind !== "effect") return;
    const t = setTimeout(() => {
      post(`/fixtures/${encodeURIComponent(trying)}/try`, {
        source,
        params: previewParams,
        colors: colorValues(meta ?? undefined, previewColors),
      }).catch((e) => toast(e.message, "bad"));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trying, source, previewParams, previewColors]);
  useEffect(() => {
    return () => {
      if (trying)
        post(`/fixtures/${encodeURIComponent(trying)}/restore`).catch(() => {});
    };
  }, [trying]);

  const save = async () => {
    if (!loaded || builtin) {
      const info = await run(
        () =>
          post<ScriptInfo>("/scripts", {
            kind,
            source,
            note:
              note ||
              (builtin ? `Copied from ${loaded?.info.name}` : "Created"),
          }),
        "Saved",
      );
      if (info) {
        await reload();
        navigate(`/effects/${encodeURIComponent(info.id)}`);
      }
    } else {
      const info = await run(
        () =>
          put<ScriptInfo>(`/scripts/${encodeURIComponent(loaded.info.id)}`, {
            source,
            note,
          }),
        "Saved new version",
      );
      if (info) {
        setNote("");
        await reloadScript();
        reload();
      }
    }
    setSaving(false);
  };

  const fixtureDescription = fixture
    ? `${fixture.fixture.name}: ${fixture.fixture.count} LEDs, ${
        state.devices.find((d) => d.id === fixture.fixture.deviceId)?.layout
          ?.source === "3d"
          ? "mapped in 3D"
          : "laid out in 2D"
      }, width/height ${fixture.layout?.aspect.toFixed(2)}`
    : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/effects"
          className="rounded-xl p-2 text-muted hover:bg-raised hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {meta?.name || loaded?.info.name || "New script"}
          </h1>
          <p className="truncate text-sm text-muted">
            {kind === "effect" ? "Effect" : "Transition"}
            {loaded && ` · version ${loaded.info.version}`}
            {builtin && " · built in"}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
          <Button
            variant="subtle"
            onClick={() => setAiOpen(true)}
            disabled={!state.ai}
          >
            <Wand2 size={16} /> {loaded ? "Change with AI" : "Write with AI"}
          </Button>
          <Button
            variant="primary"
            disabled={(!dirty && !builtin) || busy || !!preview.error}
            onClick={() => (loaded && !builtin ? setSaving(true) : save())}
          >
            {builtin ? <Copy size={16} /> : <Save size={16} />}
            {builtin ? "Save a copy" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card
          className={cx(
            "order-2 min-h-[520px] flex-col overflow-hidden xl:order-1 xl:flex",
            showCode ? "flex" : "hidden",
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-muted">
            <span className="font-mono">
              {loaded?.info.id ?? "untitled"}.js
            </span>
            {dirty && loaded && (
              <span className="text-glow">Unsaved changes</span>
            )}
          </div>
          <CodeEditor
            value={source}
            onChange={setSource}
            className="min-h-0 flex-1 overflow-auto"
          />
          {preview.error && (
            <div className="border-t border-bad/30 bg-bad/5 px-4 py-3 font-mono text-xs whitespace-pre-wrap text-bad">
              {preview.error}
            </div>
          )}
        </Card>

        <div className="order-1 space-y-6 xl:order-2">
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-b from-night to-ink">
              {points ? (
                <Mirror
                  points={points}
                  aspect={fixture?.layout?.aspect ?? 1}
                  source={frameSource}
                  className="h-72"
                />
              ) : (
                <div className="flex h-72 items-center justify-center text-sm text-muted">
                  <Loader2 size={18} className="mr-2 animate-spin" /> Starting
                  preview…
                </div>
              )}
            </div>
            {preview.error && !showCode && (
              <div className="border-t border-bad/30 bg-bad/5 px-4 py-3 font-mono text-xs whitespace-pre-wrap text-bad xl:hidden">
                {preview.error}
              </div>
            )}
            <div className="space-y-4 border-t border-line p-4">
              <Field label="Preview on">
                <Select
                  label="Preview on"
                  value={fixtureId}
                  onChange={setFixtureId}
                  options={[
                    ...lights.map((f) => ({
                      value: f.fixture.id,
                      label: f.fixture.name,
                    })),
                    { value: "", label: "A 10 × 21 grid" },
                  ]}
                />
              </Field>
              {kind === "transition" && (
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-soft">Duration</span>
                    <span className="font-mono text-xs text-muted">
                      {(duration / 1000).toFixed(1)} s
                    </span>
                  </div>
                  <Slider
                    label="Duration"
                    value={duration}
                    min={200}
                    max={6000}
                    step={100}
                    onChange={setDuration}
                  />
                </div>
              )}
              {kind === "effect" && fixtureId && (
                <Button
                  className="w-full"
                  variant={trying ? "primary" : "subtle"}
                  onClick={() => {
                    if (trying) {
                      post(
                        `/fixtures/${encodeURIComponent(trying)}/restore`,
                      ).catch(() => {});
                      setTrying(null);
                    } else {
                      setTrying(fixtureId);
                    }
                  }}
                >
                  {trying ? (
                    <LightbulbOff size={16} />
                  ) : (
                    <Lightbulb size={16} />
                  )}
                  {trying
                    ? `Stop showing on ${fixture?.fixture.name}`
                    : `Show on ${fixture?.fixture.name}`}
                </Button>
              )}
            </div>
          </Card>

          {meta && (
            <Section title="Try settings">
              <Card className="space-y-5 p-5">
                {meta.colors?.length > 0 && (
                  <ColorControls
                    slots={meta.colors}
                    values={colorValues(meta, previewColors)}
                    onChange={setPreviewColors}
                  />
                )}
                <ParamControls
                  params={meta.params ?? {}}
                  values={paramValues(meta, previewParams)}
                  onChange={(k, v) =>
                    setPreviewParams((p) => ({ ...p, [k]: v }))
                  }
                />
                {meta.loops && (
                  <Badge tone="ok">
                    Loops seamlessly · can play as a stored movie
                  </Badge>
                )}
              </Card>
            </Section>
          )}

          {loaded && kind === "effect" && meta && (
            <EffectPresets
              scriptId={loaded.info.id}
              meta={meta}
              params={previewParams}
              colors={previewColors}
              onLoad={(p, c) => {
                setPreviewParams(p);
                setPreviewColors(c);
              }}
            />
          )}

          <Button
            variant="subtle"
            className="w-full xl:hidden"
            onClick={() => setShowCode((v) => !v)}
          >
            <Code2 size={16} />{" "}
            {showCode
              ? "Hide the code"
              : builtin
                ? "View the code"
                : "Edit the code"}
          </Button>

          {loaded && !builtin && (
            <Versions
              loaded={loaded}
              onLoad={(s) => setSource(s)}
              onRestored={async () => {
                await reloadScript();
                reload();
              }}
            />
          )}
          {loaded && !builtin && (
            <Button
              variant="danger"
              className="w-full"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(`Delete ${loaded.info.name} and all its versions?`)
                )
                  return;
                if (
                  await run(
                    () => del(`/scripts/${encodeURIComponent(loaded.info.id)}`),
                    "Deleted",
                  )
                ) {
                  await reload();
                  navigate("/effects");
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          )}
        </div>
      </div>

      <AiDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        kind={kind}
        source={loaded || source !== TEMPLATES[kind] ? source : undefined}
        fixture={fixtureDescription}
        onResult={(s) => setSource(s)}
      />
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save new version"
        description="Lights showing this effect switch to the new version."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field label="What changed (optional)">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Slower drift, warmer colours"
              autoFocus
            />
          </Field>
          <Button variant="primary" className="w-full" disabled={busy}>
            Save
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

/** Saved presets of this effect: load one into the try settings, or save the current ones. */
function EffectPresets({
  scriptId,
  meta,
  params,
  colors,
  onLoad,
}: {
  scriptId: string;
  meta: Meta;
  params: Record<string, unknown>;
  colors: string[];
  onLoad: (params: Record<string, unknown>, colors: string[]) => void;
}) {
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const presets = state.presets.filter((p) => p.look.scriptId === scriptId);
  const [naming, setNaming] = useState<Preset | "new" | null>(null);
  const [name, setName] = useState("");
  const look = {
    scriptId,
    params: paramValues(meta, params),
    colors: colorValues(meta, colors),
  };
  return (
    <Section
      title="Presets"
      action={
        <Button
          size="sm"
          onClick={() => {
            setName("");
            setNaming("new");
          }}
        >
          <Bookmark size={14} /> Save these settings
        </Button>
      }
    >
      <Card className="divide-y divide-line">
        {presets.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted">
            No presets use this effect yet. Presets appear on every light, and
            homectl scenes can pick them by name.
          </p>
        )}
        {presets.map((p) => (
          <div key={p.id} className="flex items-center gap-2 px-4 py-2.5">
            <button
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
              onClick={() => onLoad(p.look.params ?? {}, p.look.colors ?? [])}
              title="Load into the try settings"
            >
              <span className="flex shrink-0 -space-x-1.5">
                {(p.look.colors ?? []).slice(0, 4).map((c, i) => (
                  <span
                    key={i}
                    className="h-4 w-4 rounded-full ring-2 ring-panel"
                    style={{ background: c }}
                  />
                ))}
              </span>
              <span className="truncate">{p.name}</span>
            </button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              title="Replace with the current try settings"
              onClick={async () => {
                if (
                  await run(
                    () => put(`/presets/${p.id}`, { name: p.name, look }),
                    `Updated ${p.name}`,
                  )
                )
                  reload();
              }}
            >
              <Save size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Rename ${p.name}`}
              onClick={() => {
                setName(p.name);
                setNaming(p);
              }}
            >
              <Pencil size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${p.name}`}
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Delete the preset ${p.name}?`)) return;
                if (await run(() => del(`/presets/${p.id}`), "Deleted"))
                  reload();
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </Card>
      <Dialog
        open={naming !== null}
        onOpenChange={(v) => !v && setNaming(null)}
        title={naming === "new" ? "Save as a preset" : "Rename preset"}
        description={
          naming === "new"
            ? "Saves the current try settings and colours."
            : undefined
        }
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok =
              naming === "new"
                ? await run(
                    () => post("/presets", { name, look }),
                    "Preset saved",
                  )
                : naming &&
                  (await run(
                    () =>
                      put(`/presets/${naming.id}`, { name, look: naming.look }),
                    "Renamed",
                  ));
            if (ok) {
              setNaming(null);
              reload();
            }
          }}
        >
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cosy evening"
              autoFocus
            />
          </Field>
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || !name.trim()}
          >
            Save
          </Button>
        </form>
      </Dialog>
    </Section>
  );
}

function Versions({
  loaded,
  onLoad,
  onRestored,
}: {
  loaded: Loaded;
  onLoad: (s: string) => void;
  onRestored: () => void;
}) {
  const { run } = useAction();
  return (
    <Section title="Versions">
      <Card className="divide-y divide-line">
        {loaded.versions.slice(0, 12).map((v) => (
          <div key={v.version} className="flex items-center gap-3 px-4 py-3">
            <History size={14} className="shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                v{v.version} · {v.note || "No note"}
              </p>
              <p className="text-xs text-muted">
                {v.author} · {new Date(v.created * 1000).toLocaleString()}
              </p>
            </div>
            {v.version !== loaded.info.version && (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ source: string }>(
                        `/scripts/${encodeURIComponent(loaded.info.id)}/versions/${v.version}`,
                      );
                      onLoad(r.source);
                    })
                  }
                >
                  View
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Restore version ${v.version}`}
                  onClick={async () => {
                    if (
                      await run(
                        () =>
                          post(
                            `/scripts/${encodeURIComponent(loaded.info.id)}/restore`,
                            { version: v.version },
                          ),
                        `Restored version ${v.version}`,
                      )
                    )
                      onRestored();
                  }}
                >
                  <RotateCcw size={14} />
                </Button>
              </div>
            )}
          </div>
        ))}
      </Card>
    </Section>
  );
}

const IDEAS: Record<ScriptKind, string[]> = {
  effect: [
    "Slow ocean waves in deep blues with foam-white crests",
    "Fireflies blinking lazily in a warm summer night",
    "Candy-cane stripes slowly spiralling upwards",
    "A gentle sunrise that loops from deep red to soft gold",
  ],
  transition: [
    "Curtains opening from the middle outwards",
    "A sparkly wave that sweeps from left to right",
    "Pixels falling down like rain to reveal the new look",
  ],
};

function AiDialog({
  open,
  onOpenChange,
  kind,
  source,
  fixture,
  onResult,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: ScriptKind;
  source?: string;
  fixture?: string;
  onResult: (source: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    summary: string;
    error: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"change" | "new">(source ? "change" : "new");
  useEffect(() => setMode(source ? "change" : "new"), [source, open]);
  const go = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await post<{
        source: string;
        summary: string;
        error: string | null;
      }>("/ai/generate", {
        kind,
        prompt,
        source: mode === "change" ? source : undefined,
        fixture,
      });
      onResult(r.source);
      setResult(r);
      setPrompt("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={
        mode === "change" ? "Change with AI" : `Write a new ${kind} with AI`
      }
      description="The AI writes the code; it appears in the editor and the preview right away. Nothing is saved until you press Save."
      wide
    >
      <div className="space-y-4">
        {source && (
          <div className="flex gap-2">
            {(["change", "new"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cx(
                  "rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                  mode === m
                    ? "bg-glow/15 text-glow ring-glow/50"
                    : "text-muted ring-line",
                )}
              >
                {m === "change" ? "Change the current code" : "Start over"}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          autoFocus
          placeholder={
            mode === "change"
              ? "Make it slower and add a second colour that sparkles"
              : IDEAS[kind][0]
          }
          className="w-full resize-none rounded-xl bg-night p-3 text-sm ring-1 ring-line placeholder:text-muted/70 focus:ring-glow/60 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim())
              go();
          }}
        />
        {mode === "new" && (
          <div className="flex flex-wrap gap-2">
            {IDEAS[kind].map((idea) => (
              <button
                key={idea}
                onClick={() => setPrompt(idea)}
                className="rounded-full bg-raised px-3 py-1.5 text-xs text-soft hover:text-white"
              >
                {idea}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">
            {error}
          </p>
        )}
        {result && (
          <div className="rounded-xl bg-raised px-4 py-3 text-sm">
            <p>{result.summary}</p>
            {result.error && (
              <p className="mt-2 font-mono text-xs text-bad">
                Still failing: {result.error}
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          {result && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
          <Button
            variant="primary"
            disabled={busy || !prompt.trim()}
            onClick={go}
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Wand2 size={16} />
            )}
            {busy
              ? "Writing… (this can take a minute)"
              : mode === "change"
                ? "Change it"
                : "Write it"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
