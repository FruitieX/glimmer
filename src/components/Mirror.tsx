import { useEffect, useRef } from "react";

interface Props {
  points: [number, number, number][];
  aspect?: number;
  /** Returns the newest RGB bytes (3 per LED), or null for nothing yet. */
  source: () => Uint8Array | null | undefined;
  className?: string;
  /** Multiplier for LED dot size. */
  dot?: number;
}

/** Draws LEDs at their positions with a soft glow. */
export function Mirror({
  points,
  aspect = 1,
  source,
  className = "",
  dot = 1,
}: Props) {
  const crisp = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let last: Uint8Array | null | undefined = undefined;
    let size = { w: 0, h: 0, dpr: 1 };
    const resize = () => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      size = {
        w: r.width,
        h: r.height,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      };
      for (const c of [crisp.current, glow.current]) {
        if (!c) continue;
        c.width = Math.max(1, Math.round(size.w * size.dpr));
        c.height = Math.max(1, Math.round(size.h * size.dpr));
      }
      last = undefined;
    };
    const observer = new ResizeObserver(resize);
    if (box.current) observer.observe(box.current);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const data = source();
      if (data === last) return;
      last = data;
      const { w, h, dpr } = size;
      if (!w || !h) return;
      // Fit the fixture's shape into the box.
      const a = Math.min(Math.max(aspect || 1, 0.25), 6);
      const pad = 14;
      let fw = w - pad * 2;
      let fh = fw / a;
      if (fh > h - pad * 2) {
        fh = h - pad * 2;
        fw = fh * a;
      }
      const ox = (w - fw) / 2;
      const oy = (h - fh) / 2;
      const n = points.length || 1;
      const r = Math.max(
        1.6,
        Math.min(7, Math.sqrt((fw * fh) / n) * 0.32 * dot),
      );
      for (const [canvas, isGlow] of [
        [crisp.current, false],
        [glow.current, true],
      ] as const) {
        const ctx = canvas?.getContext("2d");
        if (!ctx) continue;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < points.length; i++) {
          const [x, y] = points[i];
          const px = ox + x * fw;
          const py = oy + (1 - y) * fh;
          const cr = data ? data[i * 3] : 0;
          const cg = data ? data[i * 3 + 1] : 0;
          const cb = data ? data[i * 3 + 2] : 0;
          const lit = cr + cg + cb > 6;
          if (!lit) {
            if (isGlow) continue;
            ctx.fillStyle = "rgba(255,255,255,0.07)";
          } else {
            ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
          }
          ctx.beginPath();
          ctx.arc(px, py, isGlow ? r * 1.9 : r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [points, aspect, source, dot]);

  return (
    <div ref={box} className={`relative overflow-hidden ${className}`}>
      <canvas
        ref={glow}
        className="absolute inset-0 h-full w-full"
        style={{ filter: "blur(9px) saturate(1.5)", opacity: 0.9 }}
        aria-hidden
      />
      <canvas
        ref={crisp}
        className="absolute inset-0 h-full w-full"
        aria-hidden
      />
    </div>
  );
}
