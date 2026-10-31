import { useState } from "react";
import { Check, ChevronDown, Plus, Shuffle, X } from "lucide-react";
import { paramValues, type FixtureLayout, type TransitionSpec } from "../api";
import type { Gallery } from "../live";
import { useApp } from "../main";
import { EffectCard, Thumb } from "./EffectCard";
import { ParamControls } from "./controls";
import { Button, cx, Dialog, Slider } from "./ui";

/**
 * Edits a list of transitions for one slot (turning on, a playlist's
 * changes, ...). With several, one is picked at random each time.
 */
export function TransitionList({
  label,
  items,
  onChange,
  frames,
  layout,
  empty,
  defaultMs = 1200,
}: {
  label: string;
  items: TransitionSpec[];
  onChange: (items: TransitionSpec[]) => void;
  frames: Gallery;
  layout: FixtureLayout;
  /** What happens when the list is empty. */
  empty: string;
  defaultMs?: number;
}) {
  const { state } = useApp();
  const transitions = state.scripts.filter((s) => s.kind === "transition");
  // The item being replaced, or "new" while adding.
  const [picking, setPicking] = useState<number | "new" | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  // Transitions ticked while adding; several can be added at once.
  const [chosen, setChosen] = useState<string[]>([]);
  const inList = new Set(items.map((x) => x.scriptId));
  const addable = transitions.filter((t) => !inList.has(t.id));
  const update = (i: number, s: TransitionSpec) =>
    onChange(items.map((x, j) => (j === i ? s : x)));

  return (
    <div className="space-y-2">
      {items.length === 0 && <p className="text-sm text-muted">{empty}</p>}
      <ol className="space-y-2">
        {items.map((spec, i) => {
          const script = transitions.find((t) => t.id === spec.scriptId);
          const name = script?.name ?? spec.scriptId;
          const hasParams =
            !!script && Object.keys(script.meta.params).length > 0;
          return (
            <li
              key={i}
              className="space-y-3 rounded-xl bg-night/60 p-2.5 ring-1 ring-line"
            >
              <div className="flex items-center gap-3">
                <button
                  className="shrink-0 overflow-hidden rounded-lg ring-1 ring-line hover:ring-glow/40"
                  aria-label={`Change ${label} transition ${name}`}
                  onClick={() => setPicking(i)}
                >
                  <Thumb
                    scriptId={spec.scriptId}
                    frames={frames}
                    layout={layout}
                    className="h-11 w-16"
                  />
                </button>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setPicking(i)}
                >
                  <span className="block truncate text-sm font-medium">
                    {name}
                  </span>
                  <span className="block font-mono text-xs text-muted tabular-nums">
                    {(spec.durationMs / 1000).toFixed(1)} s
                  </span>
                </button>
                {hasParams && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="px-2"
                    aria-label={`${name} settings`}
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    <ChevronDown
                      size={14}
                      className={cx("transition", open === i && "rotate-180")}
                    />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2"
                  aria-label={`Remove ${name} from ${label}`}
                  onClick={() => {
                    setOpen(null);
                    onChange(items.filter((_, j) => j !== i));
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
              <Slider
                label={`${label} ${name} duration`}
                value={spec.durationMs}
                min={0}
                max={6000}
                step={100}
                onChange={(v) => update(i, { ...spec, durationMs: v })}
              />
              {hasParams && open === i && (
                <ParamControls
                  params={script.meta.params}
                  values={paramValues(script.meta, spec.params)}
                  onChange={(k, v) =>
                    update(i, {
                      ...spec,
                      params: { ...(spec.params ?? {}), [k]: v },
                    })
                  }
                />
              )}
            </li>
          );
        })}
      </ol>
      {items.length > 1 && (
        <p className="flex items-start gap-2 text-xs text-muted">
          <Shuffle size={13} className="mt-0.5 shrink-0" />
          Shuffles between these: one is picked at random each time, never the
          same one twice in a row.
        </p>
      )}
      <Button
        size="sm"
        onClick={() => {
          setChosen([]);
          setPicking("new");
        }}
      >
        <Plus size={14} /> Add transition
      </Button>
      {items.length > 1 && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-2"
          onClick={() => {
            if (
              window.confirm(
                `Remove all ${items.length} transitions from ${label}? With none, it changes instantly.`,
              )
            )
              onChange([]);
          }}
        >
          <X size={14} /> Remove all
        </Button>
      )}

      <Dialog
        open={picking !== null}
        onOpenChange={(v) => !v && setPicking(null)}
        title={picking === "new" ? "Add transitions" : "Change transition"}
        description={
          picking === "new"
            ? `${label}: pick one or more; with several, one is picked at random each time.`
            : label
        }
        wide
      >
        {picking === "new" && (
          <div className="sticky top-0 z-10 -mx-1 mb-3 flex items-center gap-2 bg-panel px-1 py-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={addable.length === 0}
              onClick={() =>
                setChosen(
                  chosen.length === addable.length
                    ? []
                    : addable.map((t) => t.id),
                )
              }
            >
              {chosen.length === addable.length && addable.length > 0
                ? "Select none"
                : "Select all"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              disabled={chosen.length === 0}
              onClick={() => {
                const ms = items.at(-1)?.durationMs ?? defaultMs;
                onChange([
                  ...items,
                  ...chosen.map((id) => ({
                    scriptId: id,
                    durationMs: ms,
                    params: {},
                  })),
                ]);
                setPicking(null);
              }}
            >
              <Plus size={14} />
              {chosen.length > 1
                ? `Add ${chosen.length} transitions`
                : "Add transition"}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {transitions.map((t) => {
            if (picking === "new") {
              const already = inList.has(t.id);
              const ticked = chosen.includes(t.id);
              return (
                <EffectCard
                  key={t.id}
                  script={t}
                  frames={frames}
                  layout={layout}
                  active={ticked}
                  badge={
                    already ? (
                      <span className="shrink-0 text-xs text-muted">
                        In list
                      </span>
                    ) : ticked ? (
                      <Check size={16} className="shrink-0 text-glow" />
                    ) : undefined
                  }
                  onClick={() =>
                    !already &&
                    setChosen(
                      ticked
                        ? chosen.filter((x) => x !== t.id)
                        : [...chosen, t.id],
                    )
                  }
                />
              );
            }
            const current =
              typeof picking === "number" ? items[picking] : undefined;
            return (
              <EffectCard
                key={t.id}
                script={t}
                frames={frames}
                layout={layout}
                active={current?.scriptId === t.id}
                onClick={() => {
                  if (current && current.scriptId !== t.id) {
                    update(picking as number, {
                      ...current,
                      scriptId: t.id,
                      params: {},
                    });
                  }
                  setPicking(null);
                }}
              />
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}
