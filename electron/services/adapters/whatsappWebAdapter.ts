import { BaseAdapter } from "./IngestAdapter";
import { healthMonitor } from "../healthMonitor";
import { dbLayer } from "../db";
import * as chrono from "chrono-node";
import { randomUUID } from "node:crypto";

export class WhatsappWebAdapter extends BaseAdapter {
  id = "whatsapp-web";
  label = "WhatsApp (Web)";
  description = "WhatsApp Web session — parses chat announcements, deadlines & homework into tasks.";
  private isPaired = false;
  private qrCodeData: string | null = null;

  async authorize() {
    this.setStatus("degraded");
    // Generate QR Pairing session
    this.qrCodeData = `https://web.whatsapp.com/pair/${randomUUID().replace(/-/g, "")}`;
    healthMonitor.update(this.id, {
      status: "degraded",
      errorMessage: "QR pairing initiated. Scan with WhatsApp Mobile to pair."
    });

    // Simulate successful QR pairing
    setTimeout(() => {
      this.isPaired = true;
      this.setStatus("healthy");
      this.lastSyncAt = Date.now();
      healthMonitor.update(this.id, {
        status: "healthy",
        lastSyncAt: this.lastSyncAt,
        errorMessage: undefined
      });
      // Ingest recent sample announcements from study groups
      this.ingestSampleAnnouncements();
    }, 1200);
  }

  async connect() {
    if (!this.isPaired) {
      this.setStatus("unauthenticated");
      healthMonitor.update(this.id, {
        status: "unauthenticated",
        errorMessage: "Session not paired. Click Authorize to pair QR code."
      });
      return;
    }

    this.setStatus("healthy");
    this.lastSyncAt = Date.now();
    healthMonitor.update(this.id, {
      status: "healthy",
      lastSyncAt: this.lastSyncAt
    });
  }

  async reconnect() {
    this.isPaired = false;
    await this.authorize();
  }

  public processIncomingMessage(sender: string, text: string): { isTask: boolean; title?: string; dueAt?: number | null } {
    const isDeadlineMessage = /\b(assignment|due|deadline|submit|homework|presentation|exam|quiz|meeting|project|reminder)\b/i.test(text);

    if (!isDeadlineMessage) return { isTask: false };

    const parsed = chrono.parse(text, new Date(), { forwardDate: true });
    const dueAt = parsed.length ? parsed[0].start.date().getTime() : null;

    const taskTitle = `[WhatsApp: ${sender}] ${text.slice(0, 100)}`;
    dbLayer.insert("tasks", {
      id: dbLayer.genId(),
      createdAt: Date.now(),
      title: taskTitle,
      dueAt,
      completed: 0,
      source: this.id,
      recurring: null,
      tags: JSON.stringify(["whatsapp", sender.toLowerCase().replace(/\s+/g, "_")])
    });

    this.lastSyncAt = Date.now();
    healthMonitor.update(this.id, {
      status: "healthy",
      lastSyncAt: this.lastSyncAt
    });

    return { isTask: true, title: taskTitle, dueAt };
  }

  private ingestSampleAnnouncements() {
    this.processIncomingMessage(
      "Study Group 2026",
      "Reminder: Submit the Operating Systems lab report by Friday at 11:59 PM"
    );
    this.processIncomingMessage(
      "Class Representative",
      "Calculus II assignment 3 is due next Tuesday morning"
    );
  }
}

export const whatsappWebAdapter = new WhatsappWebAdapter();
