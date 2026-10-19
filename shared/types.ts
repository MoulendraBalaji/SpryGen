export type AdapterStatus = "healthy" | "degraded" | "dead" | "unauthenticated";

export interface AdapterState {
  id: string;
  label: string;
  description: string;
  status: AdapterStatus;
  lastSyncAt: number | null;
  errorMessage?: string;
  /** Groups non-adapter health rows surfaced in the Sources panel (e.g. "system", "config"). */
  category?: string;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  dueAt: number | null;
  completed: boolean;
  source: string;
  sourceId?: string;
  createdAt: number;
  recurring?: string | null;
  tags?: string[];
}

export interface Assignment {
  id: string;
  course: string;
  title: string;
  dueAt: number | null;
  link?: string;
  state: string;
  syncedAt: number;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  intent?: string;
  createdAt: number;
}

/** A side-effecting operation proposed by the backend chat agent. */
export interface ProposedAction {
  type: string;
  payload?: Record<string, unknown>;
  /** When true the action must be confirmed by the user before it is applied. */
  requiresConfirmation?: boolean;
}

export interface IntentResult {
  intent: string;
  params: Record<string, unknown>;
  routedTo: "local" | "cloud" | "python";
  answer: string;
  confidence?: number;
  /** Which LLM provider produced the answer (e.g. "ollama", "groq"). */
  provider?: string;
  /** Proposed side-effecting actions. Applied by the main process. */
  actions?: ProposedAction[];
}

export interface UserProfile {
  activeHours: { start: number; end: number };
  phrasingStyle: string;
  recurringCategories: string[];
  learnedFacts: { key: string; value: string; updatedAt: number }[];
  summary: string;
  voiceprintEnrolled?: boolean;
}

export interface BriefingItem {
  kind: "task" | "assignment" | "note";
  title: string;
  dueAt: number | null;
}

export type VoiceState =
  | "idle"
  | "listening"
  | "verifying"
  | "processing"
  | "speaking"
  | "enrolling"
  | "disabled";

export interface VoiceStatus {
  state: VoiceState;
  enrolled: boolean;
  active: boolean;
  /** Whether the local Python voice engine (capture + speaker model) is available. */
  engineAvailable: boolean;
  speakerSimilarityThreshold: number;
}

export interface VoiceEnrollmentProgress {
  currentSample: number;
  totalSamples: number;
  status: "capturing" | "completed" | "failed";
  message?: string;
}

export type OverlayMode = "hidden" | "summoned" | "pinned" | "suppressed";

export interface SuppressedNotification {
  id: string;
  title: string;
  body: string;
  queuedAt: number;
}

export interface OverlayStatus {
  mode: OverlayMode;
  isFullscreen: boolean;
  isDND: boolean;
  suppressedCount: number;
}

export interface DeviceSyncStatus {
  paired: boolean;
  pairingCode: string;
  serverPort: number;
  connectedDevices: number;
}

// ---------------------------------------------------------------------------
// Automation (Selenium / BeautifulSoup / PyAutoGUI)
// ---------------------------------------------------------------------------
export interface AutomationResult {
  ok: boolean;
  data: any;
  logs: string[];
  error: {
    code: string;
    message: string;
    detail?: string;
  } | null;
}

export interface AutomationStatus {
  active: boolean;
  workflow: string | null;
  startedAt: number | null;
}

export interface WebScrapeInput {
  url: string;
  selector?: string;
  headless?: boolean;
}

export interface BrowserTaskStep {
  action: "goto" | "click" | "type" | "extract" | "screenshot";
  url?: string;
  selector?: string;
  by?: string;
  text?: string;
}

export interface BrowserTaskInput {
  steps: BrowserTaskStep[];
  headless?: boolean;
}

export interface DesktopActionInput {
  command: string;
  params?: Record<string, unknown>;
}

export interface SprygenAPI {
  tasks: {
    list(): Promise<Task[]>;
    create(input: Partial<Task>): Promise<Task>;
    update(id: string, patch: Partial<Task>): Promise<Task>;
    remove(id: string): Promise<void>;
  };
  chat: {
    send(text: string): Promise<IntentResult>;
    history(): Promise<ChatMessage[]>;
  };
  integrations: {
    list(): Promise<AdapterState[]>;
    reconnect(id: string): Promise<AdapterState>;
    authorize(id: string): Promise<AdapterState>;
  };
  profile: {
    get(): Promise<UserProfile>;
    set(patch: Partial<UserProfile>): Promise<UserProfile>;
    deleteFact(key: string): Promise<UserProfile>;
  };
  briefing: {
    generate(): Promise<BriefingItem[]>;
  };
  voice: {
    enroll(): Promise<boolean>;
    startListening(): Promise<boolean>;
    stopListening(): Promise<boolean>;
    getStatus(): Promise<VoiceStatus>;
    speak(text: string): Promise<boolean>;
  };
  overlay: {
    summon(): Promise<void>;
    dismiss(): Promise<void>;
    toggle(): Promise<OverlayMode>;
    setMode(mode: OverlayMode): Promise<void>;
    getStatus(): Promise<OverlayStatus>;
    getQueue(): Promise<SuppressedNotification[]>;
    flushQueue(): Promise<SuppressedNotification[]>;
  };
  sync: {
    getStatus(): Promise<DeviceSyncStatus>;
    regenerateCode(): Promise<string>;
  };
  screen: {
    captureAndDescribe(prompt: string): Promise<string>;
  };
  recall: {
    query(text: string): Promise<string>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
  };
  automation: {
    getStatus(): Promise<AutomationStatus>;
    abort(): Promise<{ ok: boolean }>;
    webScrape(input: WebScrapeInput): Promise<AutomationResult>;
    browserTask(input: BrowserTaskInput): Promise<AutomationResult>;
    desktopAction(input: DesktopActionInput): Promise<AutomationResult>;
  };
  onEvent(channel: string, cb: (...args: any[]) => void): () => void;
}
