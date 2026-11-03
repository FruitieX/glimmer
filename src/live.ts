import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DeviceStatus } from "./api";

/** Latest colours per fixture, updated without re-rendering React. */
export const frames = new Map<string, Uint8Array>();

type Listener = () => void;
const statusListeners = new Set<Listener>();
const changeListeners = new Set<Listener>();
let status: Record<string, DeviceStatus> = {};
let connected = false;
const connectionListeners = new Set<Listener>();

function notify(set: Set<Listener>) {
  for (const l of set) l();
}

let socket: WebSocket | null = null;
let retry = 1000;

function connect() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  socket = ws;
  ws.onopen = () => {
    retry = 1000;
    connected = true;
    notify(connectionListeners);
    // Something may have changed while we were away.
    notify(changeListeners);
  };
  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(e.data);
      const len = bytes[0];
      const id = new TextDecoder().decode(bytes.subarray(1, 1 + len));
      frames.set(id, bytes.subarray(1 + len));
      return;
    }
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "status") {
        status = msg.status;
        notify(statusListeners);
      } else if (msg.type === "changed" || msg.type === "state") {
        notify(changeListeners);
      }
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    connected = false;
    notify(connectionListeners);
    socket = null;
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 15000);
  };
}

export function startLive() {
  if (!socket) connect();
}

export function useStatus(): Record<string, DeviceStatus> {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => statusListeners.delete(l);
    },
    () => status,
  );
}

export function useConnected(): boolean {
  return useSyncExternalStore(
    (l) => {
      connectionListeners.add(l);
      return () => connectionListeners.delete(l);
    },
    () => connected,
  );
}

/** Calls `f` (debounced) whenever the server reports a change. */
export function useOnChange(f: () => void) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const l = () => {
      clearTimeout(timer);
      timer = setTimeout(f, 120);
    };
    changeListeners.add(l);
    return () => {
      clearTimeout(timer);
      changeListeners.delete(l);
    };
  }, [f]);
}

/** A preview socket that renders a script server-side. */
export function usePreview(request: unknown | null) {
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<unknown>(null);
  const [points, setPoints] = useState<[number, number, number][] | null>(null);
  const [frame] = useState(() => ({ current: null as Uint8Array | null }));
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/preview`;
    let closed = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      // A hidden tab does not render, so the server has nothing to do.
      if (closed || document.hidden) return;
      if (socket && socket.readyState <= WebSocket.OPEN) return;
      const ws = new WebSocket(url);
      socket = ws;
      ws.binaryType = "arraybuffer";
      ws.onopen = () => setWs(ws);
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          frame.current = new Uint8Array(e.data);
          return;
        }
        const msg = JSON.parse(e.data);
        if (msg.type === "error") setError(msg.error);
        if (msg.type === "meta") {
          setError(null);
          setMeta(msg.meta);
          setPoints(msg.points);
        }
      };
      ws.onclose = () => {
        if (socket === ws) socket = null;
        setWs((cur) => (cur === ws ? null : cur));
        if (!closed && !document.hidden) timer = setTimeout(open, 2000);
      };
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        socket?.close();
        socket = null;
        setWs(null);
      } else {
        open();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      socket?.close();
    };
  }, [frame]);

  const body = request ? JSON.stringify(request) : null;
  const sentSource = useRef<string | null>(null);
  useEffect(() => {
    if (!ws || !body) return;
    const source = (request as { source?: string }).source ?? null;
    const send = () => {
      sentSource.current = source;
      ws.send(body);
    };
    // Settings changes go out right away (the server updates the running
    // effect); code edits wait for a pause in typing.
    if (source === sentSource.current) {
      const f = requestAnimationFrame(send);
      return () => cancelAnimationFrame(f);
    }
    const t = setTimeout(send, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, body]);
  useEffect(() => {
    sentSource.current = null;
  }, [ws]);

  return { error, meta, points, frame };
}

/** Live thumbnails keyed by script id, plus which cards are on screen. */
export type Gallery = Map<string, Uint8Array> & {
  /**
   * Marks a card visible or hidden; the server renders only visible ones.
   * Counted, so several cards can show the same script: call it once with
   * false for each true.
   */
  watch(id: string, visible: boolean): void;
};

/** Live thumbnails of effects or transitions, rendered only while on screen. */
export function useGallery(
  kind: "effect" | "transition",
  fixtureId?: string,
): Gallery {
  const [gallery] = useState(() => {
    const g = new Map<string, Uint8Array>() as Gallery;
    const visible = new Map<string, number>();
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ visible: [...visible.keys()] }));
    };
    g.watch = (id, on) => {
      const count = (visible.get(id) ?? 0) + (on ? 1 : -1);
      if (count > 0) visible.set(id, count);
      else visible.delete(id);
      if (count > 0 === count - (on ? 1 : -1) > 0) return;
      clearTimeout(timer);
      timer = setTimeout(send, 60);
    };
    return Object.assign(g, {
      attach(ws: WebSocket | null) {
        socket = ws;
      },
      sendVisible: send,
    });
  });
  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/gallery`;
    let closed = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    const g = gallery as Gallery & {
      attach(ws: WebSocket | null): void;
      sendVisible(): void;
    };
    const open = () => {
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        g.attach(socket);
        g.sendVisible();
        socket.send(JSON.stringify({ kind, fixtureId }));
      };
      socket.onmessage = (e) => {
        if (!(e.data instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(e.data);
        const len = bytes[0];
        g.set(
          new TextDecoder().decode(bytes.subarray(1, 1 + len)),
          bytes.subarray(1 + len),
        );
      };
      socket.onclose = () => {
        g.attach(null);
        if (!closed) timer = setTimeout(open, 3000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      g.attach(null);
      socket?.close();
    };
  }, [kind, fixtureId, gallery]);
  return gallery;
}

/** LED positions of `cols` strands of `rows` LEDs, hanging from the top. */
export function gridPoints(cols: number, rows: number) {
  return Array.from(
    { length: cols * rows },
    (_, i) =>
      [
        Math.floor(i / rows) / Math.max(1, cols - 1),
        1 - (i % rows) / Math.max(1, rows - 1),
        0.5,
      ] as [number, number, number],
  );
}

/** The grid the server previews on when no light is chosen. */
export const GRID = gridPoints(25, 25);

/**
 * Simulated grids to preview on, as "Preview on" options. Capped at 50 × 50:
 * the server renders previews in QuickJS at 25 fps, and at 100 × 100 the
 * heavier effects no longer fit a frame.
 */
export const GRIDS = [10, 25, 50].map((n) => ({
  value: `grid:${n}x${n}`,
  label: `A ${n} × ${n} grid`,
}));

/** The layout of a simulated grid id such as "grid:50x50", or null. */
export function gridLayout(id: string | undefined) {
  const m = id?.match(/^grid:(\d+)x(\d+)$/);
  if (!m) return null;
  const [cols, rows] = [Number(m[1]), Number(m[2])];
  return { points: gridPoints(cols, rows), aspect: cols / rows };
}
