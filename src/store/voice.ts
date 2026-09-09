import { create } from "zustand";
import { jarvis } from "../lib/jarvis";
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
  load: () => Promise<void>;
  setListening: (on: boolean) => Promise<void>;
  clearError: () => void;
}

export const useVoice = create<VoiceControlState>((set, get) => ({
  status: null,
  listening: false,
  error: null,
  audioLevel: 0,

  load: async () => {
    const status = (await jarvis.voice.getStatus()) as VoiceStatus;
    set({ status, listening: Boolean(status.active) });
  },

  setListening: async (on) => {
    try {
      if (on) {
        await jarvis.voice.startListening();
      } else {
        await jarvis.voice.stopListening();
      }
      const status = (await jarvis.voice.getStatus()) as VoiceStatus;
      set({ status, listening: Boolean(status.active) });
    } catch {
      /* error surfaced via voice:error push event */
    }
  },

  clearError: () => set({ error: null })
}));

if (typeof window !== "undefined") {
  jarvis.onEvent("voice:state-change", () => {
    useVoice.getState().load();
  });
  jarvis.onEvent("voice:audio-level", (level: number) => {
    useVoice.setState({ audioLevel: level });
  });
  jarvis.onEvent("voice:error", (err: VoiceRuntimeError) => {
    useVoice.setState({ error: err });
  });
}