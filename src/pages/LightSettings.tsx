import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import {
  del,
  post,
  put,
  type Fixture,
  type LayoutMode,
  type Slot,
  type TransitionSpec,
} from "../api";
import { useStatus } from "../live";
import { Link, useApp, useRoute } from "../main";
import { Thumb } from "../components/EffectCard";
import { TransitionList } from "../components/TransitionList";
import {
  Button,
  Card,
  Field,
  Input,
  Section,
  Select,
  Slider,
  Toggle,
  useAction,
} from "../components/ui";
import { StringSettings } from "./DeviceSettings";
import { useThrottled } from "./Lights";
import { SLOTS, useTransitionThumbs } from "./Settings";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/** "1.5×", "0.25×". */
export function scaleLabel(scale: number) {
  return `${Number(scale.toFixed(2))}×`;
}

/** A light's own settings and its string's, as one page. */
export function LightSettingsPage({ id }: { id: string }) {
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
  return <LightSettings key={id} fixture={item.fixture} />;
}

function LightSettings({ fixture }: { fixture: Fixture }) {
  const { state } = useApp();
  const { navigate } = useRoute();
  const status = useStatus();
  const device = state.devices.find((d) => d.id === fixture.deviceId);
  const lifx = device?.kind === "lifx";
  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          to={`/lights/${encodeURIComponent(fixture.id)}`}
          className="rounded-xl p-2 text-muted hover:bg-raised hover:text-white"
          aria-label={`Back to ${fixture.name}`}
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {fixture.name} settings
          </h1>
          <p className="text-sm text-muted">
            {device?.name} · {lifx ? "zones" : "LEDs"} {fixture.start}–
            {fixture.start + fixture.count - 1}
          </p>
        </div>
      </div>
      <LedSettings fixture={fixture} />
      <LightTransitions fixture={fixture} />
      {device && (
        <Section
          title={`${device.kind === "lifx" ? "Device" : "String"}: ${device.name}`}
        >
          <p className="-mt-1 text-sm text-muted">
            {device.kind === "lifx"
              ? "The LIFX bulb behind this light: connection, zones and how they are split into lights."
              : "The Twinkly string behind this light: connection, output and how its LEDs are split into lights."}
          </p>
          <Card className="p-5">
            <StringSettings
              device={device}
              status={status[device.id] ?? state.status[device.id]}
              onRemoved={() => navigate("/")}
            />
          </Card>
        </Section>
      )}
    </div>
  );
}

function LedSettings({ fixture }: { fixture: Fixture }) {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const { run, busy } = useAction();
  const device = state.devices.find((d) => d.id === fixture.deviceId);
  const lifx = device?.kind === "lifx";
  const [draft, setDraft] = useState(fixture);
  // Saving transitions changes the fixture too; keep edits made here.
  useEffect(
    () =>
      setDraft((d) => ({
        ...fixture,
        ...Object.fromEntries(
          (Object.keys(d) as (keyof Fixture)[])
            .filter(
              (k) =>
                k !== "transitions" &&
                JSON.stringify(d[k]) !== JSON.stringify(fixture[k]),
            )
            .map((k) => [k, d[k]]),
        ),
      })),
    [fixture],
  );
  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(fixture),
    [draft, fixture],
  );
  const mode = draft.layout.kind;
  const scale = draft.scale ?? 1;
  const siblings = state.fixtures.filter(
    (f) => f.fixture.deviceId === fixture.deviceId,
  ).length;
  return (
    <Section title={lifx ? "Zones and layout" : "LEDs and layout"}>
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
          <Field label={lifx ? "First zone" : "First LED"}>
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
            label={lifx ? "Number of zones" : "Number of LEDs"}
            hint={
              device
                ? `${device.name} has ${device.ledCount} ${lifx ? "zones" : "LEDs"}.`
                : undefined
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
          <Field
            label="Positions"
            hint={`Where effects think each ${lifx ? "zone" : "LED"} is.`}
          >
            <Select
              label="Positions"
              value={mode}
              options={[
                {
                  value: "device",
                  label: lifx
                    ? "The bulb's zones"
                    : "Mapped in the Twinkly app",
                },
                { value: "along", label: "Along its length" },
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
          <div className="space-y-1.5 sm:col-span-2">
            <div className="flex justify-between text-[13px] font-medium text-soft">
              <span>Effect size</span>
              <span className="font-mono text-xs text-muted tabular-nums">
                {scaleLabel(scale)}
              </span>
            </div>
            {/* Logarithmic, so 1× sits in the middle. */}
            <Slider
              label="Effect size"
              value={Math.log2(scale)}
              min={Math.log2(MIN_SCALE)}
              max={Math.log2(MAX_SCALE)}
              step={0.05}
              onChange={(v) => {
                const s = Math.round(2 ** v * 20) / 20;
                setDraft({
                  ...draft,
                  scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)),
                });
              }}
            />
            <span className="flex justify-between text-xs text-muted">
              <span>Finer</span>
              <span>Bigger</span>
            </span>
            <span className="block text-xs text-muted">
              Bigger or finer patterns on this light.
            </span>
          </div>
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
          <label className="flex items-center gap-3 text-sm text-soft">
            <Toggle
              label="Follow seasonal playlists"
              checked={draft.seasonal}
              onChange={(v) => setDraft({ ...draft, seasonal: v })}
            />
            Follow seasonal playlists
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
                    put(`/fixtures/${encodeURIComponent(fixture.id)}`, {
                      ...draft,
                      transitions: fixture.transitions,
                    }),
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

function LightTransitions({ fixture }: { fixture: Fixture }) {
  const { state, reload } = useApp();
  const { run } = useAction();
  const [t, setT] = useState(fixture.transitions);
  useEffect(() => setT(fixture.transitions), [fixture.transitions]);
  const all = state.settings.transitions;
  const { frames, layout } = useTransitionThumbs(fixture.id);
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
  const update = (slot: Slot, list: TransitionSpec[] | null) => {
    const next = { ...t, [slot]: list };
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
      <div className="grid gap-4 lg:grid-cols-3">
        {SLOTS.map(([slot, label, empty]) => {
          const own = t[slot];
          return (
            <Card key={slot} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{label}</span>
                <label className="flex items-center gap-2 text-xs text-soft">
                  Same as all lights
                  <Toggle
                    label={`${label}: same as all lights`}
                    checked={own == null}
                    onChange={(v) =>
                      // Its own list starts as a copy of the shared one.
                      update(slot, v ? null : all[slot].map((s) => ({ ...s })))
                    }
                  />
                </label>
              </div>
              {own == null ? (
                <div className="space-y-2">
                  {all[slot].length === 0 ? (
                    <p className="text-sm text-muted">{empty}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {all[slot].map((spec, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-3 rounded-xl bg-night/60 p-2 ring-1 ring-line"
                        >
                          <Thumb
                            scriptId={spec.scriptId}
                            frames={frames}
                            layout={layout}
                            className="h-9 w-12 shrink-0 overflow-hidden rounded-md"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {state.scripts.find((s) => s.id === spec.scriptId)
                              ?.name ?? spec.scriptId}
                          </span>
                          <span className="font-mono text-xs text-muted tabular-nums">
                            {(spec.durationMs / 1000).toFixed(1)} s
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted">
                    Uses the{" "}
                    <Link to="/settings" className="text-glow hover:underline">
                      transitions for all lights
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <TransitionList
                  label={label}
                  items={own}
                  onChange={(list) => update(slot, list)}
                  frames={frames}
                  layout={layout}
                  empty={empty}
                />
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
