import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, clipboard, ipcMain } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { ChildProcess, spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as net from "node:net";
import { registerIpc } from "./ipc";
import { initDb } from "./services/db";
import { healthMonitor } from "./services/healthMonitor";
import { configurePythonBackend, probePythonHealth } from "./services/pythonClient";
import { startReminders } from "./services/scheduler";
import { deviceSync } from "./services/deviceSync";
import { overlay } from "./services/overlay";
import { voice } from "./services/voice/voice";
import { manualCaptureAdapter } from "./services/adapters/manualCaptureAdapter";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pythonProcess: ChildProcess | null = null;
let pythonRestartTimer: NodeJS.Timeout | null = null;
let pythonRestartAttempts = 0;
let shuttingDown = false;

const CORE_BACKEND_ID = "core-backend";
const MAX_RESTART_ATTEMPTS = 5;
const READY_TIMEOUT_MS = 20_000;

/**
 * Per-launch shared secret. The Python sidecar requires
 * `Authorization: Bearer <token>` on every HTTP request and on the WS handshake,
 * so a stale/other process on the port cannot be talked to and drive-by web
 * pages cannot reach the backend.
 */
const PYTHON_TOKEN = crypto.randomBytes(32).toString("hex");

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ask the OS for an unused loopback port so parallel launches never collide. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to allocate a loopback port")));
      }
    });
  });
}

function markBackendDead(err: unknown): void {
  healthMonitor.update(CORE_BACKEND_ID, {
    status: "dead",
    lastSyncAt: null,
    errorMessage: err instanceof Error ? err.message : String(err),
    description: "Python multi-agent backend unreachable",
  });
}

/**
 * The Python backend loads its own `.env` via python-dotenv, so mirror those
 * results into the Electron process environment so in-app key detection matches
 * what the backend actually sees.
 */
function loadEnvFile(): void {
  const candidates = [
    ...(app.isPackaged ? [path.join(process.resourcesPath, ".env")] : []),
    path.join(app.getAppPath(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const file of [...new Set(candidates)]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        if (line.trim().startsWith("#")) continue;
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const key = match[1];
        let value = match[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
      }
    } catch (err) {
      console.warn("[Env] Failed to load env file:", err);
    }
  }
}

function trackBackendHealth(): void {
  healthMonitor.register({
    id: CORE_BACKEND_ID,
    label: "Core Backend",
    description: "Python FastAPI multi-agent backend",
    status: "dead",
    lastSyncAt: null,
    category: "system",
  });

  const check = async () => {
    const res = await probePythonHealth();
    if (res.ok && res.data?.status === "ok") {
      const agents = Array.isArray(res.data.agents) ? res.data.agents.join(", ") : "";
      healthMonitor.update(CORE_BACKEND_ID, {
        status: "healthy",
        lastSyncAt: Date.now(),
        errorMessage: undefined,
        description: `FastAPI multi-agent backend — agents: ${agents || "online"}`,
      });
    } else {
      healthMonitor.update(CORE_BACKEND_ID, {
        status: "dead",
        lastSyncAt: null,
        errorMessage: res.ok ? "Backend did not report status ok" : res.message,
        description: "Python multi-agent backend unreachable",
      });
    }
  };

  check();
  setInterval(check, 5000);
}

/** Spawn the Python backend (frozen sidecar in prod, `python -m uvicorn` in dev). */
async function spawnPythonBackend(): Promise<void> {
  if (shuttingDown) return;

  let port: number;
  try {
    port = await getFreePort();
  } catch (err) {
    console.warn("[Python Backend] Could not allocate a port:", err);
    markBackendDead(err);
    scheduleRestart();
    return;
  }

  configurePythonBackend({ baseUrl: `http://127.0.0.1:${port}`, token: PYTHON_TOKEN });

  const env = {
    ...process.env,
    SPRYGEN_HOST: "127.0.0.1",
    SPRYGEN_PORT: String(port),
    SPRYGEN_TOKEN: PYTHON_TOKEN,
  };
  const isWin = process.platform === "win32";

  let proc: ChildProcess;
  try {
    if (app.isPackaged) {
      // Frozen PyInstaller sidecar shipped via electron-builder extraResources.
      const exe = path.join(
        process.resourcesPath,
        "backend",
        "dist",
        isWin ? "sprygen-backend.exe" : "sprygen-backend"
      );
      proc = spawn(exe, [], {
        cwd: path.join(process.resourcesPath, "backend"),
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } else {
      proc = spawn(
        isWin ? "python" : "python3",
        ["-m", "uvicorn", "backend.server:app", "--host", "127.0.0.1", "--port", String(port)],
        {
          cwd: path.join(__dirname, ".."),
          env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }
      );
    }
  } catch (err) {
    console.warn("[Python Backend] Spawn error:", err);
    markBackendDead(err);
    scheduleRestart();
    return;
  }

  pythonProcess = proc;

  proc.stdout?.on("data", (data: Buffer) => console.log(`[Python Backend] ${data.toString().trim()}`));
  proc.stderr?.on("data", (data: Buffer) => console.log(`[Python Backend] ${data.toString().trim()}`));

  proc.on("error", (err) => {
    console.warn("[Python Backend] Failed to start:", err.message);
    console.warn("[Python Backend] Ensure Python 3.10+ and pip dependencies are installed.");
    if (pythonProcess === proc) pythonProcess = null;
    markBackendDead(err);
    scheduleRestart();
  });

  proc.on("exit", (code) => {
    if (pythonProcess === proc) pythonProcess = null;
    console.log(`[Python Backend] Exited with code ${code}`);
    markBackendDead(new Error(`Backend process exited with code ${code}`));
    scheduleRestart();
  });
}

/** Respawn after an unexpected exit, with exponential backoff. */
function scheduleRestart(): void {
  if (shuttingDown || pythonRestartTimer) return;
  if (pythonRestartAttempts >= MAX_RESTART_ATTEMPTS) {
    console.warn(`[Python Backend] Giving up after ${pythonRestartAttempts} restart attempts`);
    return;
  }
  const attempt = pythonRestartAttempts++;
  const delayMs = Math.min(30_000, 1000 * 2 ** attempt);
  console.log(`[Python Backend] Restarting in ${delayMs}ms (attempt ${attempt + 1})`);
  pythonRestartTimer = setTimeout(() => {
    pythonRestartTimer = null;
    void spawnPythonBackend();
  }, delayMs);
}

/** Poll `/health` until the backend answers (or we give up). */
async function waitForPythonReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!shuttingDown && Date.now() < deadline) {
    if (!pythonProcess && pythonRestartAttempts >= MAX_RESTART_ATTEMPTS) return false;
    const res = await probePythonHealth();
    if (res.ok && res.data?.status === "ok") return true;
    await delay(300);
  }
  return false;
}

/** Start the backend and wait for readiness *before* IPC is enabled. */
async function startPythonBackend(): Promise<void> {
  trackBackendHealth();
  await spawnPythonBackend();
  if (await waitForPythonReady(READY_TIMEOUT_MS)) {
    pythonRestartAttempts = 0;
    console.log("[Python Backend] Ready");
  } else {
    console.warn("[Python Backend] Did not become ready before the timeout");
  }
}

function stopPythonBackend(): void {
  shuttingDown = true;
  if (pythonRestartTimer) {
    clearTimeout(pythonRestartTimer);
    pythonRestartTimer = null;
  }
  if (pythonProcess && !pythonProcess.killed) {
    pythonProcess.kill("SIGTERM");
    pythonProcess = null;
  }
}

function createWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, "preload.cjs");

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    frame: false,
    transparent: false,
    backgroundColor: "#e8ecf3",
    titleBarStyle: "hidden",
    resizable: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  overlay.setWindow(win);

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("maximize", () => {
    win.webContents.send("window:maximized-change", true);
  });
  win.on("unmaximize", () => {
    win.webContents.send("window:maximized-change", false);
  });

  ipcMain.handle("window:minimize", () => {
    win.minimize();
  });
  ipcMain.handle("window:maximize", () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.handle("window:close", () => {
    win.close();
  });
  ipcMain.handle("window:isMaximized", () => {
    return win.isMaximized();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      win.show();
    }
  }, 1000);

  return win;
}

