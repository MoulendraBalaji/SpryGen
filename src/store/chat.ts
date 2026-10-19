import { create } from "zustand";
import { sprygen } from "../lib/sprygen";
import { ChatMessage, IntentResult } from "../../shared/types";

interface ChatState {
  messages: ChatMessage[];
  thinking: boolean;
  error: string | null;
  cursor?: number;
  load: (limit?: number) => Promise<void>;
  loadMore: () => Promise<void>;
  send: (text: string) => Promise<IntentResult | null>;
  sendScreen: (command: string) => Promise<void>;
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  thinking: false,
  error: null,
  load: async (limit = 20) => {
    try {
      const raw = (await sprygen.chat.history()) as ChatMessage[];
      const last = raw.slice(-limit);
      set({ messages: last, cursor: Math.max(0, raw.length - limit), error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  loadMore: async () => {
    try {
      const raw = (await sprygen.chat.history()) as ChatMessage[];
      const cursor = get().cursor ?? Math.max(0, raw.length - 20);
      const newCursor = Math.max(0, cursor - 20);
      const older = raw.slice(newCursor, cursor);
      if (older.length === 0) return;
      set({ messages: [...older, ...get().messages], cursor: newCursor, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  send: async (text) => {
    if (!text.trim()) return null;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      createdAt: Date.now()
    };
    set({ messages: [...get().messages, userMsg], thinking: true, error: null });
    try {
      const res = await sprygen.chat.send(text);
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: res.answer,
        intent: res.intent,
        createdAt: Date.now()
      };
      set({ messages: [...get().messages, assistantMsg], thinking: false });
      return res;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      set({
        messages: [
          ...get().messages,
          {
            id: `a-err-${Date.now()}`,
            role: "assistant",
            text: `Error: ${error}`,
            intent: "error",
            createdAt: Date.now()
          }
        ],
        thinking: false,
        error
      });
      return null;
    }
  },
  sendScreen: async (command) => {
    const prompt = command.replace(/^\/screen\s*/i, "").trim() || "Summarize what is currently on screen.";
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: `/screen ${prompt}`,
      createdAt: Date.now()
    };
    set({ messages: [...get().messages, userMsg], thinking: true, error: null });
    try {
      const description = await sprygen.screen.captureAndDescribe(prompt);
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        text:
          description || "I couldn't capture or describe the current screen. Make sure you aren't in a secure/fullscreen context.",
        intent: "screen.describe",
        createdAt: Date.now()
      };
      set({ messages: [...get().messages, assistantMsg], thinking: false });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      set({
        messages: [
          ...get().messages,
          {
            id: `a-err-${Date.now()}`,
            role: "assistant",
            text: `Error: ${error}`,
            intent: "error",
            createdAt: Date.now()
          }
        ],
        thinking: false,
        error
      });
    }
  }
}));
