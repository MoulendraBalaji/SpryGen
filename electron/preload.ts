import { contextBridge, ipcRenderer } from "electron";
import { SprygenAPI } from "../shared/types";

const api: SprygenAPI = {
  tasks: {
    list: () => ipcRenderer.invoke("tasks:list"),
    create: (input) => ipcRenderer.invoke("tasks:create", input),
    update: (id, patch) => ipcRenderer.invoke("tasks:update", id, patch),
    remove: (id) => ipcRenderer.invoke("tasks:remove", id)
  },
  chat: {
    send: (text) => ipcRenderer.invoke("chat:send", text),
    history: () => ipcRenderer.invoke("chat:history")
  },
  integrations: {
    list: () => ipcRenderer.invoke("integrations:list"),
    reconnect: (id) => ipcRenderer.invoke("integrations:reconnect", id),
    authorize: (id) => ipcRenderer.invoke("integrations:authorize", id)
  },
  profile: {
    get: () => ipcRenderer.invoke("profile:get"),
    set: (patch) => ipcRenderer.invoke("profile:set", patch),
    deleteFact: (key) => ipcRenderer.invoke("profile:deleteFact", key)
  },
  briefing: {
    generate: () => ipcRenderer.invoke("briefing:generate")
  },
  voice: {
    enroll: () => ipcRenderer.invoke("voice:enroll"),
    startListening: () => ipcRenderer.invoke("voice:start"),
    stopListening: () => ipcRenderer.invoke("voice:stop"),
    getStatus: () => ipcRenderer.invoke("voice:getStatus"),
    speak: (text) => ipcRenderer.invoke("voice:speak", text)
  },
  overlay: {
    summon: () => ipcRenderer.invoke("overlay:summon"),
    dismiss: () => ipcRenderer.invoke("overlay:dismiss"),
    toggle: () => ipcRenderer.invoke("overlay:toggle"),
    setMode: (mode) => ipcRenderer.invoke("overlay:setMode", mode),
    getStatus: () => ipcRenderer.invoke("overlay:getStatus"),
    getQueue: () => ipcRenderer.invoke("overlay:getQueue"),
    flushQueue: () => ipcRenderer.invoke("overlay:flushQueue")
  },
  sync: {
    getStatus: () => ipcRenderer.invoke("sync:getStatus"),
    regenerateCode: () => ipcRenderer.invoke("sync:regenerateCode")
  },
  screen: {
    captureAndDescribe: (prompt) => ipcRenderer.invoke("screen:describe", prompt)
  },
  recall: {
    query: (text) => ipcRenderer.invoke("recall:query", text)
  },
  onEvent: (channel, cb) => {
    const listener = (_e: unknown, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  },
  automation: {
    getStatus: () => ipcRenderer.invoke("automation:status"),
    abort: () => ipcRenderer.invoke("automation:abort"),
    webScrape: (input) => ipcRenderer.invoke("automation:web-scrape", input),
    browserTask: (input) => ipcRenderer.invoke("automation:browser-task", input),
    desktopAction: (input) => ipcRenderer.invoke("automation:desktop-action", input),
  },
};

contextBridge.exposeInMainWorld("sprygen", api);
