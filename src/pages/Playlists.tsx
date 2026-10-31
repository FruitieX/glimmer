import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  ListMusic,
  Plus,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import {
  del,
  post,
  put,
  seasonLabel,
  type FixtureLayout,
  type Playlist,
  type PlaylistEntry,
  type Season,
} from "../api";
import { GRID, useGallery, type Gallery } from "../live";
import { useApp } from "../main";
import { Mirror } from "../components/Mirror";
import { EffectCard } from "../components/EffectCard";
import { CategoryChips, groupByCategory } from "../components/Categories";
import {
  Badge,
  Button,
  Card,
  cx,
  Dialog,
  Field,
  Input,
  Select,
  Toggle,
  useAction,
} from "../components/ui";

/** A small live thumbnail of one effect. */
function Thumb({
  scriptId,
  frames,
  layout,
  className,
}: {
  scriptId: string;
  frames: Gallery;
  layout: FixtureLayout;
  className?: string;
}) {
  const source = useCallback(() => frames.get(scriptId), [frames, scriptId]);
  const onVisible = useCallback(
    (on: boolean) => frames.watch(scriptId, on),
    [frames, scriptId],
  );
  useEffect(() => () => frames.watch(scriptId, false), [frames, scriptId]);
  return (
    <div className={cx("bg-gradient-to-b from-night to-ink", className)}>
      <Mirror
        points={layout.points}
        aspect={layout.aspect}
        source={source}
        className="h-full"
        dot={0.8}
        onVisible={onVisible}
      />
    </div>
  );
}

/** Thumbnails render on the first mapped light, like the effect gallery. */
export function useThumbnails(fixtureId?: string) {
  const { state } = useApp();
  const light = fixtureId
    ? state.fixtures.find((f) => f.fixture.id === fixtureId)
    : state.fixtures.find((f) => f.layout?.points.length);
  const layout = light?.layout?.points.length
    ? light.layout
    : { points: GRID, aspect: 1 };
  return { layout, frames: useGallery("effect", light?.fixture.id) };
}

/** A playlist to pick or open, showing its first enabled effect. */
export function PlaylistCard({
  playlist,
  frames,
  layout,
  active,
  onClick,
}: {
  playlist: Playlist;
  frames: Gallery;
  layout: FixtureLayout;
  active?: boolean;
  onClick: () => void;
}) {
  const { state } = useApp();
  const on = playlist.entries.filter((e) => e.enabled);
  const playingOn = state.fixtures
    .filter((f) => f.state.playlistId === playlist.id)
    .map((f) => f.fixture.name);
  return (
    <button
      onClick={onClick}
      className={cx(
        "group overflow-hidden rounded-2xl text-left ring-1 transition",
        active
          ? "bg-glow/10 ring-glow/60"
          : "bg-panel/80 ring-line hover:ring-glow/30",
      )}
    >
      {on[0] ? (
        <Thumb
          scriptId={on[0].scriptId}
          frames={frames}
          layout={layout}
          className="h-28"
        />
      ) : (
        <div className="flex h-28 items-center justify-center bg-night text-muted">
          <ListMusic size={28} />
        </div>
      )}
      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{playlist.name}</span>
          {active && <Check size={16} className="shrink-0 text-glow" />}
        </div>
        <p className="mt-1 truncate text-xs text-muted">
          {on.length} {on.length === 1 ? "effect" : "effects"}
          {playlist.season && ` · ${seasonLabel(playlist.season)}`}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {playlist.season && playlist.autoEnabled && (
            <Badge tone="glow">
              <CalendarClock size={11} /> Scheduled
            </Badge>
          )}
          {playlist.shuffle && (
            <Badge>
              <Shuffle size={11} /> Shuffle
            </Badge>
          )}
          {playingOn.length > 0 && (
            <Badge tone="ok">On {playingOn.join(", ")}</Badge>
          )}
        </div>
      </div>
    </button>
  );
}

const heading = "text-[13px] font-semibold tracking-wide text-muted uppercase";

export function PlaylistsPage() {
  const { state } = useApp();
  const { layout, frames } = useThumbnails();
  const [editing, setEditing] = useState<Playlist | "new" | null>(null);
  const seasonal = state.playlists.filter((p) => p.season);
  const other = state.playlists.filter((p) => !p.season);
  const grid = (list: Playlist[]) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {list.map((p) => (
        <PlaylistCard
          key={p.id}
          playlist={p}
          frames={frames}
          layout={layout}
          onClick={() => setEditing(p)}
        />
      ))}
    </div>
  );
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
          <p className="mt-1 text-sm text-muted">
            Effects that take turns. Scheduled ones put themselves on when their
            season starts and step aside when it ends.
          </p>
        </div>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus size={16} /> New
        </Button>
      </div>
      {other.length > 0 && (
        <section className="space-y-3">
          <h2 className={heading}>Any time</h2>
          {grid(other)}
        </section>
      )}
      {seasonal.length > 0 && (
        <section className="space-y-3">
          <h2 className={heading}>Seasonal</h2>
          {grid(seasonal)}
        </section>
      )}
      {editing && (
        <Dialog
          open
          wide
          onOpenChange={(v) => !v && setEditing(null)}
          title={editing === "new" ? "New playlist" : editing.name}
          description="Effects play one after another, each for its own time."
        >
          <PlaylistEditor
            playlist={editing === "new" ? null : editing}
            frames={frames}
            layout={layout}
            onDone={() => setEditing(null)}
          />
        </Dialog>
      )}
    </div>
  );
}

