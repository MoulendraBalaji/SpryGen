import { create } from "zustand";
import { sprygen } from "../lib/sprygen";

interface RecallState {
  query: string;
  result: string;
  searching: boolean;
  searched: boolean;
  setQuery: (q: string) => void;
  search: (query?: string) => Promise<void>;
}

export const useRecall = create<RecallState>((set, get) => ({
  query: "",
  result: "",
  searching: false,
  searched: false,

  setQuery: (query) => set({ query }),

  search: async (query?: string) => {
    const q = (query ?? get().query).trim();
    if (!q) {
      set({ result: "", searched: false });
      return;
    }
    set({ query: q, searching: true, searched: true });
    const result = (await sprygen.recall.query(q)) as string;
    set({ result, searching: false });
  }
}));