function createTray(): void {
  try {
    const icon = nativeImage.createFromBuffer(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVR42mNk+M9QzwAFjAwUBowGjAYyMDIwMDAwsDJiW4BsGg0fDR8NHw0fDR/qHgAAuV0K46aF1HkAAAAASUVORK5CYII=",
        "base64"
      )
    );

    tray = new Tray(icon);
    tray.setToolTip("SPRYGEN \u2014 Voice-locked AI Assistant");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Summon SPRYGEN",
        accelerator: "CmdOrCtrl+Shift+Space",
        click: () => overlay.summon()
      },
      {
        label: "Hide Overlay",
        click: () => overlay.dismiss()
      },
      { type: "separator" },
      {
        label: "Quick Capture Selected Text",
        accelerator: "CmdOrCtrl+Shift+J",
        click: () => {
          const text = clipboard.readText();
          if (text) manualCaptureAdapter.captureText(text);
        }
      },
      {
        label: "Toggle Voice Listening",
        type: "checkbox",
        checked: true,
        click: (item) => {
          if (item.checked) void voice.start();
          else void voice.stop();
        }
      },
      { type: "separator" },
      {
        label: "Quit SPRYGEN",
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on("double-click", () => overlay.toggle());
  } catch {
    /* ignore tray creation errors in headless / CI */
  }
}

function registerGlobalHotkeys(): void {
  try {
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      overlay.toggle();
    });

    globalShortcut.register("Alt+J", () => {
      overlay.toggle();
    });

    globalShortcut.register("CommandOrControl+Shift+J", () => {
      const text = clipboard.readText();
      if (text && text.trim()) {
        manualCaptureAdapter.captureText(text);
      }
    });
  } catch {
    /* ignore shortcut collisions */
  }
}

app.whenReady().then(async () => {
  loadEnvFile();
  await initDb();
  // Wait for the Python sidecar to report healthy *before* exposing IPC, so the
  // renderer never races a half-started backend.
  await startPythonBackend();
  const { notify } = registerIpc();
  mainWindow = createWindow();
  createTray();
  registerGlobalHotkeys();

  startReminders((title, body) => notify(title, body));
  void deviceSync.start();
  void voice.start();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("before-quit", () => {
  shuttingDown = true;
});

app.on("will-quit", () => {
  stopPythonBackend();
  globalShortcut.unregisterAll();
  overlay.cleanup();
  if (tray) tray.destroy();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
