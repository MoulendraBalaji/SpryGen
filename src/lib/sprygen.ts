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
  engineAvailable: false,
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

export const sprygen: SprygenAPI = (typeof window !== "undefined" && (window as any).sprygen)
  ? ((window as any).sprygen as SprygenAPI)
  : ({} as SprygenAPI);