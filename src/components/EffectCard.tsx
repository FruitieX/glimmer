import { useCallback, useEffect, useRef, type ReactNode } from "react";
import type { FixtureLayout, ScriptInfo } from "../api";
import type { Gallery } from "../live";
import { Mirror } from "./Mirror";
import { cx } from "./ui";

/** Tells the gallery while a thumbnail of `id` is on screen. */
function useWatch(frames: Gallery, id: string) {
  const on = useRef(false);
  useEffect(
    () => () => {
      if (on.current) frames.watch(id, false);
      on.current = false;
    },
    [frames, id],
  );
  return useCallback(
    (visible: boolean) => {
      if (visible === on.current) return;
      on.current = visible;
      frames.watch(id, visible);
    },
    [frames, id],
  );
}

/** A script with a live thumbnail from the gallery stream. */
export function EffectCard({
  script,
  frames,
  layout,
  active,
  badge,
  onClick,
}: {
  script: ScriptInfo;
  frames: Gallery;
  layout: FixtureLayout;
  active?: boolean;
  badge?: ReactNode;
  onClick: () => void;
}) {
  const source = useCallback(() => frames.get(script.id), [frames, script.id]);
  const onVisible = useWatch(frames, script.id);
  return (
    <button
      onClick={onClick}
      className={cx(
        "group overflow-hidden rounded-2xl text-left ring-1 transition",
        active
          ? "bg-glow/10 ring-glow/60"
          : "bg-panel/80 ring-line hover:ring-glow/30",
      )}
    >
      <div className="bg-gradient-to-b from-night to-ink">
        <Mirror
          points={layout.points}
          aspect={layout.aspect}
          source={source}
          className="h-28"
          dot={0.9}
          onVisible={onVisible}
        />
      </div>
      <div className="p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{script.name}</span>
          {badge}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted">
          {script.meta.description || "No description"}
        </p>
      </div>
    </button>
  );
}

/** A small live thumbnail of one effect or transition. */
export function Thumb({
  scriptId,
  frames,
  layout,
  className,
}: {
  scriptId: string;
  frames: Gallery;
  layout: FixtureLayout;
  className?: string;
}) {
  const source = useCallback(() => frames.get(scriptId), [frames, scriptId]);
  const onVisible = useWatch(frames, scriptId);
  return (
    <div className={cx("bg-gradient-to-b from-night to-ink", className)}>
      <Mirror
        points={layout.points}
        aspect={layout.aspect}
        source={source}
        className="h-full"
        dot={0.8}
        onVisible={onVisible}
      />
    </div>
  );
}
