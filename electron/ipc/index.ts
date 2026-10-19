import { ipcMain, BrowserWindow, Notification, dialog } from "electron";
import { dbLayer } from "../services/db";
import { healthMonitor } from "../services/healthMonitor";
import { applyActions, describeAction } from "../services/actions";
import { profileService } from "../services/profileService";
import type { IntentResult } from "../../shared/types";
import { whatsappWebAdapter } from "../services/adapters/whatsappWebAdapter";
import { notifMirrorAdapter } from "../services/adapters/notifMirrorAdapter";
import { manualCaptureAdapter } from "../services/adapters/manualCaptureAdapter";
import { voice } from "../services/voice/voice";
import { overlay } from "../services/overlay";
import { screenContext } from "../services/screenContext";
import { vectorStore } from "../services/vectorStore";
import { deviceSync } from "../services/deviceSync";
import type { AdapterState, AutomationResult, AutomationStatus, OverlayMode, ProposedAction } from "../../shared/types";
import { proxyToPython } from "../services/pythonClient";

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

/** Ask the user to approve side-effecting actions before they are applied. */
export async function confirmActions(actions: ProposedAction[]): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!win || actions.length === 0) return false;
  const detail = actions.map((a) => `• ${describeAction(a)}`).join("\n");
  const res = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Apply", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Confirm action",
    message: "SPRYGEN wants to perform an action that changes your system:",
    detail
  });
  return res.response === 0;
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
    let outcome = { applied: [] as string[], pending: [] as ProposedAction[], errors: [] as string[], notes: [] as string[], tasksChanged: false };

    const pyResult = await proxyToPython<{
      answer?: string;
      intent?: string;
      params?: Record<string, unknown>;
      provider?: string;
      actions?: ProposedAction[];
    }>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ text, history, profile, tasks, facts })
    });

    const py = pyResult.ok ? pyResult.data : undefined;
    if (py && typeof py.answer === "string") {
      result = {
        intent: py.intent ?? "chat",
        params: py.params ?? {},
        routedTo: "python",
        answer: py.answer,
        provider: py.provider,
        actions: py.actions ?? []
      };
      outcome = await applyActions(result.actions);
    } else {
      // The Python backend owns routing/providers now. Surface the failure
      // instead of silently answering from stale local heuristics.
      result = {
        intent: "error",
        params: {},
        routedTo: "python",
        answer: pyResult.ok
          ? "The local backend returned an unexpected response. Please try again."
          : `The local backend isn't reachable yet (${pyResult.code}). It may still be starting — please retry in a moment.`,
        actions: []
      };
    }

    // Side-effecting tool calls need explicit confirmation.
    if (outcome.pending.length && (await confirmActions(outcome.pending))) {
      const approved = await applyActions(outcome.pending, { allowSideEffects: true });
      outcome = {
        applied: [...outcome.applied, ...approved.applied],
        pending: [],
        errors: [...outcome.errors, ...approved.errors],
        notes: [...outcome.notes, ...approved.notes],
        tasksChanged: outcome.tasksChanged || approved.tasksChanged
      };
    }

    if (outcome.notes.length) result.answer = [result.answer, ...outcome.notes].filter(Boolean).join("\n");
    if (outcome.tasksChanged) pushEvent("tasks:update");

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
  const backendFailure = (code: string, message: string): AutomationResult => ({
    ok: false,
    data: null,
    logs: [],
    error: { code, message }
  });

  ipcMain.handle("automation:status", async () => {
    const res = await proxyToPython<AutomationStatus>("/api/automation/status");
    return res.ok ? res.data : { active: false, workflow: null, startedAt: null };
  });
  ipcMain.handle("automation:abort", async () => {
    const res = await proxyToPython<{ ok: boolean }>("/api/automation/abort", { method: "POST" });
    return res.ok ? res.data : { ok: false };
  });
  ipcMain.handle("automation:web-scrape", async (_e, input) => {
    const res = await proxyToPython<AutomationResult>(
      "/api/automation/web-scrape",
      { method: "POST", body: JSON.stringify(input) },
      120_000
    );
    return res.ok ? res.data : backendFailure(res.code, res.message);
  });
  ipcMain.handle("automation:browser-task", async (_e, input) => {
    const res = await proxyToPython<AutomationResult>(
      "/api/automation/browser-task",
      { method: "POST", body: JSON.stringify(input) },
      120_000
    );
    return res.ok ? res.data : backendFailure(res.code, res.message);
  });
  ipcMain.handle("automation:desktop-action", async (_e, input) => {
    const res = await proxyToPython<AutomationResult>(
      "/api/automation/desktop-action",
      { method: "POST", body: JSON.stringify(input) },
      120_000
    );
    return res.ok ? res.data : backendFailure(res.code, res.message);
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
