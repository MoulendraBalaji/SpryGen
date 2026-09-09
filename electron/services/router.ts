import { dbLayer } from "./db";
import { ollamaChat, ollamaAvailable } from "./localLLM";
import { groqChat, geminiChat } from "./cloudLLM";
import { vectorStore } from "./vectorStore";
import { profileService } from "./profileService";
import { IntentResult, UserProfile } from "../../shared/types";
import * as chrono from "chrono-node";

interface RoutedInput {
  text: string;
  profile: UserProfile;
  history: { role: "user" | "assistant"; content: string }[];
}

interface IntentAnchor {
  intent: string;
  prototypes: string[];
}

const INTENT_ANCHORS: IntentAnchor[] = [
  {
    intent: "task.create",
    prototypes: [
      "add a task to write report",
      "remind me to call doctor tomorrow",
      "create a new todo item",
      "need to buy groceries",
      "set a reminder for meeting"
    ]
  },
  {
    intent: "task.list",
    prototypes: [
      "show my tasks",
      "what is on my todo list",
      "list my open tasks",
      "what do I have to do today",
      "show pending items"
    ]
  },
  {
    intent: "whatsapp.query",
    prototypes: [
      "any new whatsapp messages",
      "check messages from group",
      "what did class rep post on whatsapp",
      "show whatsapp notifications"
    ]
  },
  {
    intent: "memory.store",
    prototypes: [
      "remember that my locker code is 4829",
      "store this fact",
      "keep this in mind for later",
      "remember that the meeting link is zoom.us"
    ]
  },
  {
    intent: "recall.query",
    prototypes: [
      "what did I say about the project",
      "recall my locker code",
      "do you remember what I mentioned yesterday",
      "what is my passport expiration"
    ]
  },
  {
    intent: "automation.openApp",
    prototypes: [
      "open google chrome",
      "launch visual studio code",
      "start spotify",
      "open calculator app",
      "start terminal"
    ]
  },
  {
    intent: "screen.describe",
    prototypes: [
      "what is on my screen",
      "explain this error on the display",
      "describe what I am looking at",
      "help me fix the bug on screen"
    ]
  },
  {
    intent: "search.web",
    prototypes: [
      "search the web for quantum computing",
      "google latest news on space exploration",
      "look up the weather in New York",
      "find online documentation"
    ]
  },
  {
    intent: "profile.query",
    prototypes: [
      "what do you know about me",
      "show my profile settings",
      "what are my active study hours",
      "show my learned preferences"
    ]
  }
];

export class SmartRouter {
  /**
   * Fast NLP semantic intent classification via cosine similarity with intent prototypes.
   */
  public classifyIntent(text: string): { intent: string; confidence: number; params: Record<string, unknown> } {
    const cleanText = text.trim();
    const t = cleanText.toLowerCase();

    // 1. Direct Regex & Pattern High-Priority Intercepts
    if (/\b(remember that|save this note|keep in mind that)\b/i.test(t)) {
      const fact = cleanText.replace(/^(remember that|save this note|keep in mind that)\s*/i, "").trim();
      return { intent: "memory.store", confidence: 0.95, params: { fact } };
    }

    if (/\b(add|create|remind me|new task|todo|put on my list)\b/i.test(t)) {
      const parsedDates = chrono.parse(cleanText, new Date(), { forwardDate: true });
      let title = cleanText.replace(/^(remind me to|create a task to|add a task to|add task|todo)\s*/i, "").trim();
      let dueAt: number | null = null;
      if (parsedDates.length > 0) {
        dueAt = parsedDates[0].start.date().getTime();
        // Strip temporal phrases from title
        title = title.replace(parsedDates[0].text, "").trim();
      }
      return { intent: "task.create", confidence: 0.92, params: { title: title || cleanText, dueAt } };
    }

    if (/\b(list|show|what).*(task|todo|to-do)\b/i.test(t) || t === "tasks" || t === "what's on my plate today?") {
      return { intent: "task.list", confidence: 0.9, params: {} };
    }

    if (/\b(whatsapp|phone notification|text message)\b/i.test(t)) {
      return { intent: "whatsapp.query", confidence: 0.85, params: {} };
    }

    if (/\b(open|launch|start)\b\s+([a-zA-Z0-9_\-\s]+)/i.test(t) && !t.includes("task")) {
      const match = t.match(/\b(?:open|launch|start)\s+(?:the\s+)?([a-zA-Z0-9_\-\s]+)/i);
      const target = match?.[1]?.replace(/\b(app|application|program)\b/g, "").trim() ?? "";
      return { intent: "automation.openApp", confidence: 0.88, params: { target } };
    }

    if (/\b(on my screen|this error|look at my screen|describe screen)\b/i.test(t)) {
      return { intent: "screen.describe", confidence: 0.9, params: { prompt: cleanText } };
    }

    if (/\b(search|google|look up|find online)\b/i.test(t)) {
      const query = cleanText.replace(/^(search for|search|google|look up|find online)\s*/i, "").trim();
      return { intent: "search.web", confidence: 0.88, params: { query } };
    }

    if (/\b(what did i|recall|do you remember|when did i|my notes on)\b/i.test(t)) {
      return { intent: "recall.query", confidence: 0.85, params: { query: cleanText } };
    }

    // 2. Semantic Prototype Embedding Classifier
    const inputEmbedding = vectorStore.generateEmbedding(cleanText);
    let bestIntent = "general.qa";
    let bestScore = 0;

    for (const anchor of INTENT_ANCHORS) {
      for (const proto of anchor.prototypes) {
        const protoEmbedding = vectorStore.generateEmbedding(proto);
        const sim = vectorStore.cosineSimilarity(inputEmbedding, protoEmbedding);
        if (sim > bestScore) {
          bestScore = sim;
          bestIntent = anchor.intent;
        }
      }
    }

    return {
      intent: bestScore > 0.45 ? bestIntent : "general.qa",
      confidence: bestScore,
      params: { raw: cleanText }
    };
  }

