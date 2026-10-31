import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  CalendarClock,
  Check,
  ListMusic,
  Pencil,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  colorValues,
  dayLabel,
  del,
  paramValues,
  post,
  put,
  type Fixture,
  type FixtureState,
  type LayoutMode,
  type Preset,
  type TransitionSpec,
} from "../api";
import { frames, useGallery, useStatus } from "../live";
import { EffectCard } from "../components/EffectCard";
import {
  categoryOf,
  CategoryChips,
  groupByCategory,
} from "../components/Categories";
import { DeviceSettingsDialog } from "./DeviceSettings";
import { PlaylistCard } from "./Playlists";
import { Link, useApp, useRoute } from "../main";
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
  Toggle,
  useAction,
} from "../components/ui";
import { outputLabel, statusTone, useThrottled } from "./Lights";

function useFixtureSender(id: string) {
  return useCallback(
    (patch: Record<string, unknown>) =>
      post<FixtureState>(`/fixtures/${encodeURIComponent(id)}/state`, patch),
    [id],
  );
}

export function LightPage({ id }: { id: string }) {
  const { state } = useApp();
  const item = state.fixtures.find((f) => f.fixture.id === id);
  if (!item) {
    return (
      <div className="py-20 text-center text-muted">
        This light doesn't exist.{" "}
        <Link to="/" className="text-glow">
          Back to lights
        </Link>
      </div>
    );
  }
  return <Light key={id} item={item} />;
}

