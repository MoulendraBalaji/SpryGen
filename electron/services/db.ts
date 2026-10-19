import { app } from "electron";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

let sqlite: any = null;
let db: any = null;
let usingNative = false;

/**
 * Per-table column allowlist. SQL identifiers are never taken from callers, so
 * an unexpected table or column name can never reach the driver. This closes the
 * SQL-injection surface that existed when `${table}` was interpolated directly.
 */
export const TABLE_COLUMNS: Record<string, readonly string[]> = {
  tasks: ["id", "createdAt", "title", "notes", "dueAt", "completed", "source", "sourceId", "recurring", "tags"],
  assignments: ["id", "course", "title", "dueAt", "link", "state", "syncedAt"],
  chat: ["id", "role", "text", "intent", "createdAt"],
  profile: ["id", "key", "value"],
  memory: ["id", "text", "embedding", "createdAt"]
};

/**
 * Versioned migrations, applied in order against SQLite's `user_version`.
 * Never edit an existing entry — append a new one instead.
 */
const MIGRATIONS: string[] = [
  // v1 — initial schema.
  `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, createdAt INTEGER, title TEXT, notes TEXT,
    dueAt INTEGER, completed INTEGER, source TEXT, sourceId TEXT,
    recurring TEXT, tags TEXT
  );
  CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY, course TEXT, title TEXT, dueAt INTEGER,
    link TEXT, state TEXT, syncedAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS chat (
    id TEXT PRIMARY KEY, role TEXT, text TEXT, intent TEXT, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS profile (
    id TEXT PRIMARY KEY, key TEXT, value TEXT
  );
  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY, text TEXT, embedding TEXT, createdAt INTEGER
  );
  `
];

/** Emergency in-memory store used only when better-sqlite3 cannot be loaded. */
const memStore: Record<string, Row[]> = {};

function assertTable(table: string): readonly string[] {
  const cols = TABLE_COLUMNS[table];
  if (!cols) throw new Error(`Unknown table: ${table}`);
  return cols;
}

function sanitize(table: string, row: Row): Row {
  const cols = assertTable(table);
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (cols.includes(key)) out[key] = value;
    else console.warn(`[DB] Ignoring unknown column "${key}" for table "${table}"`);
  }
  return out;
}

function migrate(): void {
  const current = (db.pragma("user_version", { simple: true }) as number) || 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec(MIGRATIONS[version]);
    db.pragma(`user_version = ${version + 1}`);
  }
}

export async function initDb(): Promise<void> {
  try {
    sqlite = await import("better-sqlite3");
    const dbPath = path.join(app.getPath("userData"), "sprygen.db");
    db = new (sqlite.default ?? sqlite)(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate();
    usingNative = true;
  } catch (err) {
    usingNative = false;
    console.warn(
      "[DB] better-sqlite3 unavailable; using a non-persistent in-memory store. " +
        "Install better-sqlite3 to persist data:",
      err instanceof Error ? err.message : err
    );
  }
}

export function isNative(): boolean {
  return usingNative;
}

function genId(): string {
  return randomUUID();
}

export const dbLayer = {
  genId,

  all(table: string): Row[] {
    assertTable(table);
    if (usingNative) return db.prepare(`SELECT * FROM ${table}`).all() as Row[];
    return [...(memStore[table] ?? [])];
  },

  get(table: string, id: string): Row | undefined {
    assertTable(table);
    if (usingNative) return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
    return (memStore[table] ?? []).find((r) => r.id === id);
  },

  insert(table: string, row: Row): Row {
    assertTable(table);
    const record = sanitize(table, row);
    if (usingNative) {
      const cols = Object.keys(record);
      const placeholders = cols.map(() => "?").join(", ");
      db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`).run(
        ...cols.map((c) => record[c])
      );
      return this.get(table, record.id as string) as Row;
    }
    if (!memStore[table]) memStore[table] = [];
    memStore[table].push(record);
    return record;
  },

  update(table: string, id: string, patch: Row): Row {
    assertTable(table);
    const values = sanitize(table, patch);
    delete values.id;
    const cols = Object.keys(values);
    if (usingNative) {
      if (cols.length) {
        const sets = cols.map((c) => `${c} = ?`).join(", ");
        db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...cols.map((c) => values[c]), id);
      }
      const updated = this.get(table, id);
      if (!updated) throw new Error("not found");
      return updated;
    }
    const list = memStore[table] ?? [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...values };
      return list[idx];
    }
    throw new Error("not found");
  },

  remove(table: string, id: string): void {
    assertTable(table);
    if (usingNative) {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      return;
    }
    if (memStore[table]) memStore[table] = memStore[table].filter((r) => r.id !== id);
  },

  upsert(table: string, row: Row): Row {
    assertTable(table);
    const existing = this.get(table, row.id as string);
    if (existing) return this.update(table, row.id as string, row);
    return this.insert(table, row);
  }
};
