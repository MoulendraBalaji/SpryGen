import { ipcMain, BrowserWindow, Notification } from "electron";
import { dbLayer } from "../services/db";
import { healthMonitor } from "../services/healthMonitor";
import { router } from "../services/router";
import { applyActions } from "../services/actions";
import { profileService } from "../services/profileService";
import type { IntentResult, ProposedAction } from "../../shared/types";
import { whatsappWebAdapter } from "../services/adapters/whatsappWebAdapter";
import { notifMirrorAdapter } from "../services/adapters/notifMirrorAdapter";
import { manualCaptureAdapter } from "../services/adapters/manualCaptureAdapter";
import { voice } from "../services/voice/voice";
import { overlay } from "../services/overlay";
import { screenContext } from "../services/screenContext";
import { uiAutomation } from "../services/uiAutomation";
import { vectorStore } from "../services/vectorStore";
import { deviceSync } from "../services/deviceSync";
import type { AdapterState, OverlayMode } from "../../shared/types";

const PYTHON_BACKEND_URL = "http://127.0.0.1:8766";

async function proxyToPython(endpoint: string, options?: RequestInit): Promise<any> {
  try {
    const resp = await fetch(`${PYTHON_BACKEND_URL}${endpoint}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!resp.ok) throw new Error(`Python backend returned ${resp.status}`);
    return await resp.json();
  } catch {
    return null;
  }
}

const adapters = new Map<string, any>([
  ["whatsapp-web", whatsappWebAdapter],
  ["notif-mirror", notifMirrorAdapter],
  ["manual-capture", manualCaptureAdapter]
]);

function pushEvent(channel: string, ...args: unknown[]) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, ...args);
    }
  });
}

export function registerIpc() {
  adapters.forEach((a) => {
    healthMonitor.register({
      id: a.id,
      label: a.label,
      description: a.description,
      status: a.status,
      lastSyncAt: a.lastSyncAt
    });
    a.onHealthChange((s: string) =>
      healthMonitor.update(a.id, { status: s as AdapterState["status"] })
    );
  });

  // Environment & config health row — intended as an in-app notice for unset keys.
  const CLOUD_LLM_KEYS = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY"];
  const cloudConfigured = CLOUD_LLM_KEYS.some((key) => !!process.env[key]);
  healthMonitor.register({
    id: "env",
    label: "LLM Providers",
    description: cloudConfigured
      ? "A cloud LLM key is configured. Prompts may leave this device; personal data stays local."
      : "No cloud LLM key — running fully local via Ollama.",
    status: "healthy",
    lastSyncAt: null,
    category: "config"
  });

  // Stream health-monitor changes (backend probes, adapter reconnects) to the renderer.
  healthMonitor.subscribe(() => pushEvent("integrations:update"));

  // Voice event listeners — async push pipes into the renderer voiceStore.
  voice.on("state-change", (state) => pushEvent("voice:state-change", state));
  voice.on("enroll-progress", (p) => pushEvent("voice:enroll-progress", p));
  voice.on("audio-level", (level) => pushEvent("voice:audio-level", level));
  voice.on("wake", () => pushEvent("voice:wake"));
  voice.on("transcript", (text) => pushEvent("voice:transcript", text));
  voice.on("unauthorized-voice", (score) => pushEvent("voice:unauthorized-voice", score));
  // Typed engine errors (PERMISSION_DENIED / DEVICE_NOT_FOUND / RECORDER_TIMEOUT / ENGINE_FAILURE)
  voice.on("voice-error", (err) => pushEvent("voice:error", err));

  // Overlay event listeners
  overlay.on("mode-change", (mode) => pushEvent("overlay:mode-change", mode));
  overlay.on("notification-queued", (item) => pushEvent("overlay:notification-queued", item));
  overlay.on("queue-flushed", (items) => pushEvent("overlay:queue-flushed", items));

  // Device sync event listeners
  deviceSync.on("paired", () => pushEvent("sync:paired"));
  deviceSync.on("task-created", (task) => pushEvent("sync:task-created", task));

  // Tasks IPC
  ipcMain.handle("tasks:list", () => dbLayer.all("tasks"));
  ipcMain.handle("tasks:create", (_e, input) => {
    const task = dbLayer.insert("tasks", {
      id: dbLayer.genId(),
      createdAt: Date.now(),
      completed: 0,
      dueAt: null,
      source: "manual",
      recurring: null,
      tags: "[]",
      ...input
    });
    pushEvent("tasks:update");
    return task;
  });
  ipcMain.handle("tasks:update", (_e, id, patch) => {
    const res = dbLayer.update("tasks", id, patch);
    pushEvent("tasks:update");
    return res;
  });
  ipcMain.handle("tasks:remove", (_e, id) => {
    dbLayer.remove("tasks", id);
    pushEvent("tasks:update");
  });

  // Chat IPC — sends stateless context to Python; Electron applies the actions once.
  ipcMain.handle("chat:send", async (_e, text: string) => {
    const profile = profileService.get();
    const history = (dbLayer.all("chat") as any[]).slice(-20).map((m) => ({
      role: m.role,
      content: m.text
    }));
    const tasks = dbLayer.all("tasks");
    const facts = (profile.learnedFacts || []).map((f) => ({ key: f.key, value: f.value }));

    let result: IntentResult;

    const pyResult = await proxyToPython("/api/chat", {
      method: "POST",
      body: JSON.stringify({ text, history, profile, tasks, facts })
    });

    if (pyResult && typeof pyResult.answer === "string") {
      result = {
        intent: pyResult.intent ?? "chat",
        params: pyResult.params ?? {},
        routedTo: "python",
        answer: pyResult.answer,
        provider: pyResult.provider,
        actions: pyResult.actions ?? []
      };
      const outcome = applyActions(result.actions);
      if (outcome.tasksChanged) pushEvent("tasks:update");
    } else {
      // Fallback to the local TypeScript router when the Python backend is down.
      result = await router.route({ text, profile, history: history as any });
      const bridged: ProposedAction[] = [];
      if (result.intent === "task.create" && result.params.title) {
        bridged.push({
          type: "task.create",
          payload: { title: result.params.title, dueAt: result.params.dueAt }
        });
      }
      const outcome = applyActions(bridged);
      if (outcome.tasksChanged) pushEvent("tasks:update");
    }

    if (result.intent === "automation.openApp" && result.params.target) {
      const r = uiAutomation.open(String(result.params.target));
      if (!r.ok) result.answer = r.reason ?? result.answer;
    }

    // Electron is the only datastore: persist the exchange exactly once.
    dbLayer.insert("chat", { id: dbLayer.genId(), role: "user", text, intent: result.intent, createdAt: Date.now() });
    dbLayer.insert("chat", {
      id: dbLayer.genId(),
      role: "assistant",
      text: result.answer,
      intent: result.intent,
      createdAt: Date.now()
    });

    pushEvent("chat:update");
    return result;
  });

  ipcMain.handle("chat:history", () => dbLayer.all("chat"));

  // Integrations & Health IPC
  ipcMain.handle("integrations:list", () => healthMonitor.snapshot());
  ipcMain.handle("integrations:reconnect", async (_e, id) => {
    const a = adapters.get(id);
    if (a) await a.reconnect();
    return healthMonitor.snapshot().find((s) => s.id === id);
  });
  ipcMain.handle("integrations:authorize", async (_e, id) => {
    const a = adapters.get(id);
    if (a) await a.authorize();
    return healthMonitor.snapshot().find((s) => s.id === id);
  });

  // Profile IPC
  ipcMain.handle("profile:get", () => profileService.get());
  ipcMain.handle("profile:set", (_e, patch) => profileService.set(patch));
  ipcMain.handle("profile:deleteFact", (_e, key) => profileService.deleteFact(key));

  // Briefing IPC — computed from the Electron store, the single source of truth.
  ipcMain.handle("briefing:generate", async () => {
    const tasks = dbLayer.all("tasks") as any[];
    const assignments = dbLayer.all("assignments") as any[];
    return [
      ...tasks
        .filter((t) => !t.completed)
        .map((t) => ({ kind: "task" as const, title: t.title, dueAt: t.dueAt ? Number(t.dueAt) : null })),
      ...assignments.map((a) => ({
        kind: "assignment" as const,
        title: `${a.course}: ${a.title}`,
        dueAt: a.dueAt ? Number(a.dueAt) : null
      }))
    ];
  });

  // Voice Engine IPC — non-blocking, main-process persistent singleton.
  ipcMain.handle("voice:enroll", () => voice.enroll());
  ipcMain.handle("voice:start", async () => {
    const res = await voice.start();
    return res.ok;
  });
  ipcMain.handle("voice:stop", async () => {
    const res = await voice.stop();
    return res.ok;
  });
  ipcMain.handle("voice:getStatus", () => voice.getStatus());
  ipcMain.handle("voice:speak", (_e, text: string) => voice.speak(text));

  // Overlay & Suppression State Machine IPC
  ipcMain.handle("overlay:summon", () => overlay.summon());
  ipcMain.handle("overlay:dismiss", () => overlay.dismiss());
  ipcMain.handle("overlay:toggle", () => overlay.toggle());
  ipcMain.handle("overlay:setMode", (_e, mode: OverlayMode) => overlay.setMode(mode));
  ipcMain.handle("overlay:getStatus", () => overlay.getStatus());
  ipcMain.handle("overlay:getQueue", () => overlay.getSuppressedQueue());
  ipcMain.handle("overlay:flushQueue", () => overlay.flushQueue());

  // Device Sync IPC
  ipcMain.handle("sync:getStatus", () => deviceSync.getStatus());
  ipcMain.handle("sync:regenerateCode", () => deviceSync.regenerateCode());

  // Second Sight Screen & Recall Memory RAG IPC
  ipcMain.handle("screen:describe", (_e, prompt) => screenContext.describe(prompt));
  ipcMain.handle("recall:query", async (_e, text) => {
    const hits = await vectorStore.query(text, 3);
    if (!hits.length) return "I don't have anything stored about that yet.";
    return hits.map((h) => `• ${h.text}`).join("\n");
  });

  // Automation IPC — Selenium / BeautifulSoup / PyAutoGUI (proxied to Python backend)
  ipcMain.handle("automation:status", async () => {
    const res = await proxyToPython("/api/automation/status");
    return res ?? { active: false, workflow: null, startedAt: null };
  });
  ipcMain.handle("automation:abort", async () => {
    const res = await proxyToPython("/api/automation/abort", { method: "POST" });
    return res ?? { ok: false };
  });
  ipcMain.handle("automation:web-scrape", async (_e, input) => {
    const res = await proxyToPython("/api/automation/web-scrape", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return res ?? { ok: false, data: null, logs: [], error: { code: "BACKEND_DOWN", message: "Python backend unreachable" } };
  });
  ipcMain.handle("automation:browser-task", async (_e, input) => {
    const res = await proxyToPython("/api/automation/browser-task", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return res ?? { ok: false, data: null, logs: [], error: { code: "BACKEND_DOWN", message: "Python backend unreachable" } };
  });
  ipcMain.handle("automation:desktop-action", async (_e, input) => {
    const res = await proxyToPython("/api/automation/desktop-action", {
      method: "POST",
      body: JSON.stringify(input)
    });
    return res ?? { ok: false, data: null, logs: [], error: { code: "BACKEND_DOWN", message: "Python backend unreachable" } };
  });

  return {
    notify: async (title: string, body: string) => {
      const suppress = await overlay.shouldSuppress();
      if (suppress) {
        overlay.queueNotification(title, body);
      } else {
        new Notification({ title, body }).show();
      }
    }
  };
}
