import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  CalendarClock,
  Check,
  ListMusic,
  Pencil,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { nextPresetName, saveNamedByAi, SuggestLooks } from "../components/Ai";
import {
  colorValues,
  dayLabel,
  del,
  paramValues,
  post,
  put,
  type FixtureState,
  type Playlist,
  type Preset,
} from "../api";
import { frames, useGallery, useStatus } from "../live";
import { EffectCard } from "../components/EffectCard";
import {
  categoryOf,
  CategoryChips,
  groupByCategory,
} from "../components/Categories";
import { PlaylistCard } from "./Playlists";
import { Link, useApp } from "../main";
import { Mirror } from "../components/Mirror";
import { ColorControls, ParamControls } from "../components/controls";
import { LookChips } from "../components/Looks";
import {
  Badge,
  Button,
  Card,
  cx,
  Dialog,
  Field,
  Input,
  Section,
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
  const { state, reload } = useApp();
  const { fixture, layout } = item;
  const send = useFixtureSender(fixture.id);
  const status = useStatus()[fixture.deviceId];
  const device = state.devices.find((d) => d.id === fixture.deviceId);
  const effects = state.scripts.filter((s) => s.kind === "effect");
  const script = state.scripts.find((s) => s.id === item.state.look.scriptId);
  const meta = script?.meta;
  const { run, busy } = useAction();
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
  // The playlist entry on now, and whether its colours or settings were
  // changed here (which lasts only for this turn unless saved).
  const entryIndex = item.playing?.entry ?? null;
  const entry =
    playlist && entryIndex != null ? playlist.entries[entryIndex] : undefined;
  const entryLook = entry
    ? (state.presets.find((p) => p.id === entry.presetId)?.look ?? {
        scriptId: entry.scriptId,
        params: entry.params ?? {},
        colors: entry.colors ?? [],
      })
    : undefined;
  const tweaked =
    !!entryLook &&
    entryLook.scriptId === item.state.look.scriptId &&
    (sameJson(entryLook.params, item.state.look.params) === false ||
      sameJson(
        entryLook.colors.map((c) => c.toLowerCase()),
        item.state.look.colors.map((c) => c.toLowerCase()),
      ) === false);

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
        <Link
          to={`/lights/${encodeURIComponent(fixture.id)}/settings`}
          aria-label={`${fixture.name} settings`}
          className="rounded-xl p-2 text-muted hover:bg-raised hover:text-white"
        >
          <Settings2 size={16} />
        </Link>
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
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={busy}
                onClick={() =>
                  // Picking the effect on now keeps it, without the playlist.
                  run(() => send({ scriptId: item.state.look.scriptId }))
                }
              >
                <Square size={12} /> Stop playlist
              </Button>
            </p>
          )}
          {playlist && entry && tweaked && entryIndex != null && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-glow/5 px-4 py-2.5 text-xs text-soft">
              <span className="flex-1">
                Your changes last until {playlist.name} moves on.
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const entries = playlist.entries.map((e, i) =>
                      i === entryIndex
                        ? {
                            ...e,
                            presetId: null,
                            params: item.state.look.params,
                            colors: item.state.look.colors,
                          }
                        : e,
                    );
                    await put(`/playlists/${encodeURIComponent(playlist.id)}`, {
                      ...playlist,
                      entries,
                    });
                    reload();
                  }, `Saved to ${playlist.name}`)
                }
              >
                <ListMusic size={13} /> Save to {playlist.name}
              </Button>
            </div>
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
        entry={
          playlist && entry && entryIndex != null && tweaked
            ? { playlist, index: entryIndex }
            : undefined
        }
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
                // The effect on now; while a playlist plays, "Stop playlist"
                // keeps it instead of tapping it here.
                const active = e.id === item.state.look.scriptId;
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
          <Card className="space-y-5 p-5">
            <LookChips
              meta={meta}
              params={params}
              colors={colors}
              disabled={busy}
              onPick={(look) => {
                setParams(paramValues(meta, look.params));
                setColors(colorValues(meta, look.colors));
                run(() =>
                  send({
                    params: look.params,
                    replaceParams: true,
                    colors: look.colors,
                  }),
                );
              }}
            />
            <ParamControls
              params={meta.params}
              values={params}
              onChange={(k, v) => {
                const next = { ...params, [k]: v };
                setParams(next);
                sendParams({ [k]: v });
              }}
            />
            {script && (
              <div className="border-t border-line pt-5">
                <SuggestLooks
                  key={script.id}
                  scriptId={script.id}
                  meta={meta}
                  params={item.state.look.params}
                  colors={colors}
                  fixtureId={fixture.id}
                  aspect={layout?.aspect ?? 1}
                  tryLabel={`Show on ${fixture.name}`}
                  wide
                  onTry={(look) => {
                    setParams(paramValues(meta, look.params));
                    setColors(colorValues(meta, look.colors));
                    run(() =>
                      send({
                        params: look.params,
                        replaceParams: true,
                        colors: look.colors,
                      }),
                    );
                  }}
                />
              </div>
            )}
          </Card>
        </Section>
      )}
    </div>
  );
}

function Presets({
  fixtureId,
  presets,
  active,
  look,
  entry,
}: {
  fixtureId: string;
  presets: Preset[];
  active?: Preset;
  look: FixtureState["look"];
  /** The playing playlist entry, when this look changed it. */
  entry?: { playlist: Playlist; index: number };
}) {
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [useInPlaylist, setUseInPlaylist] = useState(true);
  const [editing, setEditing] = useState<Preset | null>(null);
  /** Makes a new preset the look of the playing playlist entry, if asked. */
  const applyToEntry = async (preset: Preset) => {
    if (!entry || !useInPlaylist) return;
    const { playlist, index } = entry;
    await put(`/playlists/${encodeURIComponent(playlist.id)}`, {
      ...playlist,
      entries: playlist.entries.map((e, i) =>
        i === index
          ? {
              ...e,
              presetId: preset.id,
              scriptId: look.scriptId,
              params: look.params,
              colors: look.colors,
            }
          : e,
      ),
    });
  };
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
            const ok = await run(async () => {
              const preset = await post<Preset>("/presets", { name, look });
              await applyToEntry(preset);
              return true;
            }, "Preset saved");
            if (ok) {
              setSaving(false);
              setName("");
              reload();
            }
          }}
        >
          <Field
            label="Name"
            hint={`Leave it empty for “${nextPresetName(presets)}”.`}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={nextPresetName(presets)}
              autoFocus
            />
          </Field>
          {entry && (
            <label className="flex items-center gap-3 text-sm text-soft">
              <Toggle
                label={`Use it in ${entry.playlist.name}`}
                checked={useInPlaylist}
                onChange={setUseInPlaylist}
              />
              Use it for this effect in {entry.playlist.name}
            </label>
          )}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant="primary"
              className="w-full sm:flex-1"
              disabled={busy}
            >
              Save preset
            </Button>
            {state.ai && (
              <Button
                type="button"
                className="w-full sm:flex-1"
                disabled={busy}
                onClick={() => {
                  // The dialog closes at once; the name follows later.
                  setSaving(false);
                  setName("");
                  run(async () => {
                    const preset = await saveNamedByAi(look);
                    await applyToEntry(preset);
                    reload();
                  }, "Saved; the AI is naming it");
                }}
              >
                <Wand2 size={16} /> Name it with AI
              </Button>
            )}
          </div>
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

/** Deep equality of plain JSON values, ignoring key order. */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([x], [y]) => (x < y ? -1 : 1))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
