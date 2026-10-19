import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { dbLayer } from "./db";
import { DeviceSyncStatus } from "../../shared/types";

/** Hard cap on any single HTTP body or WebSocket frame (64 KB). */
const MAX_BODY_BYTES = 64 * 1024;
/** Invalid pairing attempts before the PIN is rotated and the device is locked out. */
const MAX_PAIR_ATTEMPTS = 5;
/** How long a locked-out device must wait before it can try again. */
const LOCKOUT_MS = 5 * 60 * 1000;

/** Shape returned by the LAN `/status` probe — deliberately contains no secrets. */
interface PublicSyncStatus {
  paired: boolean;
  serverPort: number;
  connectedDevices: number;
}

export class DeviceSyncService extends EventEmitter {
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 8765;
  private pairingCode: string = this.generatePin();
  private readonly clients = new Set<WebSocket>();
  /** Per-device bearer tokens issued by a successful `/pair`. */
  private readonly deviceTokens = new Set<string>();
  private isPaired = false;
  private pairAttempts = 0;
  private lockedUntil = 0;

  private generatePin(): string {
    // Cryptographically strong 6-digit PIN (000000–999999).
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  public getPairingCode(): string {
    return this.pairingCode;
  }

  public regenerateCode(): string {
    this.pairingCode = this.generatePin();
    this.pairAttempts = 0;
    this.lockedUntil = 0;
    this.emit("code-regenerated", this.pairingCode);
    return this.pairingCode;
  }

  public hasPairedDevice(): boolean {
    return this.isPaired || this.clients.size > 0;
  }

  /** Trusted renderer/IPC view — includes the pairing code for the desktop UI only. */
  public getStatus(): DeviceSyncStatus {
    return {
      paired: this.hasPairedDevice(),
      pairingCode: this.pairingCode,
      serverPort: this.port,
      connectedDevices: this.clients.size
    };
  }

  /** Untrusted LAN view — never exposes the pairing code or device tokens. */
  private getPublicStatus(): PublicSyncStatus {
    return {
      paired: this.hasPairedDevice(),
      serverPort: this.port,
      connectedDevices: this.clients.size
    };
  }

  private respond(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private readBody(req: http.IncomingMessage, res: http.ServerResponse, onDone: (raw: string) => void): void {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      this.respond(res, 413, { error: "Payload too large" });
      req.destroy();
      return;
    }

    let size = 0;
    let aborted = false;
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        this.respond(res, 413, { error: "Payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      onDone(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", () => {
      if (aborted) return;
      aborted = true;
      this.respond(res, 400, { error: "Invalid request" });
    });
  }

  private bearerToken(req: http.IncomingMessage): string | null {
    const header = req.headers["authorization"];
    if (typeof header !== "string") return null;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : null;
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    const presented = this.bearerToken(req);
    if (!presented) return false;
    let authorized = false;
    for (const token of this.deviceTokens) {
      // Compare every candidate to avoid leaking which token (if any) matched.
      if (this.constantTimeEqual(token, presented)) authorized = true;
    }
    return authorized;
  }

  public async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      // No CORS headers: only the companion app's native fetch / WebSocket client talks here.
      const url = (req.url || "").split("?")[0];

      if (url === "/status" && (req.method === "GET" || req.method === "HEAD")) {
        this.respond(res, 200, this.getPublicStatus());
        return;
      }

      if (url === "/pair" && req.method === "POST") {
        this.handlePair(req, res);
        return;
      }

      if (url === "/capture" && req.method === "POST") {
        if (!this.isAuthorized(req)) {
          this.respond(res, 401, { error: "Unauthorized" });
          return;
        }
        this.handleCapture(req, res);
        return;
      }

      this.respond(res, 404, { error: "Not found" });
    });

    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });

    this.wss.on("connection", (socket: WebSocket) => {
      this.clients.add(socket);
      this.isPaired = true;
      this.emit("paired");

      socket.on("message", (data: WebSocket.RawData) => {
        try {
          const text = typeof data === "string" ? data : data.toString("utf-8");
          this.handleSocketMessage(JSON.parse(text), socket);
        } catch {
          /* ignore malformed frames */
        }
      });

      socket.on("close", () => {
        this.clients.delete(socket);
      });

      socket.on("error", () => {
        this.clients.delete(socket);
      });
    });

    this.server.on("upgrade", (req, socket, head) => {
      if (!this.isAuthorized(req)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit("connection", ws, req);
      });
    });

    this.server.listen(this.port, "0.0.0.0", () => {
      /* Server active on LAN */
    });

    this.server.on("error", () => {
      /* Port might be in use, gracefully handle */
    });
  }

  private handlePair(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (Date.now() < this.lockedUntil) {
      const seconds = Math.ceil((this.lockedUntil - Date.now()) / 1000);
      this.respond(res, 429, {
        success: false,
        message: `Too many invalid attempts. Try again in ${seconds}s.`
      });
      return;
    }

    this.readBody(req, res, (raw) => {
      let code = "";
      try {
        const data = JSON.parse(raw);
        code = typeof data?.code === "string" ? data.code.trim() : "";
      } catch {
        this.respond(res, 400, { success: false, message: "Invalid JSON" });
        return;
      }

      if (code && this.constantTimeEqual(code, this.pairingCode)) {
        this.pairAttempts = 0;
        const token = crypto.randomBytes(32).toString("hex");
        this.deviceTokens.add(token);
        this.isPaired = true;
        // Rotate the PIN so it cannot be replayed.
        this.pairingCode = this.generatePin();
        this.emit("paired");
        this.respond(res, 200, {
          success: true,
          token,
          message: "Paired successfully with SPRYGEN."
        });
        return;
      }

      this.pairAttempts += 1;
      if (this.pairAttempts >= MAX_PAIR_ATTEMPTS) {
        this.pairAttempts = 0;
        this.pairingCode = this.generatePin();
        this.lockedUntil = Date.now() + LOCKOUT_MS;
        this.emit("code-regenerated", this.pairingCode);
        this.respond(res, 429, {
          success: false,
          message: "Too many invalid attempts. PIN rotated — check the desktop app."
        });
        return;
      }

      this.respond(res, 401, {
        success: false,
        message: `Invalid pairing code. ${MAX_PAIR_ATTEMPTS - this.pairAttempts} attempt(s) left.`
      });
    });
  }

  private handleCapture(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readBody(req, res, (raw) => {
      try {
        const data = JSON.parse(raw);
        if (typeof data?.text === "string" && data.text.trim()) {
          const task = dbLayer.insert("tasks", {
            id: dbLayer.genId(),
            createdAt: Date.now(),
            title: data.text.slice(0, 200),
            dueAt: data.dueAt || null,
            completed: 0,
            source: "companion_quick_capture",
            recurring: null,
            tags: JSON.stringify(["mobile_capture"])
          });
          this.emit("task-created", task);
          this.respond(res, 200, { success: true, task });
          return;
        }
      } catch {
        /* fall through to 400 */
      }
      this.respond(res, 400, { error: "Invalid payload" });
    });
  }

  private handleSocketMessage(msg: any, socket: WebSocket): void {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "notification") {
      this.emit("notification-received", {
        packageName: msg.packageName || "com.unknown",
        title: msg.title || "",
        text: msg.text || ""
      });
    } else if (msg.type === "quick_capture") {
      if (typeof msg.text !== "string" || !msg.text.trim()) return;
      const task = dbLayer.insert("tasks", {
        id: dbLayer.genId(),
        createdAt: Date.now(),
        title: msg.text.slice(0, 200),
        dueAt: msg.dueAt || null,
        completed: 0,
        source: "companion_app",
        recurring: null,
        tags: JSON.stringify(["mobile"])
      });
      this.emit("task-created", task);
    } else if (msg.type === "get_tasks") {
      const tasks = dbLayer.all("tasks");
      this.sendTo(socket, { type: "tasks_list", tasks });
    }
  }

  private sendTo(socket: WebSocket, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      this.clients.delete(socket);
    }
  }

  public broadcast(event: string, payload: any): void {
    const message = JSON.stringify({ type: event, data: payload });
    for (const socket of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(message);
      } catch {
        this.clients.delete(socket);
      }
    }
  }
}

export const deviceSync = new DeviceSyncService();
