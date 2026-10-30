import { useEffect, useState, useSyncExternalStore } from "react";
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
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    const open = () => {
      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => setWs(socket);
      socket.onmessage = (e) => {
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
      socket.onclose = () => {
        setWs(null);
        if (!closed) timer = setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [frame]);

  const body = request ? JSON.stringify(request) : null;
  useEffect(() => {
    if (ws && body) {
      const t = setTimeout(() => ws.send(body), 250);
      return () => clearTimeout(t);
    }
  }, [ws, body]);

  return { error, meta, points, frame };
}
