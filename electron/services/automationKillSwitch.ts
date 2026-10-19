/**
 * Global ESC kill switch for automation workflows.
 *
 * A *bare* global Escape would swallow the renderer's own Escape handling
 * (modals, command palette, OperaShell), so the accelerator is only registered
 * while at least one automation workflow is in flight and unregistered as soon
 * as they finish. Reference-counted so overlapping callers stay covered.
 */

import { globalShortcut } from "electron";
import { proxyToPython } from "./pythonClient";

let refs = 0;

export function acquireAutomationAbortHotkey(): void {
  refs += 1;
  if (refs !== 1) return;
  // If the OS refuses the accelerator, ESC simply won't abort; that is safe.
  globalShortcut.register("Escape", () => {
    void proxyToPython("/api/automation/abort", { method: "POST" }, 5000);
  });
}

export function releaseAutomationAbortHotkey(): void {
  refs = Math.max(0, refs - 1);
  if (refs === 0) {
    globalShortcut.unregister("Escape");
  }
}
