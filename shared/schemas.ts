import { z } from "zod";

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  intent: z.string().optional(),
  createdAt: z.number(),
});

export const ProposedActionSchema = z.object({
  type: z.string(),
  payload: z.record(z.unknown()).optional(),
  requiresConfirmation: z.boolean().optional(),
});

export const IntentResultSchema = z.object({
  intent: z.string(),
  params: z.record(z.unknown()),
  routedTo: z.enum(["local", "cloud", "python"]),
  answer: z.string(),
  confidence: z.number().optional(),
  provider: z.string().optional(),
  actions: z.array(ProposedActionSchema).optional(),
});

export const ChatRequestSchema = z.object({
  text: z.string(),
  history: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() })).default([]),
  profile: z.record(z.unknown()).default({}),
  tasks: z.array(z.record(z.unknown())).default([]),
  facts: z.array(z.record(z.unknown())).default([]),
  assignments: z.array(z.record(z.unknown())).default([]),
});

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().optional(),
  dueAt: z.number().nullable(),
  completed: z.boolean(),
  source: z.string(),
  sourceId: z.string().optional(),
  createdAt: z.number(),
  recurring: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export const UserProfileSchema = z.object({
  activeHours: z.object({ start: z.number(), end: z.number() }),
  phrasingStyle: z.string(),
  recurringCategories: z.array(z.string()),
  learnedFacts: z.array(z.object({ key: z.string(), value: z.string(), updatedAt: z.number() })),
  summary: z.string(),
  voiceprintEnrolled: z.boolean().optional(),
});

export const VoiceStatusSchema = z.object({
  state: z.enum(["idle", "listening", "verifying", "processing", "speaking", "enrolling", "disabled"]),
  enrolled: z.boolean(),
  active: z.boolean(),
  engineAvailable: z.boolean(),
  speakerSimilarityThreshold: z.number(),
});

export const AdapterStateSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  status: z.enum(["healthy", "degraded", "dead", "unauthenticated"]),
  lastSyncAt: z.number().nullable(),
  errorMessage: z.string().optional(),
  category: z.string().optional(),
});

export const AutomationStatusSchema = z.object({
  active: z.boolean(),
  workflow: z.string().nullable(),
  startedAt: z.number().nullable(),
});

export const AutomationResultSchema = z.object({
  ok: z.boolean(),
  data: z.any().nullable(),
  logs: z.array(z.string()),
  error: z.object({ code: z.string(), message: z.string(), detail: z.string().optional() }).nullable(),
});

export const WebScrapeInputSchema = z.object({
  url: z.string(),
  selector: z.string().optional(),
  headless: z.boolean().optional(),
});

export const DesktopActionInputSchema = z.object({
  command: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const BrowserTaskInputSchema = z.object({
  steps: z.array(z.object({
    action: z.enum(["goto", "click", "type", "extract", "screenshot"]),
    url: z.string().optional(),
    selector: z.string().optional(),
    by: z.string().optional(),
    text: z.string().optional(),
  })),
  headless: z.boolean().optional(),
});

export const DeviceSyncStatusSchema = z.object({
  paired: z.boolean(),
  pairingCode: z.string(),
  serverPort: z.number(),
  connectedDevices: z.number(),
});
