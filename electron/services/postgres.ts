import { Client } from "pg";
import { encrypt, decrypt } from "./encryption";

export interface PgStatus {
  configured: boolean;
  connected: boolean;
  lastError: string | null;
  snapshotBytes: number;
}

const SNAPSHOT_KEY = "_sprygen_snapshot";

class PgStore {
  private client: Client | null = null;
  private connected = false;
  private lastError: string | null = null;
  private snapshotBytes = 0;

  get isConnected(): boolean {
    return this.connected;
  }

  async init(): Promise<void> {
    const url = process.env.SPRYGEN_DATABASE_URL;
    if (!url) {
      this.lastError = "SPRYGEN_DATABASE_URL not configured";
      return;
    }
    try {
      const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
      await client.connect();
      await client.query(`
        CREATE TABLE IF NOT EXISTS sprygen_kv (
          id TEXT PRIMARY KEY,
          v TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      this.client = client;
      this.connected = true;
      this.lastError = null;
    } catch (err) {
      this.client = null;
      this.connected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  async setItem(key: string, value: string): Promise<boolean> {
    if (!this.connected || !this.client) return false;
    try {
      await this.client.query(
        `INSERT INTO sprygen_kv (id, v, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`,
        [key, encrypt(value)]
      );
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  async getItem(key: string): Promise<string | null> {
    if (!this.connected || !this.client) return null;
    try {
      const res = await this.client.query("SELECT v FROM sprygen_kv WHERE id = $1", [key]);
      if (res.rowCount === 0) return null;
      return decrypt(res.rows[0].v as string);
    } catch {
      return null;
    }
  }

  async deleteItem(key: string): Promise<boolean> {
    if (!this.connected || !this.client) return false;
    try {
      await this.client.query("DELETE FROM sprygen_kv WHERE id = $1", [key]);
      return true;
    } catch {
      return false;
    }
  }

  async snapshot(tables: Record<string, unknown[]>): Promise<boolean> {
    if (!this.connected) return false;
    const payload = JSON.stringify(tables);
    const ok = await this.setItem(SNAPSHOT_KEY, payload);
    if (ok) this.snapshotBytes = payload.length;
    return ok;
  }

  status(): PgStatus {
    return {
      configured: Boolean(process.env.SPRYGEN_DATABASE_URL),
      connected: this.connected,
      lastError: this.lastError,
      snapshotBytes: this.snapshotBytes
    };
  }
}

export const pgStore = new PgStore();