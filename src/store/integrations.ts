import { create } from "zustand";
import { bridgeAvailable, sprygen } from "../lib/sprygen";
import { AdapterState } from "../../shared/types";

interface IntegrationsState {
  adapters: AdapterState[];
  load: () => Promise<void>;
  reconnect: (id: string) => Promise<void>;
  authorize: (id: string) => Promise<void>;
}

export const useIntegrations = create<IntegrationsState>((set) => ({
  adapters: [],
  load: async () => {
    const adapters = await sprygen.integrations.list();
    set({ adapters });
  },
  reconnect: async (id) => {
    await sprygen.integrations.reconnect(id);
    const adapters = await sprygen.integrations.list();
    set({ adapters });
  },
  authorize: async (id) => {
    await sprygen.integrations.authorize(id);
    const adapters = await sprygen.integrations.list();
    set({ adapters });
  }
}));

if (bridgeAvailable()) {
  sprygen.onEvent("integrations:update", () => {
    useIntegrations.getState().load();
  });
}