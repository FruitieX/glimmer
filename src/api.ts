export type ScriptKind = "effect" | "transition";

export type Param =
  | {
      type: "number";
      label?: string;
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      default: number;
    }
  | { type: "boolean"; label?: string; default: boolean }
  | {
      type: "select";
      label?: string;
      options: string[];
      labels?: string[];
      default: string;
    };

export interface ColorSlot {
  id: string;
  label: string;
  default: string;
}

export interface Meta {
  name: string;
  description: string;
  params: Record<string, Param>;
  colors: ColorSlot[];
  category?: string;
  antialias?: boolean;
  loops: boolean;
}

export interface ScriptInfo {
  id: string;
  kind: ScriptKind;
  name: string;
  builtin: boolean;
  version: number;
  meta: Meta;
  updated: number;
}

export interface VersionInfo {
  version: number;
  note: string;
  author: string;
  created: number;
}

export interface Output {
  order: string;
  gamma: number;
  gains: [number, number, number];
  white: number;
}

export interface Gestalt {
  product_code?: string;
  device_name?: string;
  fw_family?: string;
  number_of_led: number;
  bytes_per_led?: number;
  led_profile?: string;
  frame_rate?: number;
  measured_frame_rate?: number;
  movie_capacity?: number;
  max_movies?: number;
}

export interface Device {
  id: string;
  name: string;
  ip: string;
  enabled: boolean;
  ledCount: number;
  output: Output;
  maxFps: number;
  preferMovies: boolean;
  allowClearingMovies: boolean;
  info: Gestalt | null;
  layout: {
    source: string;
    coordinates: unknown[];
    /** LEDs moved between their neighbours: the mapping put them far away. */
    repaired?: number[];
  } | null;
}

export type LayoutMode =
  | { kind: "device" }
  | { kind: "linear" }
  | { kind: "grid"; strand: number; zigzag: boolean };

export interface TransitionSpec {
  scriptId: string;
  durationMs: number;
  params: Record<string, unknown> | null;
}

export interface Fixture {
  id: string;
  name: string;
  deviceId: string;
  start: number;
  count: number;
  reversed: boolean;
  layout: LayoutMode;
  /** One of each list is picked at random each time; empty: instant. */
  transitions: {
    on: TransitionSpec[];
    off: TransitionSpec[];
    change: TransitionSpec[];
  };
  sort: number;
  /** Whether seasonal playlists switch this light over when their season starts. */
  seasonal: boolean;
}

export interface Look {
  scriptId: string;
  params: Record<string, unknown>;
  colors: string[];
}

export interface Selection {
  look: Look;
  presetId: string | null;
  playlistId: string | null;
  scheduled: Scheduled | null;
}

/** A playlist its season put on, and what comes back when it ends. */
export interface Scheduled {
  playlistId: string;
  /** Last day, YYYY-MM-DD. */
  until: string;
  resume: Selection;
}

export interface FixtureState {
  power: boolean;
  brightness: number;
  look: Look;
  presetId: string | null;
  playlistId: string | null;
  scheduled: Scheduled | null;
}

export interface PlaylistEntry {
  scriptId: string;
  presetId: string | null;
  params: Record<string, unknown>;
  colors: string[];
  durationS: number;
  enabled: boolean;
}

/** MM-DD dates, or days around Easter Sunday or Midsummer Eve. */
export type Season =
  | { from: string; to: string }
  | { easter: [number, number] }
  | { midsummer: [number, number] };

export interface Playlist {
  id: string;
  name: string;
  entries: PlaylistEntry[];
  shuffle: boolean;
  /** Used between entries instead of each light's own; empty: the light's. */
  transitions: TransitionSpec[];
  season: Season | null;
  autoEnabled: boolean;
  lights: string[] | null;
  builtin: boolean;
  sort: number;
}

/** What a light's playlist is showing right now. */
export interface Playing {
  playlistId: string;
  entry: number | null;
  startedAt: number;
  durationS: number;
}

export interface Preset {
  id: string;
  name: string;
  look: Look;
  sort: number;
}

export interface DeviceStatus {
  online: boolean;
  mode: string | null;
  output: "idle" | "live" | "movie";
  fps: number;
  lateFrames: number;
  error: string | null;
  movie: string | null;
  fixtureErrors: Record<string, string>;
  gestalt: Gestalt | null;
}

export interface FixtureLayout {
  aspect: number;
  points: [number, number, number][];
}

export interface AppState {
  user: string;
  devices: Device[];
  fixtures: {
    fixture: Fixture;
    state: FixtureState;
    layout: FixtureLayout | null;
    playing: Playing | null;
  }[];
  presets: Preset[];
  playlists: Playlist[];
  scripts: ScriptInfo[];
  status: Record<string, DeviceStatus>;
  ai: boolean;
}

export interface AuthStatus {
  user: string | null;
  oidc: boolean;
  devLogin: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers:
      init?.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const body = data as { message?: unknown } | null;
    const message =
      body && typeof body === "object" && typeof body.message === "string"
        ? body.message
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** Effective parameter values: the look's, with defaults filled in. */
export function paramValues(
  meta: Meta | undefined,
  params: Record<string, unknown> | null | undefined,
) {
  const values: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(meta?.params ?? {}))
    values[k] = p.default;
  return { ...values, ...(params ?? {}) };
}

/** Effective colours: the look's, with slot defaults filled in. */
export function colorValues(
  meta: Meta | undefined,
  colors: string[] | undefined,
) {
  const slots = meta?.colors ?? [];
  return slots.map((slot, i) => colors?.[i] ?? slot.default);
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "12-27" or "2026-12-27" as "27 Dec". */
export function dayLabel(date: string) {
  const [m, d] = date.split("-").slice(-2).map(Number);
  return `${d} ${MONTHS[m - 1] ?? "?"}`;
}

function days(n: number) {
  if (n === 0) return "";
  return ` ${n < 0 ? "−" : "+"}${Math.abs(n)}`;
}

/** A season in words: "1 Dec – 27 Dec", "Easter −7 to +1 days". */
export function seasonLabel(season: Season | null) {
  if (!season) return "Any time";
  if ("from" in season)
    return `${dayLabel(season.from)} – ${dayLabel(season.to)}`;
  const [name, [a, b]] =
    "easter" in season
      ? ["Easter", season.easter]
      : ["Midsummer Eve", season.midsummer];
  return a === b
    ? `${name}${days(a)}`
    : `${name}${days(a) || " +0"} to${days(b) || " +0"} days`;
}
