import { useEffect, useMemo, useState } from "react";
import {
  Crosshair,
  RefreshCw,
  Scissors,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { del, post, put, type Device, type DeviceStatus } from "../api";
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
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const [draft, setDraft] = useState(device);
  useEffect(() => setDraft(device), [device]);
  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(device),
    [draft, device],
  );
  const fixtures = state.fixtures.filter(
    (f) => f.fixture.deviceId === device.id,
  );
  const [identifying, setIdentifying] = useState(false);
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
          <div className="space-y-2">
            {fixtures.map(({ fixture }) => (
              <Link
                key={fixture.id}
                to={`/lights/${encodeURIComponent(fixture.id)}`}
                className="flex items-center justify-between gap-3 rounded-xl bg-night px-4 py-3 ring-1 ring-line hover:ring-glow/40"
              >
                <span className="font-medium">{fixture.name}</span>
                <span className="font-mono text-xs text-muted">
                  LEDs {fixture.start}–{fixture.start + fixture.count - 1}
                </span>
              </Link>
            ))}
            {device.ledCount > 0 && <LedBar device={device} />}
          </div>
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
            disabled={!device.enabled || device.ledCount === 0}
            onClick={() => setIdentifying(true)}
          >
            <Crosshair size={14} /> Find LEDs
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
      {identifying && (
        <Identify device={device} onClose={() => setIdentifying(false)} />
      )}
      {splitting && (
        <Split device={device} onClose={() => setSplitting(false)} />
      )}
    </div>
  );
}

/** A bar showing which LED ranges belong to which light. */
function LedBar({ device }: { device: Device }) {
  const { state } = useApp();
  const fixtures = state.fixtures.filter(
    (f) => f.fixture.deviceId === device.id,
  );
  const hues = [
    "#ffb547",
    "#ff5f8a",
    "#7cc7ff",
    "#4ade80",
    "#c084fc",
    "#facc15",
  ];
  return (
    <div
      className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-raised"
      aria-hidden
    >
      {fixtures.map(({ fixture }, i) => (
        <div
          key={fixture.id}
          className="absolute inset-y-0 opacity-80"
          style={{
            left: `${(fixture.start / device.ledCount) * 100}%`,
            width: `${(fixture.count / device.ledCount) * 100}%`,
            background: hues[i % hues.length],
          }}
        />
      ))}
    </div>
  );
}

function Identify({
  device,
  onClose,
}: {
  device: Device;
  onClose: () => void;
}) {
  const [start, setStart] = useState(0);
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
      description="The chosen LEDs light up white on the string; the rest glow dim blue. Closing this puts the lights back."
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
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setStart((s) => Math.max(0, s - 1))}>
            −1
          </Button>
          <Button
            size="sm"
            onClick={() =>
              setStart((s) => Math.min(device.ledCount - 1, s + 1))
            }
          >
            +1
          </Button>
          <Input
            type="number"
            min={0}
            max={device.ledCount - 1}
            value={start}
            onChange={(e) =>
              setStart(
                Math.min(
                  device.ledCount - 1,
                  Math.max(0, Number(e.target.value)),
                ),
              )
            }
            className="w-24"
          />
        </div>
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

function Split({ device, onClose }: { device: Device; onClose: () => void }) {
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const fixtures = state.fixtures
    .filter((f) => f.fixture.deviceId === device.id)
    .map((f) => f.fixture);
  const last = fixtures.reduce(
    (a, b) => (b.start + b.count > a.start + a.count ? b : a),
    fixtures[0],
  );
  const [at, setAt] = useState(
    last
      ? last.start + Math.floor(last.count / 2)
      : Math.floor(device.ledCount / 2),
  );
  const [name, setName] = useState(`${device.name} 2`);
  const owner = fixtures.find((f) => at > f.start && at < f.start + f.count);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Split off a part"
      description="The LEDs from the split point to the end of that light become a new light, with its own effects and its own homectl device."
    >
      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!owner) return;
          const ok = await run(async () => {
            await put(`/fixtures/${encodeURIComponent(owner.id)}`, {
              ...owner,
              count: at - owner.start,
            });
            await post("/fixtures", {
              id: name.trim(),
              deviceId: device.id,
              start: at,
              count: owner.start + owner.count - at,
            });
          }, "Split");
          await reload();
          if (ok) onClose();
        }}
      >
        <Field
          label={`Split before LED ${at}`}
          hint={
            owner ? `Splits ${owner.name}.` : "Pick a point inside a light."
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
        <Field label="Name of the new light">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">
          Tip: use “Find LEDs” first to see where one part ends.
        </p>
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
