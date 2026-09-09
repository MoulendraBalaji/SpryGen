import { create } from "zustand";
import { sprygen } from "../lib/sprygen";
import { OverlayStatus, SuppressedNotification } from "../../shared/types";

interface FocusState {
  on: boolean;
  mode: string;
  suppressedCount: number;
  queue: SuppressedNotification[];
  isFullscreen: boolean;
  isDND: boolean;
  load: () => Promise<void>;
  toggle: (on: boolean) => Promise<void>;
  flush: () => Promise<void>;
}

export const useFocus = create<FocusState>((set, get) => ({
  on: false,
  mode: "summoned",
  suppressedCount: 0,
  queue: [],
  isFullscreen: false,
  isDND: false,

  load: async () => {
    const status = (await sprygen.overlay.getStatus()) as OverlayStatus;
    const queue = (await sprygen.overlay.getQueue()) as SuppressedNotification[];
    set({
      on: status.mode === "suppressed",
      mode: status.mode,
      suppressedCount: status.suppressedCount,
      queue,
      isFullscreen: status.isFullscreen,
      isDND: status.isDND
    });
  },

  toggle: async (on) => {
    await sprygen.overlay.setMode(on ? "suppressed" : "summoned");
    await get().load();
  },

  flush: async () => {
    await sprygen.overlay.flushQueue();
    set({ queue: [], suppressedCount: 0 });
    await get().load();
  }
}));

if (typeof window !== "undefined") {
  ["overlay:mode-change", "overlay:notification-queued", "overlay:queue-flushed"].forEach(
    (channel) => {
      sprygen.onEvent(channel, () => {
        useFocus.getState().load();
      });
    }
  );
}