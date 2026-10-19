import { create } from "zustand";
import { bridgeAvailable, sprygen } from "../lib/sprygen";
import { VoiceStatus } from "../../shared/types";

export interface VoiceRuntimeError {
  code: "PERMISSION_DENIED" | "DEVICE_NOT_FOUND" | "RECORDER_TIMEOUT" | "ENGINE_FAILURE";
  message: string;
  recovered?: boolean;
}

interface VoiceControlState {
  status: VoiceStatus | null;
  listening: boolean;
  error: VoiceRuntimeError | null;
  audioLevel: number;
  /** Speak assistant answers aloud when a command came in by voice. */
  speakReplies: boolean;
  load: () => Promise<void>;
  setListening: (on: boolean) => Promise<void>;
  setSpeakReplies: (on: boolean) => void;
  clearError: () => void;
}

export const useVoice = create<VoiceControlState>((set, get) => ({
  status: null,
  listening: false,
  error: null,
  audioLevel: 0,
  speakReplies: true,

  load: async () => {
    const status = (await sprygen.voice.getStatus()) as VoiceStatus;
    set({ status, listening: Boolean(status.active) });
  },

  setListening: async (on) => {
    try {
      if (on) {
        await sprygen.voice.startListening();
      } else {
        await sprygen.voice.stopListening();
      }
      const status = (await sprygen.voice.getStatus()) as VoiceStatus;
      set({ status, listening: Boolean(status.active) });
    } catch {
      /* error surfaced via voice:error push event */
    }
  },

  clearError: () => set({ error: null }),
  setSpeakReplies: (on) => set({ speakReplies: on })
}));

if (bridgeAvailable()) {
  sprygen.onEvent("voice:state-change", () => {
    useVoice.getState().load();
  });
  sprygen.onEvent("voice:audio-level", (level: number) => {
    useVoice.setState({ audioLevel: level });
  });
  sprygen.onEvent("voice:error", (err: VoiceRuntimeError) => {
    useVoice.setState({ error: err });
  });
}