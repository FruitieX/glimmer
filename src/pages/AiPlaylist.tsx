import { useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Info,
  ListMusic,
  Loader2,
  Shuffle,
  Wand2,
} from "lucide-react";
import {
  del,
  post,
  seasonLabel,
  type Look,
  type Playlist,
  type Preset,
  type Season,
  type TransitionSpec,
} from "../api";
import { GRIDS, gridLayout } from "../live";
import { Link, useApp, useRoute } from "../main";
import { LookPreview } from "../components/Ai";
import { Swatches } from "../components/Looks";
import { Badge, Button, Card, cx, Input, Section } from "../components/ui";

/** A playlist the AI proposed, checked by the server; nothing is saved yet. */
interface Proposal {
  name: string;
  shuffle: boolean;
  season: Season | null;
  transitions: TransitionSpec[];
  entries: ProposedEntry[];
  newPresets: { name: string; look: Look }[];
  /** What the server left out or changed. */
  notes: string[];
}

interface ProposedEntry {
  scriptId: string;
  durationS: number;
  presetId: string | null;
  look: string | null;
  /** Index into `newPresets`. */
  newPreset: number | null;
  params: Record<string, unknown>;
  colors: string[];
}

const IDEAS = [
  "Cosy autumn evening, 10 effects, slow",
  "Christmas party: bright, lively and festive",
  "Calm winter night in blues and white",
];

