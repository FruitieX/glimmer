import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  Check,
  ListMusic,
  Play,
  Plus,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import {
  del,
  isLook,
  post,
  put,
  seasonLabel,
  type FixtureLayout,
  type Meta,
  type Playlist,
  type PlaylistEntry,
  type Season,
  type TransitionSpec,
} from "../api";
import { frames as frames0, GRID, useGallery, type Gallery } from "../live";
import { Link, useApp, useRoute } from "../main";
import { Mirror } from "../components/Mirror";
import { EffectCard, Thumb } from "../components/EffectCard";
import { TransitionList } from "../components/TransitionList";
import { CategoryChips, groupByCategory } from "../components/Categories";
import {
  Badge,
  Button,
  Card,
  cx,
  Field,
  Input,
  Select,
  Toggle,
  useAction,
} from "../components/ui";

/**
 * Thumbnails render on a light's layout: the first mapped light by default,
 * the 10 × 21 grid for "".
 */
export function useThumbnails(fixtureId?: string) {
  const { state } = useApp();
  const light =
    fixtureId === undefined
      ? state.fixtures.find((f) => f.layout?.points.length)
      : state.fixtures.find((f) => f.fixture.id === fixtureId);
  const layout = light?.layout?.points.length
    ? light.layout
    : { points: GRID, aspect: 1 };
  return { layout, frames: useGallery("effect", light?.fixture.id) };
}

/**
 * Which of a playlist's effects to preview: what a light playing it shows,
 * otherwise a different one every few seconds, starting at a random one
 * when the playlist shuffles.
 */
export function usePreviewEntry(
  playlistId: string | undefined,
  entries: PlaylistEntry[],
  shuffle: boolean,
): string | undefined {
  const { state } = useApp();
  const on = entries.filter((e) => e.enabled);
  const n = on.length;
  const [step, setStep] = useState(() =>
    shuffle ? Math.floor(Math.random() * 1e6) : 0,
  );
  useEffect(() => {
    if (n < 2) return;
    const timer = setInterval(
      () =>
        setStep((s) =>
          // A random other entry when shuffling, the next one otherwise.
          shuffle ? s + 1 + Math.floor(Math.random() * (n - 1)) : s + 1,
        ),
      6000,
    );
    return () => clearInterval(timer);
  }, [n, shuffle]);
  const playing = state.fixtures.find(
    (f) => playlistId && f.state.playlistId === playlistId && f.state.power,
  );
  if (playing) return playing.state.look.scriptId;
  return n ? on[step % n].scriptId : undefined;
}

/** A playlist to pick or open, previewing its effects in turn. */
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
  const enabledCount = playlist.entries.filter((e) => e.enabled).length;
  const preview = usePreviewEntry(
    playlist.id,
    playlist.entries,
    playlist.shuffle,
  );
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
      {preview ? (
        <Thumb
          scriptId={preview}
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
          {enabledCount} {enabledCount === 1 ? "effect" : "effects"}
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
  const { navigate } = useRoute();
  const { layout, frames } = useThumbnails();
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
          onClick={() => navigate(`/playlists/${encodeURIComponent(p.id)}`)}
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
        <Button variant="primary" onClick={() => navigate("/playlists/new")}>
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
    </div>
  );
}

/** One playlist, or a new one for `id` "new". */
export function PlaylistPage({ id }: { id: string }) {
  const { state } = useApp();
  const playlist = state.playlists.find((p) => p.id === id);
  if (id !== "new" && !playlist) {
    return (
      <div className="py-20 text-center text-muted">
        This playlist doesn't exist.{" "}
        <Link to="/playlists" className="text-glow">
          Back to playlists
        </Link>
      </div>
    );
  }
  return <PlaylistEditor playlist={playlist ?? null} />;
}

type SeasonKind = "none" | "dates" | "easter" | "midsummer";

function seasonKind(s: Season | null): SeasonKind {
  if (!s) return "none";
  if ("from" in s) return "dates";
  return "easter" in s ? "easter" : "midsummer";
}

const smallInput =
  "h-8 rounded-lg bg-night px-2 text-xs text-white ring-1 ring-line focus:ring-glow/60 focus:outline-none";

