import { colorValues, isLook, type EffectLook, type Meta } from "../api";
import { cx } from "./ui";

/** The defaults, as a look, shown before an effect's own looks. */
export function defaultLook(meta: Meta): EffectLook {
  return {
    name: "Default",
    params: {},
    colors: colorValues(meta, []),
  };
}

/**
 * Chips for an effect's built-in looks (and its defaults); the one the
 * current settings show is highlighted. Nothing when it has no looks.
 */
export function LookChips({
  meta,
  params,
  colors,
  onPick,
  disabled,
}: {
  meta: Meta;
  params: Record<string, unknown> | null | undefined;
  colors: string[] | undefined;
  onPick: (look: EffectLook) => void;
  disabled?: boolean;
}) {
  if (!meta.looks?.length) return null;
  const looks = [defaultLook(meta), ...meta.looks];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Looks">
      {looks.map((look) => {
        const active = isLook(meta, look, params, colors);
        return (
          <button
            key={look.name}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(look)}
            className={cx(
              "flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-2 text-[13px] font-medium ring-1 transition disabled:opacity-60",
              active
                ? "bg-glow/15 text-glow ring-glow/50"
                : "bg-raised text-soft ring-line hover:text-white",
            )}
          >
            <Swatches colors={colorValues(meta, look.colors)} />
            {look.name}
          </button>
        );
      })}
    </div>
  );
}

/** A tiny strip of a look's colours. */
export function Swatches({ colors }: { colors: string[] }) {
  if (!colors.length)
    return <span className="h-3 w-3 rounded-full bg-line" aria-hidden />;
  return (
    <span
      className="flex h-3 overflow-hidden rounded-full ring-1 ring-black/40"
      aria-hidden
    >
      {colors.slice(0, 5).map((c, i) => (
        <span key={i} className="h-3 w-2.5" style={{ background: c }} />
      ))}
    </span>
  );
}