function minutes(s: number) {
  return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 6) / 10} min`;
}

const checkbox = "h-4 w-4 shrink-0 accent-glow";

/**
 * "Create with AI": a prompt, then every change the AI proposes (the
 * playlist and each new preset) to approve one by one. Only "Create"
 * saves, and only what is ticked.
 */
export function AiPlaylistPage() {
  const { state, reload } = useApp();
  const { navigate } = useRoute();
  const [prompt, setPrompt] = useState("");
  const [asking, setAsking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [name, setName] = useState("");
  const [keepPlaylist, setKeepPlaylist] = useState(true);
  const [keepEntries, setKeepEntries] = useState<boolean[]>([]);
  const [keepPresets, setKeepPresets] = useState<boolean[]>([]);
  const light = state.fixtures.find((f) => f.layout?.points.length);
  const fixtureId = light?.fixture.id ?? GRIDS[1].value;
  const aspect = light?.layout?.aspect ?? gridLayout(fixtureId)?.aspect ?? 1;

  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      const p = await post<Proposal>("/ai/playlist", { prompt });
      setProposal(p);
      setName(p.name);
      setKeepPlaylist(true);
      setKeepEntries(p.entries.map(() => true));
      setKeepPresets(p.newPresets.map(() => true));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  const entryCount = keepEntries.filter(Boolean).length;
  const presetCount = keepPresets.filter(Boolean).length;
  const playlistOk = !keepPlaylist || (entryCount > 0 && !!name.trim());
  const changes = (keepPlaylist ? 1 : 0) + presetCount;

  /** New presets first, then the playlist using them; undone on failure. */
  const create = async () => {
    if (!proposal) return;
    setCreating(true);
    setError(null);
    const made: (Preset | undefined)[] = [];
    try {
      for (const [i, p] of proposal.newPresets.entries())
        if (keepPresets[i]) made[i] = await post<Preset>("/presets", p);
      let playlist: Playlist | null = null;
      if (keepPlaylist) {
        const entries = proposal.entries
          .filter((_, i) => keepEntries[i])
          .map((e) => ({
            scriptId: e.scriptId,
            presetId:
              e.presetId ??
              (e.newPreset != null ? (made[e.newPreset]?.id ?? null) : null),
            params: e.params,
            colors: e.colors,
            durationS: e.durationS,
            enabled: true,
          }));
        playlist = await post<Playlist>("/playlists", {
          name,
          shuffle: proposal.shuffle,
          season: proposal.season,
          transitions: proposal.transitions,
          autoEnabled: false,
          lights: null,
          entries,
        });
      }
      await reload();
      navigate(
        playlist
          ? `/playlists/${encodeURIComponent(playlist.id)}`
          : "/playlists",
      );
    } catch (e) {
      for (const p of made)
        if (p)
          await del(`/presets/${encodeURIComponent(p.id)}`).catch(() => {});
      setError(e instanceof Error ? e.message : String(e));
      reload();
    } finally {
      setCreating(false);
    }
  };

  const effectName = (id: string) =>
    state.scripts.find((s) => s.id === id)?.name ?? id;
  const lookLabel = (e: ProposedEntry) => {
    if (e.presetId)
      return `Preset ${state.presets.find((p) => p.id === e.presetId)?.name ?? e.presetId}`;
    if (e.newPreset != null) {
      const p = proposal?.newPresets[e.newPreset];
      return keepPresets[e.newPreset]
        ? `New preset ${p?.name}`
        : `${p?.name}'s settings, without a preset`;
    }
    return e.look ? `Look ${e.look}` : "Defaults";
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Link
          to="/playlists"
          className="rounded-xl p-2 text-muted hover:bg-raised hover:text-white"
          aria-label="Back"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create a playlist with AI
          </h1>
          <p className="text-sm text-muted">
            Describe it. You review every change before anything is saved.
          </p>
        </div>
      </div>

      <Card className="space-y-3 p-5">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim() && !asking) ask();
          }}
        >
          <textarea
            aria-label="Describe the playlist"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={IDEAS[0]}
            className="w-full resize-none rounded-xl bg-night p-3 text-sm ring-1 ring-line placeholder:text-muted/70 focus:ring-glow/60 focus:outline-none"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.metaKey || e.ctrlKey) &&
                prompt.trim()
              )
                ask();
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setPrompt(idea)}
                className="rounded-full bg-raised px-3 py-1.5 text-xs text-soft hover:text-white"
              >
                {idea}
              </button>
            ))}
            <Button
              variant={proposal ? "subtle" : "primary"}
              className="ml-auto"
              disabled={asking || !prompt.trim() || !state.ai}
            >
              {asking ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Wand2 size={16} />
              )}
              {asking
                ? "Thinking… (this can take a minute)"
                : proposal
                  ? "Propose again"
                  : "Propose"}
            </Button>
          </div>
        </form>
        {!state.ai && (
          <p className="text-sm text-muted">
            This needs an AI endpoint configured on the server.
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-bad/10 px-4 py-3 text-sm text-bad">
            {error}
          </p>
        )}
      </Card>

      {proposal && (
        <>
          {proposal.notes.length > 0 && (
            <div className="flex gap-3 rounded-2xl bg-raised/50 px-4 py-3 text-sm text-muted ring-1 ring-line">
              <Info size={16} className="mt-0.5 shrink-0 text-glow" />
              <ul className="space-y-1">
                {proposal.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}

          <Section title="New playlist">
            <Card
              className={cx(
                "divide-y divide-line",
                !keepPlaylist && "opacity-60",
              )}
            >
              <div className="space-y-3 p-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className={checkbox}
                    checked={keepPlaylist}
                    onChange={(e) => setKeepPlaylist(e.target.checked)}
                    aria-label="Create the playlist"
                  />
                  <ListMusic size={16} className="shrink-0 text-glow" />
                  <Input
                    aria-label="Playlist name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="min-w-0 flex-1"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 pl-7">
                  <Badge>
                    {entryCount} of {proposal.entries.length} effects
                  </Badge>
                  {proposal.shuffle && (
                    <Badge>
                      <Shuffle size={11} /> Shuffle
                    </Badge>
                  )}
                  {proposal.season && (
                    <Badge tone="glow">
                      {seasonLabel(proposal.season)} · not scheduled yet
                    </Badge>
                  )}
                  {proposal.transitions.map((t, i) => (
                    <Badge key={i}>
                      {effectName(t.scriptId)} between effects
                    </Badge>
                  ))}
                </div>
              </div>
              {proposal.entries.map((e, i) => (
                <label
                  key={i}
                  className={cx(
                    "flex items-center gap-3 px-4 py-2.5",
                    !keepEntries[i] && "opacity-50",
                  )}
                >
                  <input
                    type="checkbox"
                    className={checkbox}
                    checked={keepEntries[i] ?? false}
                    disabled={!keepPlaylist}
                    onChange={(ev) =>
                      setKeepEntries(
                        keepEntries.map((k, j) =>
                          j === i ? ev.target.checked : k,
                        ),
                      )
                    }
                    aria-label={`Include ${effectName(e.scriptId)} (${i + 1})`}
                  />
                  <LookPreview
                    scriptId={e.scriptId}
                    params={e.params}
                    colors={e.colors}
                    fixtureId={fixtureId}
                    aspect={aspect}
                    className="h-14 w-20 shrink-0 overflow-hidden rounded-lg sm:w-28"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {effectName(e.scriptId)}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                      <Swatches colors={e.colors} />
                      <span className="truncate">{lookLabel(e)}</span>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {minutes(e.durationS)}
                  </span>
                </label>
              ))}
            </Card>
          </Section>

          {proposal.newPresets.length > 0 && (
            <Section title="New presets">
              <Card className="divide-y divide-line">
                {proposal.newPresets.map((p, i) => (
                  <label
                    key={i}
                    className={cx(
                      "flex items-center gap-3 px-4 py-2.5",
                      !keepPresets[i] && "opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      className={checkbox}
                      checked={keepPresets[i] ?? false}
                      onChange={(ev) =>
                        setKeepPresets(
                          keepPresets.map((k, j) =>
                            j === i ? ev.target.checked : k,
                          ),
                        )
                      }
                      aria-label={`Create the preset ${p.name}`}
                    />
                    <LookPreview
                      scriptId={p.look.scriptId}
                      params={p.look.params}
                      colors={p.look.colors}
                      fixtureId={fixtureId}
                      aspect={aspect}
                      className="h-14 w-20 shrink-0 overflow-hidden rounded-lg sm:w-28"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Bookmark size={13} className="shrink-0 text-glow" />
                        <span className="truncate">{p.name}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                        <Swatches colors={p.look.colors} />
                        <span className="truncate">
                          {effectName(p.look.scriptId)}
                        </span>
                      </div>
                    </div>
                  </label>
                ))}
              </Card>
              <p className="text-xs text-muted">
                An entry whose preset you untick keeps the same settings without
                one.
              </p>
            </Section>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              disabled={creating}
              onClick={() => navigate("/playlists")}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              disabled={creating || changes === 0 || !playlistOk}
              onClick={create}
            >
              {creating && <Loader2 size={16} className="animate-spin" />}
              {changes === 0
                ? "Nothing ticked"
                : `Create (${changes} ${changes === 1 ? "change" : "changes"})`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
