import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as crypto from "node:crypto";
import { dbLayer } from "./db";
import { DeviceSyncStatus } from "../../shared/types";

export class DeviceSyncService extends EventEmitter {
  private server: http.Server | null = null;
  private port = 8765;
  private pairingCode: string = this.generatePin();
  private sockets = new Set<any>();
  private isPaired = false;

  constructor() {
    super();
  }

  private generatePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  public getPairingCode(): string {
    return this.pairingCode;
  }

  public regenerateCode(): string {
    this.pairingCode = this.generatePin();
    this.emit("code-regenerated", this.pairingCode);
    return this.pairingCode;
  }

  public hasPairedDevice(): boolean {
    return this.isPaired || this.sockets.size > 0;
  }

  public getStatus(): DeviceSyncStatus {
    return {
      paired: this.hasPairedDevice(),
      pairingCode: this.pairingCode,
      serverPort: this.port,
      connectedDevices: this.sockets.size
    };
  }

  public async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      // Basic HTTP REST endpoint for companion app handshake / discovery
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === "/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getStatus()));
        return;
      }

      if (req.url === "/pair" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.code === this.pairingCode) {
              this.isPaired = true;
              this.emit("paired");
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, message: "Paired successfully with SPRYGEN." }));
            } else {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, message: "Invalid pairing code." }));
            }
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }

      if (req.url === "/capture" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
            if (data.text) {
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
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, task }));
              return;
            }
          } catch {
            /* ignore */
          }
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid payload" }));
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // Native WebSocket Upgrade handling
    this.server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"];
      if (!key) {
        socket.destroy();
        return;
      }

      const acceptKey = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");

      const headers = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`
      ];
      socket.write(headers.join("\r\n") + "\r\n\r\n");

      this.sockets.add(socket);
      this.isPaired = true;
      this.emit("paired");

      socket.on("data", (buffer: Buffer) => {
        try {
          const parsed = this.decodeWebSocketFrame(buffer);
          if (parsed) {
            this.handleSocketMessage(parsed, socket);
          }
        } catch {
          /* ignore frame decode issues */
        }
      });

      socket.on("close", () => {
        this.sockets.delete(socket);
      });

      socket.on("error", () => {
        this.sockets.delete(socket);
      });
    });

    this.server.listen(this.port, "0.0.0.0", () => {
      /* Server active on LAN */
    });

    this.server.on("error", () => {
      /* Port might be in use, gracefully handle */
    });
  }

  private decodeWebSocketFrame(buffer: Buffer): any | null {
    if (buffer.length < 2) return null;
    const isMasked = (buffer[1] & 0x80) === 0x80;
    let length = buffer[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      offset = 10;
    }

    let mask: Buffer | null = null;
    if (isMasked) {
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    const payload = buffer.subarray(offset, offset + length);
    if (isMasked && mask) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    try {
      return JSON.parse(payload.toString("utf-8"));
    } catch {
      return null;
    }
  }

  private encodeWebSocketFrame(data: any): Buffer {
    const jsonStr = JSON.stringify(data);
    const payload = Buffer.from(jsonStr, "utf-8");
    const len = payload.length;

    let header: Buffer;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    return Buffer.concat([header, payload]);
  }

  private handleSocketMessage(msg: any, socket: any): void {
    if (msg.type === "notification") {
      this.emit("notification-received", {
        packageName: msg.packageName || "com.unknown",
        title: msg.title || "",
        text: msg.text || ""
      });
    } else if (msg.type === "quick_capture") {
      dbLayer.insert("tasks", {
        id: dbLayer.genId(),
        createdAt: Date.now(),
        title: msg.text,
        dueAt: msg.dueAt || null,
        completed: 0,
        source: "companion_app",
        recurring: null,
        tags: JSON.stringify(["mobile"])
      });
    } else if (msg.type === "get_tasks") {
      const tasks = dbLayer.all("tasks");
      socket.write(this.encodeWebSocketFrame({ type: "tasks_list", tasks }));
    }
  }

  public broadcast(event: string, payload: any): void {
    const frame = this.encodeWebSocketFrame({ type: event, data: payload });
    for (const s of this.sockets) {
      try {
        s.write(frame);
      } catch {
        this.sockets.delete(s);
      }
    }
  }
}

export const deviceSync = new DeviceSyncService();
