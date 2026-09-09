import { SprygenAPI, UserProfile, VoiceStatus, DeviceSyncStatus, IntentResult } from "../../shared/types";

declare global {
  interface Window {
    sprygen?: SprygenAPI;
  }
}

const defaultProfile: UserProfile = {
  activeHours: { start: 9, end: 22 },
  phrasingStyle: "concise",
  recurringCategories: [],
  learnedFacts: [],
  summary: ""
};

const defaultVoiceStatus: VoiceStatus = {
  state: "idle",
  enrolled: false,
  active: false,
  accessKeyConfigured: false,
  speakerSimilarityThreshold: 0.85
};

const defaultSyncStatus: DeviceSyncStatus = {
  paired: false,
  pairingCode: "000000",
  serverPort: 8765,
  connectedDevices: 0
};

const defaultIntent: IntentResult = {
  intent: "chat",
  params: {},
  routedTo: "local",
  answer: "SPRYGEN is initializing…"
};

const fallbackAPI: SprygenAPI = {
  tasks: {
    list: async () => [],
    create: async () => ({} as any),
    update: async () => ({} as any),
    remove: async () => {}
  },
  chat: {
    send: async () => defaultIntent,
    history: async () => []
  },
  integrations: {
    list: async () => [],
    reconnect: async () => ({} as any),
    authorize: async () => ({} as any)
  },
  profile: {
    get: async () => defaultProfile,
    set: async () => defaultProfile,
    deleteFact: async () => defaultProfile
  },
  briefing: {
    generate: async () => []
  },
  voice: {
    enroll: async () => false,
    startListening: async () => false,
    stopListening: async () => false,
    getStatus: async () => defaultVoiceStatus,
    speak: async () => true
  },
  overlay: {
    summon: async () => {},
    dismiss: async () => {},
    toggle: async () => "summoned",
    setMode: async () => {},
    getStatus: async () => ({
      mode: "summoned",
      isFullscreen: false,
      isDND: false,
      suppressedCount: 0
    }),
    getQueue: async () => [],
    flushQueue: async () => []
  },
  sync: {
    getStatus: async () => defaultSyncStatus,
    regenerateCode: async () => "000000"
  },
  screen: {
    captureAndDescribe: async () => ""
  },
  recall: {
    query: async () => ""
  },
  window: {
    minimize: async () => {},
    maximize: async () => {},
    close: async () => {},
    isMaximized: async () => false
  },
  automation: {
    getStatus: async () => ({ active: false, workflow: null, startedAt: null }),
    abort: async () => ({ ok: false }),
    webScrape: async () => ({ ok: false, data: null, logs: [], error: null }),
    browserTask: async () => ({ ok: false, data: null, logs: [], error: null }),
    desktopAction: async () => ({ ok: false, data: null, logs: [], error: null })
  },
  onEvent: (_channel, _cb) => {
    return () => {};
  }
};

export const sprygen: SprygenAPI = new Proxy({} as SprygenAPI, {
  get(_target, prop: keyof SprygenAPI) {
    if (typeof window !== "undefined" && window.sprygen && (window.sprygen as any)[prop] !== undefined) {
      return (window.sprygen as any)[prop];
    }
    return (fallbackAPI as any)[prop];
  }
});