import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

type Row = Record<string, unknown>;

let sqlite: any = null;
let db: any = null;
let usingNative = false;

const JSON_PATH = path.join(app.getPath("userData"), "sprygen.json");
const jsonStore: Record<string, any[]> = { tasks: [], assignments: [], chat: [], profile: [], memory: [] };

function loadJson() {
  try {
    const raw = fs.readFileSync(JSON_PATH, "utf-8");
    Object.assign(jsonStore, JSON.parse(raw));
    if (!jsonStore.memory) jsonStore.memory = [];
  } catch {
    /* fresh store */
  }
}

function persistJson() {
  fs.writeFileSync(JSON_PATH, JSON.stringify(jsonStore, null, 2));
}

export async function initDb(): Promise<void> {
  try {
    sqlite = await import("better-sqlite3");
    const dbPath = path.join(app.getPath("userData"), "sprygen.db");
    db = new (sqlite.default ?? sqlite)(dbPath);
    db.pragma("journal_mode = WAL");
    usingNative = true;
    db.exec(`
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
        key TEXT PRIMARY KEY, value TEXT
      );
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY, text TEXT, embedding TEXT, createdAt INTEGER
      );
    `);
  } catch (err) {
    usingNative = false;
    console.warn(
      "[DB] better-sqlite3 unavailable; falling back to the JSON store:",
      err instanceof Error ? err.message : err
    );
    loadJson();
  }
}

export function isNative(): boolean {
  return usingNative;
}

function genId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const dbLayer = {
  genId,

  all(table: string): Row[] {
    if (usingNative) return db.prepare(`SELECT * FROM ${table}`).all() as Row[];
    return jsonStore[table] ?? [];
  },

  get(table: string, id: string): Row | undefined {
    if (usingNative) return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row;
    return (jsonStore[table] ?? []).find((r) => r.id === id);
  },

  insert(table: string, row: Row): Row {
    if (usingNative) {
      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(",");
      db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`).run(
        ...cols.map((c) => row[c])
      );
      return row;
    }
    jsonStore[table] = jsonStore[table] ?? [];
    jsonStore[table].push(row);
    persistJson();
    return row;
  },

  update(table: string, id: string, patch: Row): Row {
    if (usingNative) {
      const cols = Object.keys(patch);
      const sets = cols.map((c) => `${c} = ?`).join(", ");
      db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...cols.map((c) => patch[c]), id);
      return this.get(table, id) as Row;
    }
    const list = jsonStore[table] ?? [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...patch };
      persistJson();
      return list[idx];
    }
    throw new Error("not found");
  },

  remove(table: string, id: string): void {
    if (usingNative) {
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
      return;
    }
    jsonStore[table] = (jsonStore[table] ?? []).filter((r) => r.id !== id);
    persistJson();
  },

  upsert(table: string, row: Row): Row {
    const existing = this.get(table, row.id as string);
    if (existing) return this.update(table, row.id as string, row);
    return this.insert(table, row);
  }
};