function PlaylistEditor({ playlist }: { playlist: Playlist | null }) {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const { run, busy } = useAction();
  const mapped = state.fixtures.filter((f) => f.layout?.points.length);
  // Previews render on a light playing this playlist, or the first mapped one.
  const [lightId, setLightId] = useState(
    () =>
      (
        mapped.find((f) => playlist && f.state.playlistId === playlist.id) ??
        mapped[0]
      )?.fixture.id ?? "",
  );
  const light = state.fixtures.find((f) => f.fixture.id === lightId);
  const { layout, frames } = useThumbnails(lightId);
  const device = state.devices.find((d) => d.id === light?.fixture.deviceId);
  const [name, setName] = useState(playlist?.name ?? "");
  const [entries, setEntries] = useState<PlaylistEntry[]>(
    playlist?.entries ?? [],
  );
  const [shuffle, setShuffle] = useState(playlist?.shuffle ?? true);
  const [transitions, setTransitions] = useState<TransitionSpec[]>(
    playlist?.transitions ?? [],
  );
  const transitionFrames = useGallery("transition", light?.fixture.id);
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

  const body = {
    name,
    entries,
    shuffle,
    transitions,
    season,
    autoEnabled,
    lights,
  };
  const dirty =
    !playlist ||
    // Only playlists with a season are scheduled.
    JSON.stringify({ ...body, autoEnabled: autoEnabled && !!season }) !==
      JSON.stringify({
        name: playlist.name,
        entries: playlist.entries,
        shuffle: playlist.shuffle,
        transitions: playlist.transitions,
        season: playlist.season,
        autoEnabled: playlist.autoEnabled,
        lights: playlist.lights,
      });

  /** Saves; a new playlist gets its own page. Returns its id when saved. */
  const save = async (message = "Playlist saved") => {
    const saved = await run(
      () =>
        playlist
          ? put<Playlist>(`/playlists/${encodeURIComponent(playlist.id)}`, body)
          : post<Playlist>("/playlists", body),
      message,
    );
    if (!saved) return undefined;
    await reload();
    if (!playlist)
      navigate(`/playlists/${encodeURIComponent(saved.id)}`, { replace: true });
    return saved.id;
  };

  const playing =
    !!playlist && !!light && light.state.playlistId === playlist.id;
  const play = async () => {
    if (!light) return;
    const id = dirty ? await save("Saved") : playlist?.id;
    if (!id) return;
    if (
      await run(
        () =>
          post(`/fixtures/${encodeURIComponent(light.fixture.id)}/state`, {
            playlist: id,
            power: true,
          }),
        `Playing on ${light.fixture.name}`,
      )
    )
      reload();
  };
  const first = usePreviewEntry(playlist?.id, entries, shuffle);
  const liveSource = useCallback(() => frames0.get(lightId), [lightId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/playlists"
          className="rounded-xl p-2 text-muted hover:bg-raised hover:text-white"
          aria-label="Back to playlists"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {playlist?.name ?? "New playlist"}
          </h1>
          <p className="truncate text-sm text-muted">
            Effects play one after another, each for its own time.
          </p>
        </div>
        <Button
          variant="primary"
          disabled={busy || !name.trim() || !dirty}
          onClick={() => save()}
        >
          Save
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start">
        <Card className="overflow-hidden lg:col-start-2 lg:row-start-1">
          {playing && light?.layout?.points.length ? (
            <div className="bg-gradient-to-b from-night to-ink">
              <Mirror
                points={light.layout.points}
                aspect={light.layout.aspect}
                source={liveSource}
                className="h-56"
              />
            </div>
          ) : first ? (
            <Thumb
              scriptId={first}
              frames={frames}
              layout={layout}
              className="h-56"
            />
          ) : (
            <div className="flex h-56 items-center justify-center bg-night text-muted">
              <ListMusic size={32} />
            </div>
          )}
          <div className="space-y-4 border-t border-line p-4">
            <Field
              label="Preview on"
              hint={
                playing
                  ? `Live: ${light?.fixture.name} is playing it.`
                  : "Thumbnails show each effect on this light."
              }
            >
              <Select
                label="Preview on"
                value={lightId}
                onChange={setLightId}
                options={[
                  ...mapped.map((f) => ({
                    value: f.fixture.id,
                    label: f.fixture.name,
                  })),
                  { value: "", label: "A 10 × 21 grid" },
                ]}
              />
            </Field>
            {light && (
              <Button
                className="w-full"
                variant={playing ? "primary" : "subtle"}
                disabled={
                  busy ||
                  playing ||
                  !device?.enabled ||
                  !name.trim() ||
                  !entries.some((e) => e.enabled)
                }
                onClick={play}
              >
                {playing ? <Check size={16} /> : <Play size={16} />}
                {playing
                  ? `Playing on ${light.fixture.name}`
                  : `Play on ${light.fixture.name}`}
              </Button>
            )}
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Cosy evenings"
              />
            </Field>
          </div>
        </Card>

        <div className="space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-soft">Effects</span>
              <label className="flex items-center gap-2 text-sm text-soft">
                <Shuffle size={14} className="text-muted" /> Shuffle
                <Toggle
                  label="Shuffle"
                  checked={shuffle}
                  onChange={setShuffle}
                />
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
                      "flex gap-3 rounded-xl bg-night/60 p-2.5 ring-1 ring-line",
                      !e.enabled && "opacity-60",
                    )}
                  >
                    <Thumb
                      scriptId={e.scriptId}
                      frames={frames}
                      layout={layout}
                      className="w-24 shrink-0 self-stretch overflow-hidden rounded-lg sm:w-32"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
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
                          className={cx(smallInput, "w-0 min-w-0 flex-1")}
                          value={settingsValue(e, script?.meta)}
                          onChange={(ev) => {
                            const value = ev.target.value;
                            const look = value.startsWith(LOOK)
                              ? script?.meta.looks?.find(
                                  (l) => l.name === value.slice(LOOK.length),
                                )
                              : undefined;
                            const preset = state.presets.find(
                              (p) => p.id === value,
                            );
                            update(
                              i,
                              look
                                ? {
                                    presetId: null,
                                    params: look.params,
                                    colors: look.colors,
                                  }
                                : preset
                                  ? {
                                      presetId: preset.id,
                                      scriptId: preset.look.scriptId,
                                      params: preset.look.params,
                                      colors: preset.look.colors,
                                    }
                                  : { presetId: null, params: {}, colors: [] },
                            );
                          }}
                        >
                          <option value="">Default settings</option>
                          {settingsValue(e, script?.meta) === CUSTOM && (
                            <option value={CUSTOM} disabled>
                              Custom settings
                            </option>
                          )}
                          {!!script?.meta.looks?.length && (
                            <optgroup label="Looks">
                              {script.meta.looks.map((l) => (
                                <option key={l.name} value={LOOK + l.name}>
                                  {l.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {state.presets.length > 0 && (
                            <optgroup label="Presets">
                              {state.presets.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <input
                          type="number"
                          min={1}
                          aria-label={`${label} seconds`}
                          className={cx(smallInput, "w-16 text-right")}
                          value={e.durationS}
                          onChange={(ev) =>
                            update(i, {
                              durationS: Math.max(
                                1,
                                Number(ev.target.value) || 1,
                              ),
                            })
                          }
                        />
                        <span className="text-xs text-muted">s</span>
                      </div>
                      <div className="-my-1 flex items-center justify-end">
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
                  {(groups.find(([c]) => c === category)?.[1] ?? []).map(
                    (s) => (
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
                    ),
                  )}
                </div>
              </Card>
            ) : (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus size={14} /> Add effect
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <span className="block text-[13px] font-medium text-soft">
              Transitions between effects
            </span>
            <TransitionList
              label="Between effects"
              items={transitions}
              onChange={setTransitions}
              frames={transitionFrames}
              layout={layout}
              empty="Each light uses its own transitions for changing effect."
            />
          </div>
        </div>

        <Card className="space-y-4 p-4 lg:col-start-2 lg:row-start-2">
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
                    onChange={(e) =>
                      setSeason({ ...season, from: e.target.value })
                    }
                  />
                </Field>
                <Field label="To (MM-DD)">
                  <Input
                    value={season.to}
                    inputMode="numeric"
                    onChange={(e) =>
                      setSeason({ ...season, to: e.target.value })
                    }
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
            {season && (
              <p className="text-xs text-muted">{seasonLabel(season)}</p>
            )}
          </div>

          {season && (
            <div className="space-y-3 rounded-xl bg-night/60 p-4 ring-1 ring-line">
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">
                    Start by itself
                  </span>
                  <span className="block text-xs text-muted">
                    At midnight on the first day the lights switch to it, and on
                    the day after the last they go back to what they showed,
                    unless someone picked something else meanwhile. Power isn't
                    touched.
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
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || !name.trim() || !dirty}
          onClick={() => save()}
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
                navigate("/playlists", { replace: true });
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

const LOOK = "look:";
const CUSTOM = "custom";

/** The entry's settings as a value of its settings select. */
function settingsValue(e: PlaylistEntry, meta: Meta | undefined) {
  if (e.presetId) return e.presetId;
  const params = e.params ?? {};
  const colors = e.colors ?? [];
  if (!Object.keys(params).length && !colors.length) return "";
  const look = meta?.looks?.find((l) => isLook(meta, l, params, colors));
  if (look) return LOOK + look.name;
  return isLook(meta, { params: {}, colors: [] }, params, colors) ? "" : CUSTOM;
}