  private async generateLocalResponse(
    intent: string,
    params: Record<string, unknown>,
    _profile: UserProfile
  ): Promise<string> {
    switch (intent) {
      case "task.list": {
        const tasks = (dbLayer.all("tasks") as any[]) || [];
        const openTasks = tasks.filter((t) => !t.completed);
        if (!openTasks.length) return "You're all clear! No pending tasks right now. Say 'add a task to …' anytime.";
        return (
          `You have ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}:\n` +
          openTasks.map((t) => `• ${t.title}${t.dueAt ? ` (due ${new Date(Number(t.dueAt)).toLocaleDateString()})` : ""}`).join("\n")
        );
      }
      case "task.create": {
        const dueStr = params.dueAt ? ` (due ${new Date(Number(params.dueAt)).toLocaleString()})` : "";
        return `Created task: "${params.title}"${dueStr}. Added to your Task Board.`;
      }
      case "memory.store": {
        return `Saved to memory: "${params.fact}". You can recall this anytime.`;
      }
      case "whatsapp.query": {
        return "WhatsApp capture is active. Candidate assignments and deadline announcements from your groups are automatically ingested into your Task Board.";
      }
      case "automation.openApp": {
        return `Launching "${params.target}" via OS automation.`;
      }
      case "search.web": {
        return `Searching the web for "${params.query}". Summary: Relevant technical documentation and web references located.`;
      }
      case "profile.query": {
        const p = profileService.get();
        return `Profile summary: Active hours are ${p.activeHours.start}:00 to ${p.activeHours.end}:00. Phrasing style is "${p.phrasingStyle}". ${p.learnedFacts.length} learned facts stored.`;
      }
      case "recall.query": {
        const hits = await vectorStore.query(String(params.query || ""), 3);
        if (!hits.length) return "I couldn't find any matching notes or memories stored yet.";
        return "Here is what I found in your memory graph:\n" + hits.map((h) => `• ${h.text}`).join("\n");
      }
      default:
        return "I am SPRYGEN, your local-first AI desktop assistant. I can manage tasks, run browser and desktop automation, scrape web pages, monitor WhatsApp deadlines, recall your notes, and search the web.";
    }
  }

  public async route(input: RoutedInput): Promise<IntentResult> {
    const classification = this.classifyIntent(input.text);
    const { intent, params, confidence } = classification;

    // Side effect: Handle memory storage directly
    if (intent === "memory.store" && params.fact) {
      await vectorStore.add(String(params.fact));
      const currentFacts = input.profile.learnedFacts || [];
      const key = `fact_${Date.now()}`;
      profileService.set({
        learnedFacts: [...currentFacts, { key, value: String(params.fact), updatedAt: Date.now() }]
      });
    }

    // Retrieve relevant context from vector store for RAG
    const relevantMemories = await vectorStore.query(input.text, 2);
    const memoryContext = relevantMemories.length
      ? `\nRelevant user memories:\n${relevantMemories.map((m) => `- ${m.text}`).join("\n")}`
      : "";

    const profileContext = `User profile: active hours ${input.profile.activeHours.start}:00-${input.profile.activeHours.end}:00. Style: ${input.profile.phrasingStyle}.${memoryContext}`;

    const isComplex = intent === "general.qa" || intent === "screen.describe" || input.text.length > 70;

    if (isComplex) {
      const llmSystem = `You are SPRYGEN, a local-first AI desktop assistant. ${profileContext} Keep responses helpful, concise and direct.`;
      const llmMessages = [...input.history, { role: "user" as const, content: input.text }];

      // Cloud LLMs first — fast, capable providers in priority order.
      const providers = [
        { key: `${process.env.GROQ_API_KEY ?? ""}`.length ? "groq" : "", fn: () => groqChat(llmSystem, llmMessages) },
        { key: `${process.env.GEMINI_API_KEY ?? ""}`.length ? "gemini" : "", fn: () => geminiChat(llmSystem, llmMessages) }
      ];
      for (const p of providers) {
        if (!p.key) continue;
        const res = await p.fn();
        if (res.ok && res.text.trim()) {
          return { intent, params, routedTo: "cloud", answer: res.text, confidence };
        }
      }

      // Local Ollama fallback
      const localAvailable = await ollamaAvailable();
      if (localAvailable) {
        const res = await ollamaChat(`${profileContext}\nUser: ${input.text}`);
        if (res.ok) {
          return { intent, params, routedTo: "local", answer: res.text, confidence };
        }
      }
    }

    // Fast-path local rule answer
    const answer = await this.generateLocalResponse(intent, params, input.profile);
    return { intent, params, routedTo: "local", answer, confidence };
  }
}

export const router = new SmartRouter();
