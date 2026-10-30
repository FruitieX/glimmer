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
  layout: { source: string; coordinates: unknown[] } | null;
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
  transitions: {
    on: TransitionSpec;
    off: TransitionSpec;
    change: TransitionSpec;
  };
  sort: number;
}

export interface Look {
  scriptId: string;
  params: Record<string, unknown>;
  colors: string[];
}

export interface FixtureState {
  power: boolean;
  brightness: number;
  look: Look;
  presetId: string | null;
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
  }[];
  presets: Preset[];
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
