import type { ColorSlot, Param } from "../api";
import { Select, Slider, Toggle } from "./ui";

function format(v: number, step = 0.01) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals);
}

/** Controls for an effect's or transition's parameters. */
export function ParamControls({
  params,
  values,
  onChange,
  onCommit,
}: {
  params: Record<string, Param>;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onCommit?: (key: string, value: unknown) => void;
}) {
  const entries = Object.entries(params);
  if (!entries.length)
    return <p className="text-sm text-muted">This one has no settings.</p>;
  return (
    <div className="space-y-4">
      {entries.map(([key, p]) => {
        const label = p.label || key;
        const value = values[key] ?? p.default;
        if (p.type === "boolean") {
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-soft">{label}</span>
              <Toggle
                label={label}
                checked={Boolean(value)}
                onChange={(v) => {
                  onChange(key, v);
                  onCommit?.(key, v);
                }}
              />
            </div>
          );
        }
        if (p.type === "select") {
          return (
            <div key={key} className="space-y-1.5">
              <span className="text-sm text-soft">{label}</span>
              <Select
                label={label}
                value={String(value)}
                options={p.options.map((o, i) => ({
                  value: o,
                  label: p.labels?.[i] ?? o,
                }))}
                onChange={(v) => {
                  onChange(key, v);
                  onCommit?.(key, v);
                }}
              />
            </div>
          );
        }
        const num = typeof value === "number" ? value : Number(value) || 0;
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-soft">{label}</span>
              <span className="font-mono text-xs text-muted tabular-nums">
                {format(num, p.step)}
                {p.unit ? ` ${p.unit}` : ""}
              </span>
            </div>
            <Slider
              label={label}
              value={num}
              min={p.min ?? 0}
              max={p.max ?? 1}
              step={p.step ?? 0.01}
              onChange={(v) => onChange(key, v)}
              onCommit={(v) => onCommit?.(key, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Colour pickers for an effect's colour slots. */
export function ColorControls({
  slots,
  values,
  onChange,
}: {
  slots: ColorSlot[];
  values: string[];
  onChange: (colors: string[]) => void;
}) {
  if (!slots.length) return null;
  return (
    <div className="flex flex-wrap gap-4">
      {slots.map((slot, i) => (
        <label key={slot.id} className="flex flex-col items-center gap-1.5">
          <input
            type="color"
            className="swatch"
            aria-label={slot.label || slot.id}
            value={values[i] ?? slot.default}
            onChange={(e) => {
              const next = slots.map((s, j) => values[j] ?? s.default);
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <span className="text-xs text-muted">{slot.label || slot.id}</span>
        </label>
      ))}
    </div>
  );
}
