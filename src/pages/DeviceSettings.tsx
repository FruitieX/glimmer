import { useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  Merge,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { del, post, put, type Device, type DeviceStatus } from "../api";
import { StringMap } from "../components/StringMap";
import {
  LIGHT_COLORS,
  boundaries,
  drawPositions,
  findOutliers,
  fixOutlier,
  ledsLabel,
  mappedPoints,
  moveBoundary,
  owners,
  rangeProblem,
  type Outlier,
  type Range,
} from "../ranges";
import { useStatus } from "../live";
import { Link, useApp } from "../main";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Section,
  Slider,
  Toggle,
  useAction,
} from "../components/ui";
import { outputLabel, statusTone } from "./Lights";

/** Settings for one string, opened from its lights. */
export function DeviceSettingsDialog({
  deviceId,
  onClose,
}: {
  deviceId: string;
  onClose: () => void;
}) {
  const { state } = useApp();
  const status = useStatus();
  const device = state.devices.find((d) => d.id === deviceId);
  if (!device) return null;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${device.name} settings`}
      description="The Twinkly string behind this light: connection, output and how its LEDs are split into lights."
      wide
    >
      <DeviceCard
        device={device}
        status={status[device.id] ?? state.status[device.id]}
        onRemoved={onClose}
      />
    </Dialog>
  );
}

export function AddDevice({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { reload } = useApp();
  const { run, busy } = useAction();
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a string"
      description="Find the string's IP address in the Twinkly app (device settings). Give it a fixed address in your router."
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(
            () => post("/devices", { name, ip }),
            "String added",
          );
          await reload();
          if (ok) {
            onOpenChange(false);
            setName("");
            setIp("");
          }
        }}
      >
        <Field label="Name" hint="Also the light's MQTT id in homectl.">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Living room curtain"
            autoFocus
          />
        </Field>
        <Field label="IP address">
          <Input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="192.0.2.20"
            inputMode="decimal"
          />
        </Field>
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !name.trim() || !ip.trim()}
        >
          {busy ? "Contacting the string…" : "Add"}
        </Button>
      </form>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function DeviceCard({
  device,
  status,
  onRemoved,
}: {
  device: Device;
  status?: DeviceStatus;
  onRemoved: () => void;
}) {
  const { reload } = useApp();
  const { run, busy } = useAction();
  const [draft, setDraft] = useState(device);
  useEffect(() => setDraft(device), [device]);
  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(device),
    [draft, device],
  );
  /** First LED to light while finding LEDs, null when not finding. */
  const [identifying, setIdentifying] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const info = device.info;
  const rgbw = device.output.order.length === 4;
  const out = draft.output;
  const setOut = (o: Partial<Device["output"]>) =>
    setDraft({ ...draft, output: { ...draft.output, ...o } });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">
            {device.ip}
            {info?.product_code && ` · ${info.product_code}`}
            {device.ledCount > 0 &&
              ` · ${device.ledCount} ${rgbw ? "RGBW" : "RGB"} LEDs`}
          </p>
        </div>
        <Badge
          tone={
            device.enabled
              ? statusTone(status?.output, status?.online)
              : "muted"
          }
        >
          {device.enabled
            ? outputLabel(status?.output, status?.online)
            : "Disabled"}
        </Badge>
        <Toggle
          label={`${device.name} enabled`}
          checked={device.enabled}
          onChange={(v) =>
            run(async () => {
              await put(`/devices/${device.id}`, { ...device, enabled: v });
              await reload();
            })
          }
        />
      </div>

      <div className="space-y-6 pt-5">
        {!device.enabled && (
          <p className="text-sm text-muted">
            Disabled strings are left alone: the app never contacts them. Enable
            it to control its lights.
          </p>
        )}
        {device.enabled && status && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Reachable" value={status.online ? "Yes" : "No"} />
            <Stat label="Mode" value={status.mode ?? "–"} />
            <Stat
              label="Frame rate"
              value={
                status.output === "live" ? `${status.fps.toFixed(1)} fps` : "–"
              }
            />
            <Stat label="Late frames" value={status.lateFrames} />
            <Stat label="Movie" value={status.movie ?? "–"} />
          </div>
        )}
        {status?.error && device.enabled && (
          <p className="flex items-start gap-2 rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />{" "}
            {status.error}
          </p>
        )}

        <Section
          title="Lights on this string"
          action={
            device.ledCount > 0 && (
              <Button size="sm" onClick={() => setSplitting(true)}>
                <Scissors size={14} /> Split off a part
              </Button>
            )
          }
        >
          <LightsOnString device={device} onFind={setIdentifying} />
        </Section>

        <Section title="Output">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label={`Frame rate limit: ${draft.maxFps.toFixed(0)} fps`}
              hint="Lower it if animation looks uneven over Wi-Fi."
            >
              <Slider
                label="Frame rate limit"
                value={draft.maxFps}
                min={5}
                max={40}
                step={1}
                onChange={(v) => setDraft({ ...draft, maxFps: v })}
              />
            </Field>
            <Field
              label={`Gamma: ${out.gamma.toFixed(2)}`}
              hint="Higher gives deeper darks and richer colours."
            >
              <Slider
                label="Gamma"
                value={out.gamma}
                min={1}
                max={3.2}
                step={0.05}
                onChange={(v) => setOut({ gamma: v })}
              />
            </Field>
            {rgbw && (
              <Field
                label={`White LED share: ${Math.round(out.white * 100)}%`}
                hint="How much of pale colours comes from the white LED."
              >
                <Slider
                  label="White share"
                  value={out.white}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setOut({ white: v })}
                />
              </Field>
            )}
            <Field
              label="Channel order"
              hint={`Byte order the string expects (${rgbw ? "usually WRGB" : "usually RGB"}).`}
            >
              <Input
                value={out.order}
                onChange={(e) =>
                  setOut({ order: e.target.value.toUpperCase() })
                }
                className="font-mono"
              />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <span className="text-[13px] font-medium text-soft">
                White balance
              </span>
              <div className="grid grid-cols-3 gap-4">
                {(["Red", "Green", "Blue"] as const).map((c, i) => (
                  <div key={c}>
                    <div className="flex justify-between text-xs text-muted">
                      <span>{c}</span>
                      <span className="font-mono">
                        {out.gains[i].toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      label={`${c} gain`}
                      value={out.gains[i]}
                      min={0}
                      max={1.5}
                      step={0.01}
                      onChange={(v) => {
                        const g = [...out.gains] as [number, number, number];
                        g[i] = v;
                        setOut({ gains: g });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Stored movies">
          <div className="space-y-4">
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">
                  Play looping effects from the string's memory
                </span>
                <span className="block text-xs text-muted">
                  Effects that repeat are rendered once and uploaded as a movie,
                  so they play perfectly smoothly even if Wi-Fi is patchy.
                  Transitions are still streamed.
                </span>
              </span>
              <Toggle
                label="Prefer movies"
                checked={draft.preferMovies}
                onChange={(v) => setDraft({ ...draft, preferMovies: v })}
              />
            </label>
            <label className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">
                  Allow erasing the string's movie memory when it's full
                </span>
                <span className="block text-xs text-muted">
                  The firmware can only erase everything at once, including
                  effects saved from the Twinkly app.
                </span>
              </span>
              <Toggle
                label="Allow clearing movies"
                checked={draft.allowClearingMovies}
                onChange={(v) => setDraft({ ...draft, allowClearingMovies: v })}
              />
            </label>
            {info?.movie_capacity && (
              <p className="text-xs text-muted">
                Movie memory: {info.movie_capacity} frames.
              </p>
            )}
          </div>
        </Section>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!changed || busy}
            onClick={async () => {
              if (await run(() => put(`/devices/${device.id}`, draft), "Saved"))
                reload();
            }}
          >
            Save
          </Button>
          {changed && (
            <Button variant="ghost" onClick={() => setDraft(device)}>
              Undo changes
            </Button>
          )}
          <Button
            disabled={busy || !device.enabled}
            onClick={async () => {
              if (
                await run(
                  () => post(`/devices/${device.id}/refresh`),
                  "Read from the string",
                )
              )
                reload();
            }}
          >
            <RefreshCw size={14} /> Read LEDs and mapping
          </Button>
          <Button
            variant="danger"
            disabled={busy || !device.enabled}
            onClick={() => {
              if (
                !confirm(
                  `Erase every movie stored on ${device.name}, including ones from the Twinkly app?`,
                )
              )
                return;
              run(
                () => post(`/devices/${device.id}/clear-movies`),
                "Erasing movies",
              );
            }}
          >
            Erase stored movies
          </Button>
          <Button
            variant="danger"
            className="ml-auto"
            disabled={busy}
            onClick={async () => {
              if (
                !confirm(`Remove ${device.name} and its lights from the app?`)
              )
                return;
              if (await run(() => del(`/devices/${device.id}`), "Removed")) {
                await reload();
                onRemoved();
              }
            }}
          >
            <Trash2 size={14} /> Remove
          </Button>
        </div>
      </div>
      {identifying !== null && (
        <Identify
          device={device}
          initial={identifying}
          onClose={() => setIdentifying(null)}
        />
      )}
      {splitting && (
        <Split device={device} onClose={() => setSplitting(false)} />
      )}
    </div>
  );
}

const colorOf = (i: number) => LIGHT_COLORS[i % LIGHT_COLORS.length];

function Dot({ color, dim }: { color: string; dim?: boolean }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{
        background: color,
        opacity: dim ? 0.25 : 1,
        boxShadow: dim ? undefined : `0 0 8px ${color}`,
      }}
      aria-hidden
    />
  );
}

/** The string's lights as ranges, in LED order. */
function useRanges(device: Device): Range[] {
  const { state } = useApp();
  return useMemo(
    () =>
      state.fixtures
        .filter((f) => f.fixture.deviceId === device.id)
        .map(({ fixture: f }) => ({
          id: f.id,
          name: f.name,
          start: f.start,
          count: f.count,
        }))
        .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)),
    [state.fixtures, device.id],
  );
}

/** Mapped positions (null without a mapping) and where to draw each LED. */
function useStringView(device: Device) {
  const points = useMemo(
    () => mappedPoints(device.layout, device.ledCount),
    [device.layout, device.ledCount],
  );
  const view = useMemo(
    () => drawPositions(points, device.ledCount),
    [points, device.ledCount],
  );
  return { points, ...view };
}

function OutlierHint({
  outlier,
  ranges,
  onFix,
}: {
  outlier: Outlier;
  ranges: Range[];
  onFix: () => void;
}) {
  const light = ranges[outlier.light];
  const other =
    outlier.neighbour !== null ? ranges[outlier.neighbour] : undefined;
  const one = outlier.leds.length === 1;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-warn/10 px-4 py-3 text-sm text-warn ring-1 ring-warn/25"
    >
      <p className="flex min-w-48 flex-1 items-start gap-2">
        <TriangleAlert size={16} className="mt-0.5 shrink-0" />
        <span>
          {ledsLabel(outlier.leds)} {one ? "sits" : "sit"} apart from the rest
          of {light.name}
          {other
            ? ` — ${one ? "it" : "they"} may belong to ${other.name}.`
            : " — the string's mapping may have a stray point."}
        </span>
      </p>
      {other && (
        <Button size="sm" onClick={onFix}>
          Move {one ? "it" : "them"} to {other.name}
        </Button>
      )}
    </div>
  );
}

/**
 * The string's lights on a map of its LEDs, with the boundaries between them
 * editable before saving.
 */
function LightsOnString({
  device,
  onFind,
}: {
  device: Device;
  onFind: (start: number) => void;
}) {
  const { reload } = useApp();
  const { run, busy } = useAction();
  const saved = useRanges(device);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(JSON.parse(savedKey)), [savedKey]);
  const [exact, setExact] = useState(false);
  const { points, xy, aspect } = useStringView(device);
  const n = device.ledCount;
  const owner = useMemo(() => owners(draft, n), [draft, n]);
  const outliers = useMemo(
    () => (points ? findOutliers(points, draft) : []),
    [points, draft],
  );
  const rings = useMemo(
    () => new Set(outliers.flatMap((o) => o.leds)),
    [outliers],
  );
  const bounds = boundaries(draft);
  const problem = rangeProblem(draft, n);
  const changes = draft.filter(
    (r, i) => r.start !== saved[i]?.start || r.count !== saved[i]?.count,
  );
  const changed = changes.length > 0;
  const unassigned = owner.filter((o) => o < 0).length;
  const setRange = (i: number, r: Partial<Range>) =>
    setDraft((d) => d.map((x, j) => (j === i ? { ...x, ...r } : x)));

  const save = async () => {
    const ok = await run(
      () =>
        post(`/devices/${device.id}/lights`, {
          ranges: changes.map(({ id, start, count }) => ({ id, start, count })),
        }),
      "Saved",
    );
    if (ok) await reload();
  };
  const merge = async (from: Range, into: Range) => {
    if (
      !confirm(
        `Merge ${from.name} into ${into.name}? ${from.name} is removed, along with its homectl device; its LEDs join ${into.name}.`,
      )
    )
      return;
    const start = Math.min(from.start, into.start);
    const ok = await run(
      () =>
        post(`/devices/${device.id}/lights`, {
          ranges: [{ id: into.id, start, count: from.count + into.count }],
          remove: [from.id],
        }),
      "Merged",
    );
    if (ok) await reload();
  };

  if (n === 0)
    return (
      <div className="space-y-2">
        {saved.map((r) => (
          <Link
            key={r.id}
            to={`/lights/${encodeURIComponent(r.id)}`}
            className="flex items-center justify-between gap-3 rounded-xl bg-night px-4 py-3 ring-1 ring-line hover:ring-glow/40"
          >
            <span className="font-medium">{r.name}</span>
          </Link>
        ))}
      </div>
    );

  return (
    <div className="space-y-4">
      <StringMap
        xy={xy}
        aspect={aspect}
        owner={owner}
        colors={draft.map((_, i) => colorOf(i))}
        names={draft.map((r) => r.name)}
        rings={rings}
      />
      {!points && (
        <p className="text-xs text-muted">
          No mapping has been read from the string, so its LEDs are drawn in
          order, left to right. Map the string in the Twinkly app, then use
          “Read LEDs and mapping” to see them where they hang.
        </p>
      )}

      <ul className="space-y-1.5">
        {draft.map((r, i) => (
          <li key={r.id}>
            <Link
              to={`/lights/${encodeURIComponent(r.id)}`}
              className="flex items-center gap-3 rounded-xl bg-night px-4 py-2.5 ring-1 ring-line hover:ring-glow/40"
            >
              <Dot color={colorOf(i)} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {r.name}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted">
                LEDs {r.start}–{r.start + r.count - 1}
                <span className="hidden sm:inline"> · {r.count}</span>
              </span>
            </Link>
          </li>
        ))}
        {unassigned > 0 && (
          <li className="flex items-center gap-3 px-4 py-1 text-xs text-muted">
            <Dot color="#ffffff" dim />
            {unassigned} {unassigned === 1 ? "LED is" : "LEDs are"} not in any
            light
          </li>
        )}
      </ul>

      {outliers.map((o) => (
        <OutlierHint
          key={`${o.light}-${o.leds[0]}`}
          outlier={o}
          ranges={draft}
          onFix={() => setDraft((d) => fixOutlier(d, o))}
        />
      ))}

      {bounds.map((b) => {
        const lo = draft[b.before];
        const hi = draft[b.after];
        const end = hi.start + hi.count;
        const name = `boundary between ${lo.name} and ${hi.name}`;
        return (
          <div
            key={`${lo.id}|${hi.id}`}
            className="space-y-2 rounded-xl bg-night px-4 py-3 ring-1 ring-line"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
              <span className="flex min-w-0 items-center gap-1.5 font-medium text-soft">
                <Dot color={colorOf(b.before)} />
                <span className="truncate">{lo.name}</span>
                <span className="text-muted">→</span>
                <Dot color={colorOf(b.after)} />
                <span className="truncate">{hi.name}</span>
              </span>
              <span className="font-mono text-xs text-muted">
                ends {b.at - 1} · starts {b.at}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                aria-label={`Move the ${name} one LED down`}
                disabled={b.at - 1 <= lo.start}
                onClick={() => setDraft((d) => moveBoundary(d, b, b.at - 1))}
              >
                −1
              </Button>
              <div className="min-w-0 flex-1">
                <Slider
                  label={`The ${name}`}
                  value={b.at}
                  min={lo.start + 1}
                  max={end - 1}
                  step={1}
                  onChange={(v) => setDraft((d) => moveBoundary(d, b, v))}
                />
              </div>
              <Button
                size="sm"
                aria-label={`Move the ${name} one LED up`}
                disabled={b.at + 1 >= end}
                onClick={() => setDraft((d) => moveBoundary(d, b, b.at + 1))}
              >
                +1
              </Button>
            </div>
          </div>
        );
      })}

      {exact && (
        <div className="space-y-2">
          {draft.map((r, i) => {
            const before = bounds.find((b) => b.after === i);
            const after = bounds.find((b) => b.before === i);
            const into = before
              ? saved[before.before]
              : after
                ? saved[after.after]
                : undefined;
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-end gap-3 rounded-xl bg-night px-4 py-3 ring-1 ring-line"
              >
                <span className="flex w-full items-center gap-2 text-sm font-medium sm:w-40">
                  <Dot color={colorOf(i)} />
                  <span className="truncate">{r.name}</span>
                </span>
                <label className="w-24 space-y-1">
                  <span className="text-xs text-muted">First LED</span>
                  <Input
                    type="number"
                    min={0}
                    max={n - 1}
                    value={r.start}
                    aria-label={`${r.name} first LED`}
                    onChange={(e) =>
                      setRange(i, { start: Math.round(Number(e.target.value)) })
                    }
                  />
                </label>
                <label className="w-24 space-y-1">
                  <span className="text-xs text-muted">LEDs</span>
                  <Input
                    type="number"
                    min={1}
                    max={n}
                    value={r.count}
                    aria-label={`${r.name} LED count`}
                    onChange={(e) =>
                      setRange(i, { count: Math.round(Number(e.target.value)) })
                    }
                  />
                </label>
                <span className="pb-2.5 font-mono text-xs text-muted">
                  to {r.start + r.count - 1}
                </span>
                {into && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={busy || changed}
                    title={changed ? "Save or undo your changes first" : ""}
                    onClick={() => merge(saved[i], into)}
                  >
                    <Merge size={14} /> Merge into {into.name}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {problem && changed && (
        <p className="flex items-start gap-2 rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" /> {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {changed && (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !!problem}
              onClick={save}
            >
              Save split
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft(saved)}>
              Undo
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setExact((v) => !v)}>
          <SlidersHorizontal size={14} />
          {exact ? "Hide exact ranges" : "Edit exact ranges"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4">
        <Button
          size="sm"
          disabled={!device.enabled}
          onClick={() => onFind(outliers[0]?.leds[0] ?? bounds[0]?.at ?? 0)}
        >
          <Crosshair size={14} /> Light them up on the string
        </Button>
        <span className="min-w-48 flex-1 text-xs text-muted">
          Optional. The map works without touching the string; this lights
          chosen LEDs on the real string, interrupting what it shows.
        </span>
      </div>
    </div>
  );
}

function Identify({
  device,
  initial,
  onClose,
}: {
  device: Device;
  initial: number;
  onClose: () => void;
}) {
  const [start, setStart] = useState(
    Math.min(Math.max(0, initial), device.ledCount - 1),
  );
  const [count, setCount] = useState(1);
  useEffect(() => {
    const t = setTimeout(
      () =>
        post(`/devices/${device.id}/identify`, { start, count }).catch(
          () => {},
        ),
      80,
    );
    return () => clearTimeout(t);
  }, [device.id, start, count]);
  useEffect(
    () => () => void post(`/devices/${device.id}/identify`, {}).catch(() => {}),
    [device.id],
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Find LEDs on ${device.name}`}
      description="This lights the real string: the chosen LEDs turn white and the rest glow dim blue, interrupting what it shows. Closing this puts the lights back."
    >
      <div className="space-y-5">
        <Field label={`First LED: ${start}`}>
          <Slider
            label="First LED"
            value={start}
            min={0}
            max={device.ledCount - 1}
            step={1}
            onChange={setStart}
          />
        </Field>
        <LedStepper
          value={start}
          min={0}
          max={device.ledCount - 1}
          onChange={setStart}
          label="First LED"
        />
        <Field label={`How many: ${count}`}>
          <Slider
            label="How many"
            value={count}
            min={1}
            max={Math.min(60, device.ledCount)}
            step={1}
            onChange={setCount}
          />
        </Field>
        <Button className="w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

