import { dbLayer } from "./db";
import { vectorStore } from "./vectorStore";
import { profileService } from "./profileService";
import { uiAutomation } from "./uiAutomation";
import { screenContext } from "./screenContext";
import { ProposedAction } from "../../shared/types";
import * as chrono from "chrono-node";

/**
 * The single place where backend-proposed actions become state changes, so the
 * Electron SQLite store is the only writer. Side-effecting actions proposed by
 * the LLM carry ``requiresConfirmation: true`` and are not applied until the
 * caller approves them.
 */

const SIDE_EFFECTING = new Set([
  "task.create",
  "task.complete",
  "task.remove",
  "memory.store",
  "automation.openApp",
  "scrape_url",
  "screen.describe"
]);

const ACTION_ALIASES: Record<string, string> = {
  create_task: "task.create",
  remember: "memory.store",
  open_app: "automation.openApp",
  list_tasks: "task.list",
  recall: "memory.recall"
};

export interface ActionOutcome {
  applied: string[];
  pending: ProposedAction[];
  errors: string[];
  notes: string[];
  tasksChanged: boolean;
}

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

export function describeAction(action: ProposedAction): string {
  const type = normalize(action.type);
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case "task.create":
      return `Create task: "${payload.title ?? ""}"`;
    case "memory.store":
      return `Remember: "${payload.value ?? ""}"`;
    case "automation.openApp":
      return `Open application: "${payload.target ?? ""}"`;
    case "scrape_url":
      return `Fetch web page: ${payload.url ?? ""}`;
    case "screen.describe":
      return "Capture and describe the current screen";
    default:
      return `${type}`;
  }
}

export async function applyActions(
  actions: ProposedAction[] | undefined | null,
  opts: { allowSideEffects?: boolean } = {}
): Promise<ActionOutcome> {
  const outcome: ActionOutcome = { applied: [], pending: [], errors: [], notes: [], tasksChanged: false };
  if (!Array.isArray(actions)) return outcome;

  for (const action of actions) {
    if (!action || typeof action.type !== "string") continue;
    const type = normalize(action.type);
    const payload = (action.payload ?? {}) as Record<string, unknown>;

    // Read-only tool calls are resolved in the backend; nothing to apply here.
    if (!SIDE_EFFECTING.has(type)) continue;

    if (action.requiresConfirmation && !opts.allowSideEffects) {
      outcome.pending.push(action);
      continue;
    }

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
          const value = String(payload.value ?? "").trim();
          if (!value) {
            outcome.errors.push("memory.store: missing value");
            break;
          }
          await vectorStore.add(value);
          profileService.addFact(String(payload.key ?? value.slice(0, 80)), value);
          outcome.applied.push("memory.store");
          break;
        }
        case "automation.openApp": {
          const target = String(payload.target ?? "");
          const result = uiAutomation.open(target);
          if (result.ok) {
            outcome.applied.push("automation.openApp");
            outcome.notes.push(`Opened ${target}.`);
          } else {
            outcome.errors.push(result.reason ?? `Could not open ${target}`);
          }
          break;
        }
        case "screen.describe": {
          const description = await screenContext.describe(String(payload.prompt ?? "Describe the screen."));
          outcome.applied.push("screen.describe");
          outcome.notes.push(description);
          break;
        }
        default:
          outcome.errors.push(`${type}: not supported`);
      }
    } catch (err) {
      outcome.errors.push(`${type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return outcome;
}
