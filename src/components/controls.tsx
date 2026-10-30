import type { ColorSlot, Param } from "../api";
import { useEffect, useState } from "react";
import { cx, Select, Slider, Toggle } from "./ui";

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

function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16) || 0;
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [h * 60, max ? d / max : 0, max];
}

function hsvToHex(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

const SWATCHES = [
  "#ff9329",
  "#ffd6a0",
  "#ffffff",
  "#ff2a2a",
  "#ff7a00",
  "#ffd000",
  "#3cff6e",
  "#00e0ff",
  "#2a5cff",
  "#9b3bff",
  "#ff3bb0",
];

/** Hue, saturation and brightness sliders for one colour, like homectl's. */
export function ColorEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  // Keep hue/saturation while the colour is black or grey, so they don't jump.
  const [hsv, setHsv] = useState<[number, number, number]>(() =>
    hexToHsv(value),
  );
  useEffect(() => {
    if (hsvToHex(...hsv) !== value.toLowerCase()) setHsv(hexToHsv(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const [h, sat, v] = hsv;
  const update = (next: [number, number, number]) => {
    setHsv(next);
    onChange(hsvToHex(...next));
  };
  const hues = Array.from({ length: 7 }, (_, i) => hsvToHex(i * 60, 1, 1)).join(
    ", ",
  );
  return (
    <div className="space-y-2">
      <div>
        <div className="flex justify-between text-xs text-muted">
          <span>Hue</span>
          <span className="tabular-nums">{Math.round(h)}°</span>
        </div>
        <Slider
          label="Hue"
          value={h}
          min={0}
          max={359}
          step={1}
          track={`linear-gradient(to right, ${hues})`}
          thumb={hsvToHex(h, 1, 1)}
          onChange={(x) => update([x, sat, v])}
        />
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted">
          <span>Saturation</span>
          <span className="tabular-nums">{Math.round(sat * 100)}%</span>
        </div>
        <Slider
          label="Saturation"
          value={sat}
          track={`linear-gradient(to right, ${hsvToHex(h, 0, 1)}, ${hsvToHex(h, 1, 1)})`}
          thumb={hsvToHex(h, sat, 1)}
          onChange={(x) => update([h, x, v])}
        />
      </div>
      <div>
        <div className="flex justify-between text-xs text-muted">
          <span>Brightness</span>
          <span className="tabular-nums">{Math.round(v * 100)}%</span>
        </div>
        <Slider
          label="Colour brightness"
          value={v}
          track={`linear-gradient(to right, #000, ${hsvToHex(h, sat, 1)})`}
          thumb={hsvToHex(h, sat, v)}
          onChange={(x) => update([h, sat, x])}
        />
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            aria-label={`Use ${c}`}
            onClick={() => update(hexToHsv(c))}
            className="h-7 w-7 rounded-full ring-1 ring-white/15 transition hover:scale-110"
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

/** Colour slots of an effect: tap a swatch to edit it. */
export function ColorControls({
  slots,
  values,
  onChange,
}: {
  slots: ColorSlot[];
  values: string[];
  onChange: (colors: string[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(
    slots.length === 1 ? 0 : null,
  );
  if (!slots.length) return null;
  const current = slots.map((s, j) => values[j] ?? s.default);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {slots.map((slot, i) => (
          <button
            key={slot.id}
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className={cx(
              "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm ring-1 transition",
              open === i
                ? "bg-raised text-white ring-glow/60"
                : "text-soft ring-line hover:text-white",
            )}
          >
            <span
              className="h-7 w-7 rounded-full ring-1 ring-white/20"
              style={{
                background: current[i],
                boxShadow: `0 0 14px ${current[i]}66`,
              }}
            />
            {slot.label || slot.id}
          </button>
        ))}
      </div>
      {open !== null && slots[open] && (
        <ColorEditor
          value={current[open]}
          onChange={(hex) => {
            const next = [...current];
            next[open] = hex;
            onChange(next);
          }}
        />
      )}
    </div>
  );
}
