import { useEffect, useId, useMemo, useRef, useState } from "react";

interface Props {
  /** Drawing position of every LED (see `drawPositions`). */
  xy: [number, number][];
  aspect: number;
  /** Index of the light owning each LED, -1 for none. */
  owner: number[];
  /** Colour and name per light. */
  colors: string[];
  names: string[];
  /** LEDs to circle, e.g. ones that sit apart from their light. */
  rings?: Set<number>;
  /** When set, only these LEDs are drawn at full strength. */
  focus?: Set<number> | null;
  className?: string;
}

/**
 * Every LED of a string at its mapped position, coloured by the light it
 * belongs to. Hovering or tapping an LED names it.
 */
export function StringMap({
  xy,
  aspect,
  owner,
  colors,
  names,
  rings,
  focus,
  className = "",
}: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const glow = `led-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const a = Math.min(Math.max(aspect || 1, 0.25), 6);
  const W = 1000;
  const H = W / a;
  const pad = 24;
  const at = useMemo(
    () =>
      xy.map(
        ([x, y]) =>
          [pad + x * (W - pad * 2), pad + y * (H - pad * 2)] as [
            number,
            number,
          ],
      ),
    [xy, H],
  );
  // Typical distance between neighbouring LEDs along the wire.
  const step = useMemo(() => {
    const d = at
      .slice(1)
      .map(([x, y], i) => Math.hypot(x - at[i][0], y - at[i][1]))
      .filter((v) => v > 0)
      .sort((p, q) => p - q);
    return d.length ? d[d.length >> 1] : W / 20;
  }, [at]);
  // Screen pixels per viewBox unit, to keep dots between 1.6 and 7 px.
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) setScale(Math.min(width / W, height / H));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [H]);
  const r = Math.min(7 / scale, Math.max(1.6 / scale, step * 0.42));

  const nearest = (e: React.MouseEvent) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    // Fingers need a bigger target than mice.
    const kind = (e.nativeEvent as PointerEvent).pointerType;
    const reach = (kind === "mouse" ? 12 : 24) / m.a + r;
    let best: number | null = null;
    let bestD = reach;
    at.forEach(([x, y], i) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const active = hover ?? pinned;
  const describe = (i: number) => {
    const o = owner[i];
    return o >= 0 ? `LED ${i} · ${names[o]}` : `LED ${i} · not in a light`;
  };

  return (
    <div className={className}>
      <div
        ref={box}
        className="relative h-56 overflow-hidden rounded-xl bg-night ring-1 ring-line sm:h-72"
      >
        <svg
          ref={svg}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 h-full w-full touch-pan-y"
          role="img"
          aria-label="Map of the string's LEDs, coloured by light"
          onPointerMove={(e) =>
            e.pointerType === "mouse" && setHover(nearest(e))
          }
          onPointerLeave={() => setHover(null)}
          onClick={(e) => setPinned(nearest(e))}
        >
          <defs>
            <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation={r * 0.9} />
            </filter>
          </defs>
          <g filter={`url(#${glow})`} opacity={0.55}>
            {at.map(([x, y], i) => {
              const o = owner[i];
              if (o < 0 || (focus && !focus.has(i))) return null;
              return (
                <circle key={i} cx={x} cy={y} r={r * 1.6} fill={colors[o]} />
              );
            })}
          </g>
          {at.map(([x, y], i) => {
            const o = owner[i];
            const dim = o < 0 || (focus ? !focus.has(i) : false);
            return (
              <circle
                key={i}
                data-led={i}
                cx={x}
                cy={y}
                r={r}
                fill={o < 0 ? "#ffffff" : colors[o]}
                opacity={o < 0 ? 0.13 : dim ? 0.3 : 1}
              />
            );
          })}
          {rings &&
            [...rings].map((i) =>
              at[i] ? (
                <circle
                  key={`ring-${i}`}
                  cx={at[i][0]}
                  cy={at[i][1]}
                  r={Math.max(r * 2.6, 9 / scale)}
                  fill="none"
                  stroke="var(--color-warn)"
                  strokeWidth={1.75 / scale}
                  strokeDasharray={`${3.5 / scale} ${2.5 / scale}`}
                />
              ) : null,
            )}
          {active !== null && at[active] && (
            <circle
              cx={at[active][0]}
              cy={at[active][1]}
              r={Math.max(r * 1.9, 7 / scale)}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1.75 / scale}
            />
          )}
        </svg>
      </div>
      <p className="mt-1.5 h-4 font-mono text-xs text-soft" aria-live="polite">
        {active !== null && active < xy.length ? (
          describe(active)
        ) : (
          <span className="font-sans text-muted">
            Hover or tap an LED to see its number and light.
          </span>
        )}
      </p>
    </div>
  );
}
