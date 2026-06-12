import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  DashboardDataEvent,
  DashboardDebugEvent,
  MemoryScope,
  MoodPayload,
  Settings,
  Stats,
} from "./api";

export const LIVE_EVENTS = {
  stats: "dashboard:stats",
  mood: "dashboard:mood",
  settings: "dashboard:settings",
  personalities: "dashboard:personalities",
  memory: "dashboard:memory",
  debug: "dashboard:debug",
  data: "dashboard:data",
  connected: "dashboard:connected",
} as const;

export type LiveMemoryEvent = { scope: MemoryScope };

let socket: Socket | null = null;

export function getLiveSocket(): Socket {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      autoConnect: true,
      reconnection: true,
    });
  }
  return socket;
}

export function useLiveSocketConnected(
  onChange: (connected: boolean) => void,
): void {
  useEffect(() => {
    const live = getLiveSocket();
    const sync = () => onChange(live.connected);
    sync();
    live.on("connect", sync);
    live.on("disconnect", sync);
    return () => {
      live.off("connect", sync);
      live.off("disconnect", sync);
    };
  }, [onChange]);
}

export function useLiveEvent<T>(
  event: string,
  handler: (payload: T) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const live = getLiveSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    live.on(event, listener);
    return () => {
      live.off(event, listener);
    };
  }, [event, enabled]);
}

export function useLiveStats(
  onStats: (stats: Stats) => void,
  enabled = true,
): void {
  useLiveEvent<Stats>(LIVE_EVENTS.stats, onStats, enabled);
}

export function useLiveMood(
  onMood: (mood: MoodPayload) => void,
  enabled = true,
): void {
  useLiveEvent<MoodPayload>(LIVE_EVENTS.mood, onMood, enabled);
}

export function useLiveSettings(
  onSettings: (settings: Settings) => void,
  enabled = true,
): void {
  useLiveEvent<Settings>(LIVE_EVENTS.settings, onSettings, enabled);
}

export function useLivePersonalities(
  onUpdate: () => void,
  enabled = true,
): void {
  useLiveEvent(LIVE_EVENTS.personalities, onUpdate, enabled);
}

export function useLiveMemory(
  scope: MemoryScope,
  onUpdate: () => void,
  enabled = true,
): void {
  useLiveEvent<LiveMemoryEvent>(
    LIVE_EVENTS.memory,
    (payload) => {
      if (payload.scope === scope) onUpdate();
    },
    enabled,
  );
}

export function useLiveDebug(
  onUpdate: (event: DashboardDebugEvent) => void,
  enabled = true,
): void {
  useLiveEvent<DashboardDebugEvent>(LIVE_EVENTS.debug, onUpdate, enabled);
}

export function useLiveData(
  onUpdate: (event: DashboardDataEvent) => void,
  enabled = true,
): void {
  useLiveEvent<DashboardDataEvent>(LIVE_EVENTS.data, onUpdate, enabled);
}
