import { spawn } from "node:child_process";
import * as os from "node:os";

interface AppTarget {
  win32?: string;
  darwin?: string;
  linux?: string;
}

/**
 * Exact application allowlist.
 *
 * The key is the canonical name; the value is the exact launch target per OS
 * (an executable name, or a macOS application-bundle name for `open -a`).
 * Matching is exclusive — never a substring match — so a crafted name such as
 * "chrome-evil" or "code; rm -rf /" can never be launched.
 */
const ALLOWLIST: Record<string, AppTarget> = {
  chrome: { win32: "chrome", darwin: "Google Chrome", linux: "google-chrome" },
  firefox: { win32: "firefox", darwin: "Firefox", linux: "firefox" },
  vscode: { win32: "code", darwin: "Visual Studio Code", linux: "code" },
  notepad: { win32: "notepad", darwin: "TextEdit", linux: "gedit" },
  calculator: { win32: "calc", darwin: "Calculator", linux: "gnome-calculator" },
  spotify: { win32: "spotify", darwin: "Spotify", linux: "spotify" },
  explorer: { win32: "explorer", darwin: "Finder", linux: "nautilus" },
  terminal: { win32: "wt", darwin: "Terminal", linux: "gnome-terminal" }
};

/** Explicit, exact aliases that map a friendly name to a canonical key. */
const ALIASES: Record<string, string> = {
  "google chrome": "chrome",
  chromium: "chrome",
  code: "vscode",
  "visual studio code": "vscode",
  calc: "calculator",
  files: "explorer",
  finder: "explorer",
  cmd: "terminal",
  "command prompt": "terminal",
  powershell: "terminal",
  wt: "terminal",
  "windows terminal": "terminal"
};

type Platform = "win32" | "darwin" | "linux";

function canonical(target: string): string | null {
  const cleaned = target.trim().toLowerCase().replace(/\.(exe|app)$/, "");
  if (!cleaned) return null;
  if (Object.prototype.hasOwnProperty.call(ALLOWLIST, cleaned)) return cleaned;
  return ALIASES[cleaned] ?? null;
}

export const uiAutomation = {
  /** Exact membership test (case-insensitive, trailing ".exe"/".app" allowed). */
  isAllowed(target: string): boolean {
    return canonical(target) !== null;
  },

  /** Canonical allowlist keys, for UI suggestions. */
  allowedTargets(): string[] {
    return Object.keys(ALLOWLIST);
  },

  open(target: string): { ok: boolean; reason?: string } {
    const key = canonical(target);
    if (!key) {
      return { ok: false, reason: `"${target}" is not on the automation allowlist.` };
    }

    const platform = os.platform() as Platform;
    const launch = ALLOWLIST[key][platform];
    if (!launch) {
      return { ok: false, reason: `"${key}" is not supported on ${platform}.` };
    }

    try {
      // Every argument comes from the fixed allowlist above — no caller text
      // ever reaches the shell.
      if (platform === "win32") {
        spawn("cmd.exe", ["/c", "start", "", launch], { detached: true, stdio: "ignore" }).unref();
      } else if (platform === "darwin") {
        spawn("open", ["-a", launch], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn(launch, [], { detached: true, stdio: "ignore" }).unref();
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
};
