import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  /** CSS background for the whole track (e.g. a hue gradient); a glowing fill otherwise. */
  track?: string;
  /** Thumb colour, e.g. the colour being picked. */
  thumb?: string;
  disabled?: boolean;
}

/**
 * A slider that is safe to scroll past on touch screens: a finger only moves it
 * after dragging sideways, so taps and vertical swipes scroll the page.
 * Mice drag immediately; arrow keys, Page Up/Down, Home and End work too.
 */
export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  onCommit,
  label,
  track,
  thumb,
  disabled,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    dragging: boolean;
    id: number;
  } | null>(null);
  // While dragging (and briefly after), show the dragged value: echoes of
  // earlier values from the server would otherwise pull the thumb back.
  const [held, setHeld] = useState<number | null>(null);
  const release = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(release.current), []);
  const hold = (v: number) => {
    clearTimeout(release.current);
    setHeld(v);
  };
  const letGo = () => {
    clearTimeout(release.current);
    release.current = setTimeout(() => setHeld(null), 1000);
  };
  if (held !== null) value = held;
  const last = useRef(value);
  last.current = value;
  const span = max - min || 1;
  const fraction = Math.min(1, Math.max(0, (value - min) / span));

  const quantise = (v: number) => {
    const q = Math.round((v - min) / step) * step + min;
    const decimals = (String(step).split(".")[1] ?? "").length;
    return Math.min(max, Math.max(min, Number(q.toFixed(decimals))));
  };
  const fromX = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return value;
    const thumbPad = 11;
    const p =
      (clientX - r.left - thumbPad) / Math.max(1, r.width - thumbPad * 2);
    return quantise(min + Math.min(1, Math.max(0, p)) * span);
  };
  const set = (v: number) => {
    hold(v);
    if (v !== last.current) {
      last.current = v;
      onChange(v);
    }
  };

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      className={`relative h-9 w-full select-none ${disabled ? "opacity-40" : "cursor-pointer"} rounded-full focus-visible:outline-2 focus-visible:outline-glow`}
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        gesture.current = {
          x: e.clientX,
          y: e.clientY,
          dragging: e.pointerType === "mouse",
          id: e.pointerId,
        };
        if (e.pointerType === "mouse") {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(fromX(e.clientX));
        }
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.id !== e.pointerId) return;
        if (!g.dragging) {
          const dx = Math.abs(e.clientX - g.x);
          const dy = Math.abs(e.clientY - g.y);
          if (dy > 8 && dy > dx) {
            gesture.current = null; // scrolling
            return;
          }
          if (dx < 8) return;
          g.dragging = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        set(fromX(e.clientX));
      }}
      onPointerUp={(e) => {
        const g = gesture.current;
        gesture.current = null;
        if (g?.dragging) {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          onCommit?.(last.current);
        }
        letGo();
      }}
      onPointerCancel={() => {
        if (gesture.current?.dragging) onCommit?.(last.current);
        gesture.current = null;
        letGo();
      }}
      onKeyDown={(e) => {
        if (disabled) return;
        const big = step * 10 > span / 5 ? step : step * 10;
        const keys: Record<string, number> = {
          ArrowRight: value + step,
          ArrowUp: value + step,
          ArrowLeft: value - step,
          ArrowDown: value - step,
          PageUp: value + big,
          PageDown: value - big,
          Home: min,
          End: max,
        };
        if (e.key in keys) {
          e.preventDefault();
          const v = quantise(keys[e.key]);
          set(v);
          onCommit?.(v);
          letGo();
        }
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line"
        style={track ? { background: track, height: 10 } : undefined}
      >
        {!track && (
          <div
            className="h-full rounded-full bg-gradient-to-r from-glow to-glow-2"
            style={{ width: `calc(11px + ${fraction} * (100% - 22px))` }}
          />
        )}
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-[22px] w-[22px] -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_14px_rgb(255_181_71/0.45)]"
        style={{
          left: `calc(${fraction} * (100% - 22px))`,
          background: thumb ?? "#fff",
        }}
      />
    </div>
  );
}
