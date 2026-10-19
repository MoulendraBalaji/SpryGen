import { dbLayer } from "./db";
import { vectorStore } from "./vectorStore";
import { profileService } from "./profileService";
import { ProposedAction } from "../../shared/types";
import * as chrono from "chrono-node";

/**
 * The single place where backend-proposed actions are turned into state changes.
 * Each action is applied exactly once so the Electron SQLite store is the only
 * writer. Actions are keyed by the backend's tool names.
 */

export interface ActionOutcome {
  applied: string[];
  errors: string[];
  /** True when task rows changed and the renderer should refresh the board. */
  tasksChanged: boolean;
}

const ACTION_ALIASES: Record<string, string> = {
  create_task: "task.create",
  task_create: "task.create",
  remember: "memory.store",
  memory_store: "memory.store"
};

function normalize(type: string): string {
  return ACTION_ALIASES[type] ?? type;
}

function parseDueAt(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const parsed = chrono.parseDate(text, new Date(), { forwardDate: true });
  return parsed ? parsed.getTime() : null;
}

export function applyActions(actions: ProposedAction[] | undefined | null): ActionOutcome {
  const outcome: ActionOutcome = { applied: [], errors: [], tasksChanged: false };
  if (!Array.isArray(actions)) return outcome;

  for (const action of actions) {
    if (!action || typeof action.type !== "string") continue;
    const type = normalize(action.type);
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    try {
      switch (type) {
        case "task.create": {
          const title = String(payload.title ?? "").trim();
          if (!title) {
            outcome.errors.push("task.create: missing title");
            break;
          }
          dbLayer.insert("tasks", {
            id: dbLayer.genId(),
            createdAt: Date.now(),
            title,
            notes: payload.notes ? String(payload.notes) : null,
            dueAt: parseDueAt(payload.dueAt),
            completed: 0,
            source: String(payload.source ?? "chat_nlp"),
            sourceId: null,
            recurring: null,
            tags: "[]"
          });
          outcome.applied.push("task.create");
          outcome.tasksChanged = true;
          break;
        }
        case "task.complete": {
          const id = String(payload.id ?? "");
          if (id) {
            dbLayer.update("tasks", id, { completed: 1 });
            outcome.applied.push("task.complete");
            outcome.tasksChanged = true;
          }
          break;
        }
        case "task.remove": {
          const id = String(payload.id ?? "");
          if (id) {
            dbLayer.remove("tasks", id);
            outcome.applied.push("task.remove");
            outcome.tasksChanged = true;
          }
          break;
        }
        case "memory.store": {
          const value = String(payload.value ?? payload.text ?? "").trim();
          const key = String(payload.key ?? "").trim();
          if (!value) {
            outcome.errors.push("memory.store: missing value");
            break;
          }
          void vectorStore.add(value);
          profileService.addFact(key || `fact_${Date.now()}`, value);
          outcome.applied.push("memory.store");
          break;
        }
        // Read-only / not-yet-implemented actions are ignored here; they are
        // surfaced to the renderer through the chat response itself.
        default:
          outcome.applied.push(type);
      }
    } catch (err) {
      outcome.errors.push(`${type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return outcome;
}