function Light({
  item,
}: {
  item: ReturnType<typeof useApp>["state"]["fixtures"][number];
}) {
  const { state } = useApp();
  const { fixture, layout } = item;
  const send = useFixtureSender(fixture.id);
  const status = useStatus()[fixture.deviceId];
  const device = state.devices.find((d) => d.id === fixture.deviceId);
  const effects = state.scripts.filter((s) => s.kind === "effect");
  const script = state.scripts.find((s) => s.id === item.state.look.scriptId);
  const meta = script?.meta;
  const { run } = useAction();
  const gallery = useGallery("effect", fixture.id);
  const groups = groupByCategory(effects);
  const [category, setCategory] = useState(() =>
    item.state.playlistId
      ? "Playlists"
      : script
        ? categoryOf(script)
        : (groups[0]?.[0] ?? "Basics"),
  );
  const playlist = state.playlists.find((p) => p.id === item.state.playlistId);
  const scheduled = item.state.scheduled;
  const [settings, setSettings] = useState(false);

  // Local copies so sliders feel instant; the server echo replaces them.
  const [power, setPower] = useState(item.state.power);
  const [brightness, setBrightness] = useState(item.state.brightness);
  const [params, setParams] = useState(() =>
    paramValues(meta, item.state.look.params),
  );
  const [colors, setColors] = useState(() =>
    colorValues(meta, item.state.look.colors),
  );
  useEffect(() => setPower(item.state.power), [item.state.power]);
  useEffect(
    () => setBrightness(item.state.brightness),
    [item.state.brightness],
  );
  const lookKey = JSON.stringify(item.state.look);
  useEffect(() => {
    setParams(paramValues(meta, item.state.look.params));
    setColors(colorValues(meta, item.state.look.colors));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, meta]);

  const sendBrightness = useThrottled(
    useCallback((v: number) => send({ brightness: v }), [send]),
  );
  const sendParams = useThrottled(
    useCallback((p: Record<string, unknown>) => send({ params: p }), [send]),
  );
  const sendColors = useThrottled(
    useCallback((c: string[]) => send({ colors: c }), [send]),
  );
  const source = useCallback(() => frames.get(fixture.id), [fixture.id]);
  const preset = state.presets.find((p) => p.id === item.state.presetId);
  const error = status?.fixtureErrors?.[fixture.id];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="rounded-xl p-2 text-muted hover:bg-raised hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {fixture.name}
          </h1>
          <p className="text-sm text-muted">
            {device?.name} · LEDs {fixture.start}–
            {fixture.start + fixture.count - 1}
          </p>
        </div>
        <Badge
          tone={
            device?.enabled
              ? statusTone(status?.output, status?.online)
              : "muted"
          }
        >
          {device?.enabled
            ? outputLabel(status?.output, status?.online)
            : "Disabled"}
          {status?.output === "live" &&
            status.fps > 0 &&
            ` · ${status.fps.toFixed(0)} fps`}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${device?.name ?? fixture.name} settings`}
          onClick={() => setSettings(true)}
        >
          <Settings2 size={16} />
        </Button>
        {settings && (
          <DeviceSettingsDialog
            deviceId={fixture.deviceId}
            onClose={() => setSettings(false)}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-b from-night to-ink">
            {layout?.points.length ? (
              <Mirror
                points={layout.points}
                aspect={layout.aspect}
                source={source}
                className="h-72 sm:h-96"
                dot={1.15}
              />
            ) : (
              <div className="flex h-72 items-center justify-center text-sm text-muted">
                No LEDs read yet
              </div>
            )}
          </div>
          {error && (
            <p className="border-t border-line bg-bad/5 px-4 py-2.5 font-mono text-xs text-bad">
              {error}
            </p>
          )}
          {playlist && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
              <ListMusic size={14} className="text-glow" />
              <span className="font-medium text-soft">{playlist.name}</span>·
              <span>{script?.name ?? item.state.look.scriptId}</span>
              {item.playing?.entry != null && (
                <span>
                  ({item.playing.entry + 1} of {playlist.entries.length})
                </span>
              )}
              {scheduled?.playlistId === playlist.id && (
                <Badge tone="glow">
                  <CalendarClock size={11} /> {playlist.name} · until{" "}
                  {dayLabel(scheduled.until)}
                </Badge>
              )}
            </p>
          )}
          {status?.movie && (
            <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
              Movie: {status.movie}
            </p>
          )}
        </Card>
        <Card className="space-y-6 p-5">
          <div className="flex items-center justify-between">
            <span className="font-medium">Power</span>
            <Toggle
              label="Power"
              checked={power}
              disabled={!device?.enabled}
              onChange={(v) => {
                setPower(v);
                run(() => send({ power: v }));
              }}
            />
          </div>
          <div>
            <div className="flex justify-between text-sm">
              <span className="font-medium">Brightness</span>
              <span className="font-mono text-xs text-muted tabular-nums">
                {Math.round(brightness * 100)}%
              </span>
            </div>
            <Slider
              label="Brightness"
              value={brightness}
              onChange={(v) => {
                setBrightness(v);
                sendBrightness(v);
              }}
            />
          </div>
          {meta && meta.colors.length > 0 && (
            <div className="space-y-3">
              <span className="text-sm font-medium">Colours</span>
              <ColorControls
                slots={meta.colors}
                values={colors}
                onChange={(c) => {
                  setColors(c);
                  sendColors(c);
                }}
              />
            </div>
          )}
        </Card>
      </div>

      <Presets
        fixtureId={fixture.id}
        presets={state.presets}
        active={preset}
        look={item.state.look}
      />

      <Section title="Effect">
        <CategoryChips
          groups={[["Playlists", state.playlists], ...groups]}
          value={category}
          onChange={setCategory}
          all={false}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {layout?.points.length && category === "Playlists"
            ? state.playlists.map((p) => {
                const active = p.id === item.state.playlistId;
                return (
                  <PlaylistCard
                    key={p.id}
                    playlist={p}
                    frames={gallery}
                    layout={layout}
                    active={active}
                    onClick={() =>
                      !active &&
                      run(() => send({ playlist: p.id, power: true }))
                    }
                  />
                );
              })
            : null}
          {layout?.points.length && category !== "Playlists"
            ? (groups.find(([c]) => c === category)?.[1] ?? []).map((e) => {
                // While a playlist plays, picking its effect keeps it instead.
                const active =
                  e.id === item.state.look.scriptId && !item.state.playlistId;
                return (
                  <EffectCard
                    key={e.id}
                    script={e}
                    frames={gallery}
                    layout={layout}
                    active={active}
                    badge={
                      active ? (
                        <Check size={16} className="shrink-0 text-glow" />
                      ) : (
                        !e.builtin && (
                          <Sparkles
                            size={14}
                            className="shrink-0 text-glow-2"
                          />
                        )
                      )
                    }
                    onClick={() =>
                      !active &&
                      run(() => send({ scriptId: e.id, power: true }))
                    }
                  />
                );
              })
            : null}
        </div>
      </Section>

      {meta && (
        <Section
          title={`${meta.name} settings`}
          action={
            script && (
              <Link to={`/effects/${encodeURIComponent(script.id)}`}>
                <Button size="sm" variant="ghost">
                  <Pencil size={14} />{" "}
                  {script.builtin ? "View code" : "Edit code"}
                </Button>
              </Link>
            )
          }
        >
          <Card className="p-5">
            <ParamControls
              params={meta.params}
              values={params}
              onChange={(k, v) => {
                const next = { ...params, [k]: v };
                setParams(next);
                sendParams({ [k]: v });
              }}
            />
          </Card>
        </Section>
      )}

      <Transitions fixture={fixture} />
      <LedSettings fixture={fixture} />
    </div>
  );
}

function Presets({
  fixtureId,
  presets,
  active,
  look,
}: {
  fixtureId: string;
  presets: Preset[];
  active?: Preset;
  look: FixtureState["look"];
}) {
  const { reload } = useApp();
  const { run, busy } = useAction();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Preset | null>(null);
  return (
    <Section
      title="Presets"
      action={
        <Button size="sm" onClick={() => setSaving(true)}>
          <Bookmark size={14} /> Save current look
        </Button>
      }
    >
      {presets.length ? (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <div key={p.id} className="group flex">
              <button
                onClick={() =>
                  run(() =>
                    post(`/fixtures/${encodeURIComponent(fixtureId)}/state`, {
                      preset: p.id,
                      power: true,
                    }),
                  )
                }
                className={cx(
                  "rounded-l-full py-2 pr-2 pl-4 text-sm font-medium ring-1 transition",
                  active?.id === p.id
                    ? "bg-glow/15 text-glow ring-glow/50"
                    : "bg-panel text-soft ring-line hover:text-white",
                )}
              >
                {p.name}
              </button>
              <button
                onClick={() => setEditing(p)}
                aria-label={`Edit ${p.name}`}
                className={cx(
                  "rounded-r-full py-2 pr-3 pl-1.5 ring-1 transition",
                  active?.id === p.id
                    ? "bg-glow/15 text-glow ring-glow/50"
                    : "bg-panel text-muted ring-line hover:text-white",
                )}
              >
                <Pencil size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Save looks you like as presets. homectl scenes can then pick them by
          name.
        </p>
      )}
      <Dialog
        open={saving}
        onOpenChange={setSaving}
        title="Save as preset"
        description="Saves the effect, its settings and colours."
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(
              () => post("/presets", { name, look }),
              "Preset saved",
            );
            if (ok) {
              setSaving(false);
              setName("");
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
            Save preset
          </Button>
        </form>
      </Dialog>
      {editing && (
        <Dialog
          open
          onOpenChange={(v) => !v && setEditing(null)}
          title={`Preset: ${editing.name}`}
        >
          <PresetEditor
            preset={editing}
            look={look}
            onDone={() => setEditing(null)}
          />
        </Dialog>
      )}
    </Section>
  );
}

function PresetEditor({
  preset,
  look,
  onDone,
}: {
  preset: Preset;
  look: FixtureState["look"];
  onDone: () => void;
}) {
  const { reload } = useApp();
  const { run, busy } = useAction();
  const [name, setName] = useState(preset.name);
  return (
    <div className="space-y-4">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            if (
              await run(
                () => put(`/presets/${preset.id}`, { name, look: preset.look }),
                "Renamed",
              )
            ) {
              reload();
              onDone();
            }
          }}
        >
          Rename
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            if (
              await run(
                () => put(`/presets/${preset.id}`, { name, look }),
                "Preset updated",
              )
            ) {
              reload();
              onDone();
            }
          }}
        >
          Replace with current look
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            if (
              await run(() => del(`/presets/${preset.id}`), "Preset deleted")
            ) {
              reload();
              onDone();
            }
          }}
        >
          <Trash2 size={14} /> Delete
        </Button>
      </div>
    </div>
  );
}

function TransitionEditor({
  label,
  spec,
  onChange,
}: {
  label: string;
  spec: TransitionSpec;
  onChange: (s: TransitionSpec) => void;
}) {
  const { state } = useApp();
  const transitions = state.scripts.filter((s) => s.kind === "transition");
  const script = transitions.find((t) => t.id === spec.scriptId);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {(spec.durationMs / 1000).toFixed(1)} s
        </span>
      </div>
      <Select
        label={`${label} transition`}
        value={spec.scriptId}
        options={transitions.map((t) => ({ value: t.id, label: t.name }))}
        onChange={(v) => onChange({ ...spec, scriptId: v, params: {} })}
      />
      <Slider
        label={`${label} duration`}
        value={spec.durationMs}
        min={0}
        max={6000}
        step={100}
        onChange={(v) => onChange({ ...spec, durationMs: v })}
      />
      {script && Object.keys(script.meta.params).length > 0 && (
        <ParamControls
          params={script.meta.params}
          values={paramValues(script.meta, spec.params)}
          onChange={(k, v) =>
            onChange({ ...spec, params: { ...(spec.params ?? {}), [k]: v } })
          }
        />
      )}
    </Card>
  );
}

function Transitions({ fixture }: { fixture: Fixture }) {
  const { reload } = useApp();
  const { run } = useAction();
  const [t, setT] = useState(fixture.transitions);
  useEffect(() => setT(fixture.transitions), [fixture.transitions]);
  const save = useThrottled(
    useCallback(
      async (next: Fixture["transitions"]) => {
        await put(`/fixtures/${encodeURIComponent(fixture.id)}`, {
          ...fixture,
          transitions: next,
        });
        reload();
      },
      [fixture, reload],
    ),
    500,
  );
  const update = (key: keyof Fixture["transitions"]) => (s: TransitionSpec) => {
    const next = { ...t, [key]: s };
    setT(next);
    save(next);
  };
  const preview = (patch: Record<string, unknown>) =>
    run(() => post(`/fixtures/${encodeURIComponent(fixture.id)}/state`, patch));
  return (
    <Section
      title="Transitions"
      action={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => preview({ power: false })}
          >
            Try off
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => preview({ power: true })}
          >
            Try on
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-3">
        <TransitionEditor
          label="Turning on"
          spec={t.on}
          onChange={update("on")}
        />
        <TransitionEditor
          label="Turning off"
          spec={t.off}
          onChange={update("off")}
        />
        <TransitionEditor
          label="Changing effect"
          spec={t.change}
          onChange={update("change")}
        />
      </div>
    </Section>
  );
}

function LedSettings({ fixture }: { fixture: Fixture }) {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const { run, busy } = useAction();
  const device = state.devices.find((d) => d.id === fixture.deviceId);
  const [draft, setDraft] = useState(fixture);
  useEffect(() => setDraft(fixture), [fixture]);
  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(fixture),
    [draft, fixture],
  );
  const mode = draft.layout.kind;
  const siblings = state.fixtures.filter(
    (f) => f.fixture.deviceId === fixture.deviceId,
  ).length;
  return (
    <Section title="LEDs and layout">
      <Card className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field
            label="MQTT id"
            hint="homectl sees the light under this id; it can't be changed."
          >
            <Input value={draft.id} disabled />
          </Field>
          <Field label="First LED">
            <Input
              type="number"
              min={0}
              value={draft.start}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  start: Math.max(0, Number(e.target.value)),
                })
              }
            />
          </Field>
          <Field
            label="Number of LEDs"
            hint={
              device ? `${device.name} has ${device.ledCount} LEDs.` : undefined
            }
          >
            <Input
              type="number"
              min={1}
              value={draft.count}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  count: Math.max(1, Number(e.target.value)),
                })
              }
            />
          </Field>
          <Field label="Positions" hint="Where effects think each LED is.">
            <Select
              label="Positions"
              value={mode}
              options={[
                { value: "device", label: "Mapped in the Twinkly app" },
                { value: "linear", label: "A straight line" },
                { value: "grid", label: "Hanging strands" },
              ]}
              onChange={(v) => {
                const layout: LayoutMode =
                  v === "grid"
                    ? { kind: "grid", strand: 21, zigzag: false }
                    : ({ kind: v } as LayoutMode);
                setDraft({ ...draft, layout });
              }}
            />
          </Field>
          {draft.layout.kind === "grid" && (
            <Field label="LEDs per strand">
              <Input
                type="number"
                min={1}
                value={draft.layout.strand}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    layout: {
                      kind: "grid",
                      strand: Math.max(1, Number(e.target.value)),
                      zigzag:
                        draft.layout.kind === "grid" && draft.layout.zigzag,
                    },
                  })
                }
              />
            </Field>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-3 text-sm text-soft">
            <Toggle
              label="Reversed"
              checked={draft.reversed}
              onChange={(v) => setDraft({ ...draft, reversed: v })}
            />
            Reverse LED order
          </label>
          {draft.layout.kind === "grid" && (
            <label className="flex items-center gap-3 text-sm text-soft">
              <Toggle
                label="Zigzag"
                checked={draft.layout.zigzag}
                onChange={(v) =>
                  draft.layout.kind === "grid" &&
                  setDraft({ ...draft, layout: { ...draft.layout, zigzag: v } })
                }
              />
              Strands alternate direction
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!changed || busy}
            onClick={async () => {
              if (
                await run(
                  () =>
                    put(`/fixtures/${encodeURIComponent(fixture.id)}`, draft),
                  "Saved",
                )
              )
                reload();
            }}
          >
            Save
          </Button>
          {changed && (
            <Button variant="ghost" onClick={() => setDraft(fixture)}>
              Undo changes
            </Button>
          )}
          {siblings > 1 && (
            <Button
              variant="danger"
              className="ml-auto"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    `Remove ${fixture.name}? Its LEDs will no longer be controlled.`,
                  )
                )
                  return;
                if (
                  await run(
                    () => del(`/fixtures/${encodeURIComponent(fixture.id)}`),
                    "Removed",
                  )
                ) {
                  await reload();
                  navigate("/");
                }
              }}
            >
              <Trash2 size={14} /> Remove light
            </Button>
          )}
        </div>
      </Card>
    </Section>
  );
}