/** −1 / +1 buttons and a number box for picking one LED precisely. */
function LedStepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        type="button"
        aria-label={`${label} one lower`}
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        −1
      </Button>
      <Button
        size="sm"
        type="button"
        aria-label={`${label} one higher`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        +1
      </Button>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="h-8 w-24"
      />
    </div>
  );
}

function Split({ device, onClose }: { device: Device; onClose: () => void }) {
  const { reload } = useApp();
  const { run, busy } = useAction();
  const ranges = useRanges(device);
  const { points, xy, aspect } = useStringView(device);
  const last = ranges.reduce<Range | undefined>(
    (a, b) => (!a || b.start + b.count > a.start + a.count ? b : a),
    undefined,
  );
  const [at, setAt] = useState(
    last
      ? last.start + Math.floor(last.count / 2)
      : Math.floor(device.ledCount / 2),
  );
  const [name, setName] = useState(`${device.name} 2`);
  const index = ranges.findIndex((r) => at > r.start && at < r.start + r.count);
  const owner = ranges[index];
  const end = owner ? owner.start + owner.count : 0;
  // The string as it would be split, with the new light last.
  const preview = useMemo<Range[]>(
    () =>
      owner
        ? [
            ...ranges.map((r, i) =>
              i === index ? { ...r, count: at - r.start } : r,
            ),
            {
              id: "",
              name: name.trim() || "The new light",
              start: at,
              count: end - at,
            },
          ]
        : ranges,
    [ranges, owner, index, at, end, name],
  );
  const moving = useMemo(
    () =>
      owner
        ? new Set(Array.from({ length: end - at }, (_, i) => at + i))
        : null,
    [owner, at, end],
  );
  const outliers = useMemo(
    () =>
      points && owner
        ? findOutliers(points, preview).filter(
            (o) => o.light === index || o.light === ranges.length,
          )
        : [],
    [points, owner, preview, index, ranges.length],
  );
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Split off a part"
      description="The LEDs from the split point to the end of that light become a new light, with its own effects and its own homectl device."
      wide
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!owner) return;
          const ok = await run(
            () =>
              post(`/devices/${device.id}/lights`, {
                ranges: [
                  { id: owner.id, start: owner.start, count: at - owner.start },
                ],
                create: { id: name.trim(), start: at, count: end - at },
              }),
            "Split",
          );
          await reload();
          if (ok) onClose();
        }}
      >
        <StringMap
          xy={xy}
          aspect={aspect}
          owner={owners(preview, device.ledCount)}
          colors={preview.map((_, i) => colorOf(i))}
          names={preview.map((r) => r.name)}
          focus={moving}
          rings={new Set(outliers.flatMap((o) => o.leds))}
        />
        <div className="space-y-2">
          <Field
            label={`The new light starts at LED ${at}`}
            hint={
              owner
                ? `LEDs ${at}–${end - 1} of ${owner.name} (highlighted) become the new light.`
                : "Pick a point inside a light."
            }
          >
            <Slider
              label="Split point"
              value={at}
              min={1}
              max={device.ledCount - 1}
              step={1}
              onChange={setAt}
            />
          </Field>
          <LedStepper
            value={at}
            min={1}
            max={device.ledCount - 1}
            onChange={setAt}
            label="Split point"
          />
        </div>
        {outliers.map((o) => (
          <OutlierHint
            key={`${o.light}-${o.leds[0]}`}
            outlier={o}
            ranges={preview}
            onFix={() => setAt(fixOutlier(preview, o)[ranges.length].start)}
          />
        ))}
        <Field label="Name of the new light">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button
          variant="primary"
          className="w-full"
          disabled={busy || !owner || !name.trim()}
        >
          Split
        </Button>
      </form>
    </Dialog>
  );
}
