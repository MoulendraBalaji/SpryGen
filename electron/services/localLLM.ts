export interface LocalCompletion {
  text: string;
  ok: boolean;
}

const OLLAMA_URL = process.env.SPRYGEN_OLLAMA_URL || process.env.JARVIS_OLLAMA_URL || "http://127.0.0.1:11434";

export async function ollamaChat(prompt: string, model = "llama3.2"): Promise<LocalCompletion> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false })
    });
    if (!res.ok) return { text: "", ok: false };
    const data = (await res.json()) as { response?: string };
    return { text: data.response ?? "", ok: true };
  } catch {
    return { text: "", ok: false };
  }
}

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
