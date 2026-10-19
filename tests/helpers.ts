import { vi } from "vitest";
import type { SprygenAPI } from "../shared/types";

/**
 * A fully-mocked `window.sprygen` preload bridge.
 *
 * Every store/component module reads the bridge once at import time, so tests
 * must install this object *before* dynamically importing the module under test
 * (see `installBridge`).
 */
export type MockBridge = {
  [K in keyof SprygenAPI]: SprygenAPI[K] extends (...args: infer A) => infer R
    ? ((...args: A) => R) & { mock: unknown }
    : SprygenAPI[K];
} & Record<string, any>;

export function makeBridge(): any {
  return {
    onEvent: vi.fn(() => () => {}),
    tasks: {
      list: vi.fn(async () => [] as any[]),
      create: vi.fn(async (input: any) => ({ id: "new", ...input })),
      update: vi.fn(async (_id: string, patch: any) => ({ id: "t1", ...patch })),
      remove: vi.fn(async () => undefined),
    },
    chat: {
      send: vi.fn(async () => ({
        intent: "chat",
        params: {},
        routedTo: "python" as const,
        answer: "stub answer",
        provider: "ollama",
      })),
      history: vi.fn(async () => [] as any[]),
    },
    integrations: {
      list: vi.fn(async () => [] as any[]),
      reconnect: vi.fn(async (id: string) => ({ id })),
      authorize: vi.fn(async (id: string) => ({ id })),
    },
    profile: {
      get: vi.fn(async () => ({
        activeHours: { start: 9, end: 22 },
        phrasingStyle: "concise",
        recurringCategories: [],
        learnedFacts: [],
        summary: "",
      })),
      set: vi.fn(async () => ({})),
      deleteFact: vi.fn(async () => ({})),
    },
    briefing: { generate: vi.fn(async () => []) },
    voice: {
      enroll: vi.fn(async () => true),
      startListening: vi.fn(async () => true),
      stopListening: vi.fn(async () => true),
      getStatus: vi.fn(async () => ({
        state: "idle" as const,
        enrolled: false,
        active: false,
        engineAvailable: false,
        speakerSimilarityThreshold: 0.85,
        components: { capture: false, wake: false, stt: false, speaker: false, tts: false },
        missingComponents: ["capture", "wake", "stt", "speaker", "tts"],
      })),
      speak: vi.fn(async () => true),
    },
    overlay: {
      summon: vi.fn(async () => undefined),
      dismiss: vi.fn(async () => undefined),
      toggle: vi.fn(async () => "summoned" as const),
      setMode: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({ mode: "hidden" as const, isFullscreen: false, isDND: false, suppressedCount: 0 })),
      getQueue: vi.fn(async () => []),
      flushQueue: vi.fn(async () => []),
    },
    sync: {
      getStatus: vi.fn(async () => ({ paired: false, pairingCode: "123456", serverPort: 8765, connectedDevices: 0 })),
      regenerateCode: vi.fn(async () => "654321"),
    },
    screen: { captureAndDescribe: vi.fn(async () => "a screen") },
    recall: { query: vi.fn(async () => "a memory") },
    window: {
      minimize: vi.fn(async () => undefined),
      maximize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      isMaximized: vi.fn(async () => false),
    },
    automation: {
      getStatus: vi.fn(async () => ({ active: false, workflow: null, startedAt: null })),
      abort: vi.fn(async () => ({ ok: false })),
      webScrape: vi.fn(async () => ({ ok: false, data: null, logs: [], error: null })),
      browserTask: vi.fn(async () => ({ ok: false, data: null, logs: [], error: null })),
      desktopAction: vi.fn(async () => ({ ok: false, data: null, logs: [], error: null })),
    },
  };
}

/**
 * Install a bridge and reset the module registry so the next dynamic import
 * captures it. The renderer captures the bridge at import time, so tests must
 * call this before `await import("../src/...")`.
 */
export function installBridge(bridge: unknown): void {
  vi.resetModules();
  (window as any).sprygen = bridge;
}

export function removeBridge(): void {
  vi.resetModules();
  delete (window as any).sprygen;
}
