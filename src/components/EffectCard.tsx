import { useCallback, type ReactNode } from "react";
import type { FixtureLayout, ScriptInfo } from "../api";
import { Mirror } from "./Mirror";
import { cx } from "./ui";

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
  frames: Map<string, Uint8Array>;
  layout: FixtureLayout;
  active?: boolean;
  badge?: ReactNode;
  onClick: () => void;
}) {
  const source = useCallback(() => frames.get(script.id), [frames, script.id]);
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
