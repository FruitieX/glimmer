import type { ScriptInfo } from "../api";
import { cx } from "./ui";

export const CATEGORIES = [
  "Basics",
  "Gradients & patterns",
  "Plasma & flow",
  "Nature",
  "Particles & physics",
  "Simulations & games",
  "Fractals",
  "Seasonal",
  "Images",
  "Other",
];

export function categoryOf(s: ScriptInfo) {
  const c = s.meta.category?.trim();
  if (c && CATEGORIES.includes(c)) return c;
  return s.builtin ? "Other" : "Mine";
}

/** Scripts grouped by category, in a fixed order; user scripts without one go under "Mine". */
export function groupByCategory(scripts: ScriptInfo[]) {
  const groups = new Map<string, ScriptInfo[]>();
  for (const s of scripts) {
    const c = categoryOf(s);
    groups.set(c, [...(groups.get(c) ?? []), s]);
  }
  const order = ["Mine", ...CATEGORIES];
  return [...groups.entries()].sort(
    ([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  );
}

export function CategoryChips({
  groups,
  value,
  onChange,
  all = true,
}: {
  groups: (readonly [string, readonly unknown[]])[];
  value: string;
  onChange: (c: string) => void;
  all?: boolean;
}) {
  const options = [
    ...(all
      ? [["All", groups.reduce((n, [, s]) => n + s.length, 0)] as const]
      : []),
    ...groups.map(([c, s]) => [c, s.length] as const),
  ];
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
      {options.map(([c, n]) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cx(
            "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium ring-1 transition",
            value === c
              ? "bg-glow/15 text-glow ring-glow/50"
              : "text-muted ring-line hover:text-white",
          )}
        >
          {c} <span className="opacity-60">{n}</span>
        </button>
      ))}
    </div>
  );
}
