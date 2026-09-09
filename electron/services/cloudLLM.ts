const CLAUDE_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export interface CloudResult {
  text: string;
  ok: boolean;
}

type ChatMsg = { role: "user" | "assistant"; content: string };

export async function claudeChat(system: string, messages: ChatMsg[]): Promise<CloudResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { text: "", ok: false };
  try {
    const res = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system,
        messages
      })
    });
    if (!res.ok) return { text: "", ok: false };
    const data = (await res.json()) as { content?: { text?: string }[] };
    return { text: data.content?.[0]?.text ?? "", ok: true };
  } catch {
    return { text: "", ok: false };
  }
}

export async function groqChat(system: string, messages: ChatMsg[]): Promise<CloudResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { text: "", ok: false };
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: 1024
      })
    });
    if (!res.ok) return { text: "", ok: false };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: data.choices?.[0]?.message?.content ?? "", ok: true };
  } catch {
    return { text: "", ok: false };
  }
}

export async function geminiChat(system: string, messages: ChatMsg[]): Promise<CloudResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: "", ok: false };
  try {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 1024 }
      })
    });
    if (!res.ok) return { text: "", ok: false };
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return { text: parts.map((p) => p.text ?? "").join(""), ok: true };
  } catch {
    return { text: "", ok: false };
  }
}