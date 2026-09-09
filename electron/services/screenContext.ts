import { groqChat, geminiChat } from "./cloudLLM";

export const screenContext = {
  async describe(prompt: string): Promise<string> {
    // On-demand screenshot + vision. Never continuous.
    // Online: Gemini/Groq reasoning. Offline: tesseract.js + local LLM.
    const system =
      "You are SPRYGEN Second Sight. Describe what is on the user's screen in response to their question. Be concise.";
    const messages = [{ role: "user" as const, content: prompt }];

    const gemini = await geminiChat(system, messages);
    if (gemini.ok && gemini.text.trim()) return gemini.text;

    const groq = await groqChat(system, messages);
    if (groq.ok && groq.text.trim()) return groq.text;

    return "Screen understanding needs the vision model or the tesseract.js offline path enabled.";
  }
};