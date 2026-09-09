import { create } from "zustand";
import { jarvis } from "../lib/jarvis";
import {
  AutomationResult,
  AutomationStatus,
  BrowserTaskInput,
  DesktopActionInput,
  WebScrapeInput
} from "../../shared/types";

interface AutomationState {
  status: AutomationStatus;
  result: AutomationResult | null;
  running: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  abort: () => Promise<void>;
  webScrape: (input: WebScrapeInput) => Promise<void>;
  browserTask: (input: BrowserTaskInput) => Promise<void>;
  desktopAction: (input: DesktopActionInput) => Promise<void>;
}

export const useAutomation = create<AutomationState>((set, get) => ({
  status: { active: false, workflow: null, startedAt: null },
  result: null,
  running: false,
  error: null,

  refresh: async () => {
    const status = (await jarvis.automation.getStatus()) as AutomationStatus;
    set({ status });
  },

  abort: async () => {
    await jarvis.automation.abort();
    await get().refresh();
  },

  webScrape: async (input) => {
    set({ running: true, error: null });
    try {
      const result = (await jarvis.automation.webScrape(input)) as AutomationResult;
      set({ result, running: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), running: false });
    }
    await get().refresh();
  },

  browserTask: async (input) => {
    set({ running: true, error: null });
    try {
      const result = (await jarvis.automation.browserTask(input)) as AutomationResult;
      set({ result, running: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), running: false });
    }
    await get().refresh();
  },

  desktopAction: async (input) => {
    set({ running: true, error: null });
    try {
      const result = (await jarvis.automation.desktopAction(input)) as AutomationResult;
      set({ result, running: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), running: false });
    }
    await get().refresh();
  }
}));