import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { post, type AppState } from "../api";
import { frames, useStatus } from "../live";
import { Link, useApp } from "../main";
import { Mirror } from "../components/Mirror";
import { AddDevice } from "./DeviceSettings";
import {
  Badge,
  Button,
  Card,
  Slider,
  Toggle,
  useToast,
} from "../components/ui";

/** Sends the latest value at most every `ms`, and once more at the end. */
export function useThrottled<T>(send: (v: T) => Promise<unknown>, ms = 120) {
  const toast = useToast();
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p)
      send(p.value).catch((e) =>
        toast(e instanceof Error ? e.message : String(e), "bad"),
      );
  }, [send, toast]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (value: T) => {
      pending.current = { value };
      if (!timer.current) timer.current = setTimeout(flush, ms);
    },
    [flush, ms],
  );
}

export function statusTone(output?: string, online?: boolean) {
  if (online === false) return "bad" as const;
  if (output === "live") return "glow" as const;
  if (output === "movie") return "ok" as const;
  return "muted" as const;
}

export function outputLabel(output?: string, online?: boolean) {
  if (online === false) return "Offline";
  if (output === "live") return "Streaming";
  if (output === "movie") return "Playing movie";
  return "Idle";
}

function LightCard({
  item,
  state,
}: {
  item: AppState["fixtures"][number];
  state: AppState;
}) {
  const { fixture, layout } = item;
  const [brightness, setBrightness] = useState(item.state.brightness);
  const [power, setPower] = useState(item.state.power);
  useEffect(
    () => setBrightness(item.state.brightness),
    [item.state.brightness],
  );
  useEffect(() => setPower(item.state.power), [item.state.power]);
  const status = useStatus()[fixture.deviceId];
  const device = state.devices.find((d) => d.id === fixture.deviceId);
  const send = useThrottled(
    useCallback(
      (v: number) =>
        post(`/fixtures/${encodeURIComponent(fixture.id)}/state`, {
          brightness: v,
        }),
      [fixture.id],
    ),
  );
  const toast = useToast();
  const script = state.scripts.find((s) => s.id === item.state.look.scriptId);
  const preset = state.presets.find((p) => p.id === item.state.presetId);
  const playlist = state.playlists.find((p) => p.id === item.state.playlistId);
  const source = useCallback(() => frames.get(fixture.id), [fixture.id]);
  const disabled = !device?.enabled;
  return (
    <Card className="group relative overflow-hidden transition hover:ring-glow/40">
      <Link to={`/lights/${encodeURIComponent(fixture.id)}`} className="block">
        <div className="relative bg-gradient-to-b from-night to-ink">
          {layout && layout.points.length ? (
            <Mirror
              points={layout.points}
              aspect={layout.aspect}
              source={source}
              className="h-44"
            />
          ) : (
            <div className="flex h-44 items-center justify-center text-sm text-muted">
              Not read from the device yet
            </div>
          )}
          <div className="pointer-events-none absolute top-3 left-3">
            <Badge
              tone={
                disabled ? "muted" : statusTone(status?.output, status?.online)
              }
            >
              {disabled
                ? "Disabled"
                : outputLabel(status?.output, status?.online)}
            </Badge>
          </div>
        </div>
      </Link>
      <Link
        to={`/lights/${encodeURIComponent(fixture.id)}/settings`}
        aria-label={`${fixture.name} settings`}
        className="absolute top-2.5 right-2.5 rounded-xl bg-ink/60 p-2 text-muted backdrop-blur transition hover:text-white"
      >
        <Settings2 size={16} />
      </Link>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            to={`/lights/${encodeURIComponent(fixture.id)}`}
            className="min-w-0"
          >
            <h3 className="truncate font-semibold">{fixture.name}</h3>
            <p className="truncate text-sm text-muted">
              {playlist
                ? `${playlist.name} · ${script?.name ?? item.state.look.scriptId}`
                : (preset?.name ?? script?.name ?? item.state.look.scriptId)}
            </p>
          </Link>
          <Toggle
            label={`${fixture.name} power`}
            checked={power}
            disabled={disabled}
            onChange={(v) => {
              setPower(v);
              post(`/fixtures/${encodeURIComponent(fixture.id)}/state`, {
                power: v,
              }).catch((e) => {
                setPower(!v);
                toast(e.message, "bad");
              });
            }}
          />
        </div>
        <Slider
          label={`${fixture.name} brightness`}
          value={brightness}
          onChange={(v) => {
            setBrightness(v);
            send(v);
          }}
        />
      </div>
    </Card>
  );
}

export function LightsPage() {
  const { state } = useApp();
  const [adding, setAdding] = useState(false);
  const add = <AddDevice open={adding} onOpenChange={setAdding} />;
  if (!state.fixtures.length) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-xl font-semibold">No lights yet</h1>
        <p className="mt-2 text-sm text-muted">
          Add a Twinkly string or LIFX bulb by its IP address to get started.
        </p>
        <Button
          variant="primary"
          className="mt-6"
          onClick={() => setAdding(true)}
        >
          <Plus size={16} /> Add a device
        </Button>
        {add}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lights</h1>
          <p className="mt-1 text-sm text-muted">
            What every device is showing right now. The gear on a light opens
            its settings.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> Add a device
        </Button>
      </div>
      {add}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.fixtures.map((item) => (
          <LightCard key={item.fixture.id} item={item} state={state} />
        ))}
      </div>
    </div>
  );
}
