import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { post, put, type Slot, type Transitions } from "../api";
import { GRID, useGallery } from "../live";
import { useApp } from "../main";
import { TransitionList } from "../components/TransitionList";
import { Button, Card, Section, useAction } from "../components/ui";
import { useThrottled } from "./Lights";

export const SLOTS: [Slot, string, string][] = [
  ["on", "Turning on", "Comes on instantly."],
  ["off", "Turning off", "Goes off instantly."],
  ["change", "Changing effect", "Changes instantly."],
];

/** Transition thumbnails on a light's layout (the first mapped one by default). */
export function useTransitionThumbs(fixtureId?: string) {
  const { state } = useApp();
  const light = fixtureId
    ? state.fixtures.find((f) => f.fixture.id === fixtureId)
    : state.fixtures.find((f) => f.layout?.points.length);
  const layout = light?.layout?.points.length
    ? light.layout
    : { points: GRID, aspect: 1 };
  return { layout, frames: useGallery("transition", light?.fixture.id) };
}

export function SettingsPage() {
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const saved = state.settings.transitions;
  const [t, setT] = useState<Transitions>(saved);
  useEffect(() => setT(saved), [saved]);
  const { frames, layout } = useTransitionThumbs();
  const save = useThrottled(
    useCallback(
      async (transitions: Transitions) => {
        await put("/settings", { ...state.settings, transitions });
        reload();
      },
      [state.settings, reload],
    ),
    500,
  );
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Settings for the whole app.</p>
      </div>
      <Section title="Transitions for all lights">
        <p className="-mt-1 text-sm text-muted">
          How lights turn on, turn off and change effect, unless a light has its
          own in its settings. Playlists can have their own for changing effect.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {SLOTS.map(([slot, label, empty]) => {
            const own = state.fixtures.filter(
              (f) => f.fixture.transitions[slot] != null,
            );
            return (
              <Card key={slot} className="space-y-3 p-4">
                <span className="block font-medium">{label}</span>
                <TransitionList
                  label={label}
                  items={t[slot]}
                  onChange={(list) => {
                    const next = { ...t, [slot]: list };
                    setT(next);
                    save(next);
                  }}
                  frames={frames}
                  layout={layout}
                  empty={empty}
                />
                <div className="space-y-2 border-t border-line pt-3">
                  <p className="text-xs text-muted">
                    {own.length === 0
                      ? "Every light uses these."
                      : `${own.map((f) => f.fixture.name).join(", ")} ${
                          own.length === 1 ? "uses its" : "use their"
                        } own.`}
                  </p>
                  {own.length > 0 && (
                    <Button
                      size="sm"
                      disabled={busy}
                      aria-label={`Use these for ${label.toLowerCase()} on every light`}
                      onClick={() => {
                        if (
                          !confirm(
                            `Use these for ${label.toLowerCase()} on every light? ${own
                              .map((f) => f.fixture.name)
                              .join(", ")} will lose ${
                              own.length === 1 ? "its" : "their"
                            } own.`,
                          )
                        )
                          return;
                        run(async () => {
                          await post("/settings/follow", { slot });
                          await reload();
                        }, "Every light uses these now");
                      }}
                    >
                      <Users size={14} /> Use these on every light
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
