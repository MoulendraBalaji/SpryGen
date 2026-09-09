import { create } from "zustand";
import { sprygen } from "../lib/sprygen";
import { ChatMessage, IntentResult } from "../../shared/types";

interface ChatState {
  messages: ChatMessage[];
  thinking: boolean;
  load: () => Promise<void>;
  send: (text: string) => Promise<IntentResult | null>;
  sendScreen: (command: string) => Promise<void>;
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  thinking: false,
  load: async () => {
    const raw = (await sprygen.chat.history()) as ChatMessage[];
    set({ messages: raw });
  },
  send: async (text) => {
    if (!text.trim()) return null;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      createdAt: Date.now()
    };
    set({ messages: [...get().messages, userMsg], thinking: true });
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
  },
  sendScreen: async (command) => {
    const prompt = command.replace(/^\/screen\s*/i, "").trim() || "Summarize what is currently on screen.";
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text: `/screen ${prompt}`,
      createdAt: Date.now()
    };
    set({ messages: [...get().messages, userMsg], thinking: true });
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
  }
}));
