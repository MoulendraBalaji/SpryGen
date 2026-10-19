import { screen, BrowserWindow } from "electron";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { profileService } from "./profileService";
import { OverlayMode, OverlayStatus, SuppressedNotification } from "../../shared/types";

class OverlayService extends EventEmitter {
  private mode: OverlayMode = "summoned";
  private window: BrowserWindow | null = null;
  private suppressedQueue: SuppressedNotification[] = [];
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.startSuppressionMonitor();
  }

  public setWindow(win: BrowserWindow): void {
    this.window = win;
  }

  public getMode(): OverlayMode {
    return this.mode;
  }

  public async isFullscreen(): Promise<boolean> {
    try {
      const displays = screen.getAllDisplays();
      for (const d of displays) {
        const nearest = screen.getDisplayNearestPoint(d.bounds);
        const w = nearest.workAreaSize;
        if (d.size.width > w.width || d.size.height > w.height) {
          return true;
        }
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  public async isDND(): Promise<boolean> {
    try {
      const profile = profileService.get();
      const currentHour = new Date().getHours();
      const { start, end } = profile.activeHours;

      // If activeHours is 9 to 22, hours outside 9-22 are quiet/DND hours
      if (start <= end) {
        if (currentHour < start || currentHour >= end) return true;
      } else {
        // e.g. Night shift 22 to 6
        if (currentHour < start && currentHour >= end) return true;
      }
    } catch {
      /* fallback */
    }
    return false;
  }

  public async shouldSuppress(): Promise<boolean> {
    const fullscreen = await this.isFullscreen();
    const dnd = await this.isDND();
    return fullscreen || dnd;
  }

  public async getStatus(): Promise<OverlayStatus> {
    const isFs = await this.isFullscreen();
    const dnd = await this.isDND();
    return {
      mode: this.mode,
      isFullscreen: isFs,
      isDND: dnd,
      suppressedCount: this.suppressedQueue.length
    };
  }

  public queueNotification(title: string, body: string): SuppressedNotification {
    const item: SuppressedNotification = {
      id: randomUUID(),
      title,
      body,
      queuedAt: Date.now()
    };
    this.suppressedQueue.push(item);
    this.emit("notification-queued", item);
    return item;
  }

  public getSuppressedQueue(): SuppressedNotification[] {
    return [...this.suppressedQueue];
  }

  public flushQueue(): SuppressedNotification[] {
    const flushed = [...this.suppressedQueue];
    this.suppressedQueue = [];
    this.emit("queue-flushed", flushed);
    return flushed;
  }

  public async summon(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    this.mode = "summoned";
    this.window.show();
    this.window.setAlwaysOnTop(true, "floating");
    this.window.setIgnoreMouseEvents(false);
    this.window.focus();
    this.emit("mode-change", this.mode);

    // If there were queued notifications while suppressed, notify UI
    if (this.suppressedQueue.length > 0) {
      this.emit("flush-pending", this.suppressedQueue.length);
    }
  }

  public async dismiss(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.mode === "pinned") return; // Respect user pinned state

    this.mode = "hidden";
    this.window.setAlwaysOnTop(false);
    this.emit("mode-change", this.mode);
  }

  public async toggle(): Promise<OverlayMode> {
    if (this.mode === "hidden") {
      await this.summon();
    } else {
      await this.dismiss();
    }
    return this.mode;
  }

  public async setMode(mode: OverlayMode): Promise<void> {
    this.mode = mode;
    if (!this.window || this.window.isDestroyed()) return;

    switch (mode) {
      case "summoned":
        this.window.show();
        this.window.setAlwaysOnTop(true, "floating");
        this.window.setIgnoreMouseEvents(false);
        break;
      case "pinned":
        this.window.show();
        this.window.setAlwaysOnTop(true, "screen-saver");
        this.window.setIgnoreMouseEvents(false);
        break;
      case "hidden":
        this.window.setAlwaysOnTop(false);
        break;
      case "suppressed":
        this.mode = "suppressed";
        break;
    }
    this.emit("mode-change", this.mode);
  }

  private startSuppressionMonitor(): void {
    this.checkInterval = setInterval(async () => {
      const suppress = await this.shouldSuppress();
      if (suppress && this.mode === "summoned") {
        this.mode = "suppressed";
        this.emit("mode-change", this.mode);
      } else if (!suppress && this.mode === "suppressed") {
        this.mode = "summoned";
        this.emit("mode-change", this.mode);
      }
    }, 5000);
  }

  public cleanup(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

export const overlay = new OverlayService();