type SeasonKind = "none" | "dates" | "easter" | "midsummer";

function seasonKind(s: Season | null): SeasonKind {
  if (!s) return "none";
  if ("from" in s) return "dates";
  return "easter" in s ? "easter" : "midsummer";
}

const smallInput =
  "h-8 rounded-lg bg-night px-2 text-xs text-white ring-1 ring-line focus:ring-glow/60 focus:outline-none";

function PlaylistEditor({
  playlist,
  frames,
  layout,
  onDone,
}: {
  playlist: Playlist | null;
  frames: Gallery;
  layout: FixtureLayout;
  onDone: () => void;
}) {
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const [name, setName] = useState(playlist?.name ?? "");
  const [entries, setEntries] = useState<PlaylistEntry[]>(
    playlist?.entries ?? [],
  );
  const [shuffle, setShuffle] = useState(playlist?.shuffle ?? true);
  const [season, setSeason] = useState<Season | null>(playlist?.season ?? null);
  const [autoEnabled, setAutoEnabled] = useState(playlist?.autoEnabled ?? true);
  const [lights, setLights] = useState<string[] | null>(
    playlist?.lights ?? null,
  );
  const [adding, setAdding] = useState(false);
  const effects = state.scripts.filter((s) => s.kind === "effect");
  const groups = groupByCategory(effects);
  const [category, setCategory] = useState(groups[0]?.[0] ?? "Basics");
  const kind = seasonKind(season);

  const update = (i: number, patch: Partial<PlaylistEntry>) =>
    setEntries(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, by: number) => {
    const next = [...entries];
    const [e] = next.splice(i, 1);
    next.splice(i + by, 0, e);
    setEntries(next);
  };
  const offsets = (s: Season | null): [number, number] =>
    s && "easter" in s
      ? s.easter
      : s && "midsummer" in s
        ? s.midsummer
        : [0, 0];

  const save = async () => {
    const body = { name, entries, shuffle, season, autoEnabled, lights };
    const ok = await run(
      () =>
        playlist
          ? put(`/playlists/${encodeURIComponent(playlist.id)}`, body)
          : post("/playlists", body),
      "Playlist saved",
    );
    if (ok) {
      await reload();
      onDone();
    }
  };

  return (
    <div className="space-y-6">
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cosy evenings"
        />
      </Field>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-soft">Effects</span>
          <label className="flex items-center gap-2 text-sm text-soft">
            <Shuffle size={14} className="text-muted" /> Shuffle
            <Toggle label="Shuffle" checked={shuffle} onChange={setShuffle} />
          </label>
        </div>
        {entries.length === 0 && (
          <p className="text-sm text-muted">No effects yet.</p>
        )}
        <ol className="space-y-2">
          {entries.map((e, i) => {
            const script = effects.find((s) => s.id === e.scriptId);
            const label = script?.name ?? e.scriptId;
            return (
              <li
                key={i}
                className={cx(
                  "space-y-2 rounded-xl bg-night/60 p-2.5 ring-1 ring-line",
                  !e.enabled && "opacity-60",
                )}
              >
                <div className="flex items-center gap-3">
                  <Thumb
                    scriptId={e.scriptId}
                    frames={frames}
                    layout={layout}
                    className="h-11 w-16 shrink-0 overflow-hidden rounded-lg"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {label}
                  </span>
                  <Toggle
                    label={`Play ${label}`}
                    checked={e.enabled}
                    onChange={(v) => update(i, { enabled: v })}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`${label} preset`}
                    className={cx(smallInput, "min-w-0 flex-1")}
                    value={e.presetId ?? ""}
                    onChange={(ev) => {
                      const preset = state.presets.find(
                        (p) => p.id === ev.target.value,
                      );
                      update(
                        i,
                        preset
                          ? {
                              presetId: preset.id,
                              scriptId: preset.look.scriptId,
                              params: preset.look.params,
                              colors: preset.look.colors,
                            }
                          : { presetId: null },
                      );
                    }}
                  >
                    <option value="">Default settings</option>
                    {state.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        Preset: {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    aria-label={`${label} seconds`}
                    className={cx(smallInput, "w-16 text-right")}
                    value={e.durationS}
                    onChange={(ev) =>
                      update(i, {
                        durationS: Math.max(1, Number(ev.target.value) || 1),
                      })
                    }
                  />
                  <span className="text-xs text-muted">s</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2"
                    aria-label={`Move ${label} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2"
                    aria-label={`Move ${label} down`}
                    disabled={i === entries.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2"
                    aria-label={`Remove ${label}`}
                    onClick={() =>
                      setEntries(entries.filter((_, j) => j !== i))
                    }
                  >
                    <X size={14} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        {adding ? (
          <Card className="space-y-3 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Add an effect</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Close the effect picker"
                onClick={() => setAdding(false)}
              >
                <X size={14} />
              </Button>
            </div>
            <CategoryChips
              groups={groups}
              value={category}
              onChange={setCategory}
              all={false}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(groups.find(([c]) => c === category)?.[1] ?? []).map((s) => (
                <EffectCard
                  key={s.id}
                  script={s}
                  frames={frames}
                  layout={layout}
                  onClick={() => {
                    setEntries([
                      ...entries,
                      {
                        scriptId: s.id,
                        presetId: null,
                        params: {},
                        colors: [],
                        durationS: 60,
                        enabled: true,
                      },
                    ]);
                    setAdding(false);
                  }}
                />
              ))}
            </div>
          </Card>
        ) : (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add effect
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <Field label="Season">
          <Select
            label="Season"
            value={kind}
            onChange={(v) => {
              const k = v as SeasonKind;
              const [a, b] = offsets(season);
              setSeason(
                k === "none"
                  ? null
                  : k === "dates"
                    ? { from: "12-01", to: "12-31" }
                    : k === "easter"
                      ? { easter: [a, b] }
                      : { midsummer: [a, b] },
              );
            }}
            options={[
              { value: "none", label: "Any time" },
              { value: "dates", label: "Between two dates" },
              { value: "easter", label: "Around Easter" },
              { value: "midsummer", label: "Around Midsummer Eve" },
            ]}
          />
        </Field>
        {season && "from" in season && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From (MM-DD)">
              <Input
                value={season.from}
                inputMode="numeric"
                onChange={(e) => setSeason({ ...season, from: e.target.value })}
              />
            </Field>
            <Field label="To (MM-DD)">
              <Input
                value={season.to}
                inputMode="numeric"
                onChange={(e) => setSeason({ ...season, to: e.target.value })}
              />
            </Field>
          </div>
        )}
        {season && !("from" in season) && (
          <div className="grid grid-cols-2 gap-3">
            {(["From", "To"] as const).map((label, i) => (
              <Field key={label} label={`${label} (days)`}>
                <Input
                  type="number"
                  value={offsets(season)[i]}
                  onChange={(e) => {
                    const days = [...offsets(season)] as [number, number];
                    days[i] = Number(e.target.value) || 0;
                    setSeason(
                      "easter" in season
                        ? { easter: days }
                        : { midsummer: days },
                    );
                  }}
                />
              </Field>
            ))}
          </div>
        )}
        {season && <p className="text-xs text-muted">{seasonLabel(season)}</p>}
      </div>

      {season && (
        <div className="space-y-3 rounded-xl bg-night/60 p-4 ring-1 ring-line">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Start by itself</span>
              <span className="block text-xs text-muted">
                At midnight on the first day the lights switch to it, and on the
                day after the last they go back to what they showed, unless
                someone picked something else meanwhile. Power isn't touched.
              </span>
            </span>
            <Toggle
              label="Schedule"
              checked={autoEnabled}
              onChange={setAutoEnabled}
            />
          </label>
          {autoEnabled && (
            <div className="space-y-2">
              <label className="flex items-center gap-3 text-sm text-soft">
                <Toggle
                  label="All lights"
                  checked={lights === null}
                  onChange={(v) => setLights(v ? null : [])}
                />
                All lights
              </label>
              {lights !== null && (
                <div className="flex flex-wrap gap-2">
                  {state.fixtures.map(({ fixture }) => {
                    const on = lights.includes(fixture.id);
                    return (
                      <button
                        key={fixture.id}
                        onClick={() =>
                          setLights(
                            on
                              ? lights.filter((l) => l !== fixture.id)
                              : [...lights, fixture.id],
                          )
                        }
                        className={cx(
                          "rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition",
                          on
                            ? "bg-glow/15 text-glow ring-glow/50"
                            : "text-muted ring-line hover:text-white",
                        )}
                      >
                        {fixture.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || !name.trim()}
          onClick={save}
        >
          Save playlist
        </Button>
        {playlist && (
          <Button
            variant="danger"
            className="ml-auto"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`Delete the ${playlist.name} playlist?`)) return;
              if (
                await run(
                  () => del(`/playlists/${encodeURIComponent(playlist.id)}`),
                  "Playlist deleted",
                )
              ) {
                await reload();
                onDone();
              }
            }}
          >
            <Trash2 size={14} /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
