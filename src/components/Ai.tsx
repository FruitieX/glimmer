import { useCallback, useEffect, useMemo, useState } from "react";
import { Bookmark, Check, Lightbulb, Loader2, Wand2, X } from "lucide-react";
import {
  api,
  post,
  type EffectLook,
  type Look,
  type Meta,
  type Preset,
} from "../api";
import { usePreview } from "../live";
import { useApp } from "../main";
import { Mirror } from "./Mirror";
import { Swatches } from "./Looks";
import { Button, cx, Input, useAction } from "./ui";

/** "Preset N" with the lowest N no preset is called, as the server names it. */
export function nextPresetName(presets: Preset[]) {
  const taken = new Set(presets.map((p) => p.name.trim().toLowerCase()));
  let n = 1;
  while (taken.has(`preset ${n}`)) n++;
  return `Preset ${n}`;
}

/**
 * Saves `look` as "Preset N" and has the AI name it in the background; the
 * new name arrives as a change like any other.
 */
export async function saveNamedByAi(look: Look) {
  const preset = await post<Preset>("/presets", { name: "", look });
  await post(`/ai/name-preset/${encodeURIComponent(preset.id)}`);
  return preset;
}

const sources = new Map<string, Promise<string>>();

/** The saved code of an effect, fetched once per version. */
export function useScriptSource(id: string): string | null {
  const { state } = useApp();
  const version = state.scripts.find((s) => s.id === id)?.version ?? 0;
  const key = `${id}@${version}`;
  const [loaded, setLoaded] = useState<{ key: string; source: string } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    let promise = sources.get(key);
    if (!promise) {
      promise = api<{ source: string }>(
        `/scripts/${encodeURIComponent(id)}`,
      ).then((r) => r.source);
      sources.set(key, promise);
      promise.catch(() => sources.delete(key));
    }
    promise
      .then((source) => live && setLoaded({ key, source }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, key]);
  return loaded?.key === key ? loaded.source : null;
}

/** A live preview of an effect with some settings, rendered by the server. */
export function LookPreview({
  scriptId,
  params,
  colors,
  fixtureId,
  aspect,
  className,
}: {
  scriptId: string;
  params: Record<string, unknown>;
  colors: string[];
  /** A light's id or a simulated grid such as "grid:25x25". */
  fixtureId: string;
  aspect: number;
  className?: string;
}) {
  const source = useScriptSource(scriptId);
  const key = JSON.stringify([source, params, colors, fixtureId]);
  const request = useMemo(
    () =>
      source ? { kind: "effect", source, params, colors, fixtureId } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const preview = usePreview(request);
  const frame = useCallback(() => preview.frame.current, [preview.frame]);
  return (
    <div className={cx("bg-gradient-to-b from-night to-ink", className)}>
      {preview.points ? (
        <Mirror
          points={preview.points}
          aspect={aspect}
          source={frame}
          className="h-full"
          dot={0.9}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
    </div>
  );
}

/**
 * "Ask AI" for an effect's settings: a prompt, then up to four proposed
 * looks with live previews. Nothing changes until one is tried or saved.
 */
export function SuggestLooks({
  scriptId,
  meta,
  params,
  colors,
  fixtureId,
  aspect,
  onTry,
  tryLabel,
  wide,
}: {
  scriptId: string;
  meta: Meta;
  params: Record<string, unknown>;
  colors: string[];
  fixtureId: string;
  aspect: number;
  onTry: (look: EffectLook) => void;
  /** What trying does, e.g. "Show on the light". */
  tryLabel: string;
  /** Room for four cards in a row on large screens. */
  wide?: boolean;
}) {
  const { state, reload } = useApp();
  const { run, busy } = useAction();
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looks, setLooks] = useState<EffectLook[] | null>(null);
  const [tried, setTried] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  if (!state.ai) return null;
  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      const r = await post<{ looks: EffectLook[] }>("/ai/suggest-looks", {
        scriptId,
        prompt,
        params,
        colors,
      });
      setLooks(r.looks);
      setTried(null);
      setSaved([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && !asking) ask();
        }}
      >
        <Input
          aria-label={`Ask AI for ${meta.name} settings`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Warmer and slower, christmassy colours…"
          className="min-w-0 flex-1"
        />
        <Button disabled={asking || !prompt.trim()} className="shrink-0">
          {asking ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Wand2 size={16} />
          )}
          {asking ? "Asking…" : "Ask AI"}
        </Button>
      </form>
      {error && (
        <p className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      {looks && (
        <section aria-label="AI suggestions" className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-muted">
            <span>Nothing changes until you try or save one.</span>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-raised hover:text-white"
              onClick={() => setLooks(null)}
            >
              <X size={12} /> Dismiss
            </button>
          </div>
          <div
            className={cx(
              "grid gap-3 sm:grid-cols-2",
              wide && "lg:grid-cols-4",
            )}
          >
            {looks.map((look) => {
              const isSaved = saved.includes(look.name);
              return (
                <div
                  key={look.name}
                  className={cx(
                    "overflow-hidden rounded-xl ring-1",
                    tried === look.name
                      ? "bg-glow/5 ring-glow/60"
                      : "bg-raised/40 ring-line",
                  )}
                >
                  <LookPreview
                    scriptId={scriptId}
                    params={look.params}
                    colors={look.colors}
                    fixtureId={fixtureId}
                    aspect={aspect}
                    className="h-24"
                  />
                  <div className="space-y-2 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Swatches colors={look.colors} />
                      <span className="truncate text-sm font-medium">
                        {look.name}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        title={tryLabel}
                        aria-label={`Try ${look.name}`}
                        onClick={() => {
                          setTried(look.name);
                          onTry(look);
                        }}
                      >
                        <Lightbulb size={13} /> Try
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Save ${look.name} as a preset`}
                        disabled={busy || isSaved}
                        onClick={async () => {
                          const ok = await run(
                            () =>
                              post<Preset>("/presets", {
                                name: look.name,
                                look: {
                                  scriptId,
                                  params: look.params,
                                  colors: look.colors,
                                },
                              }),
                            `Saved ${look.name}`,
                          );
                          if (ok) {
                            setSaved((s) => [...s, look.name]);
                            reload();
                          }
                        }}
                      >
                        {isSaved ? <Check size={13} /> : <Bookmark size={13} />}
                        {isSaved ? "Saved" : "Save"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
