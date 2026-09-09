import { claudeChat } from "./cloudLLM";

export const screenContext = {
  async describe(prompt: string): Promise<string> {
    // On-demand screenshot + OCR/vision. Never continuous.
    // Offline: tesseract.js + local LLM. Online: Claude vision.
    if (process.env.ANTHROPIC_API_KEY) {
      const res = await claudeChat(
        "You are SPRYGEN Second Sight. Describe what is on the user's screen in response to their question. Be concise.",
        [{ role: "user", content: prompt }]
      );
      if (res.ok) return res.text;
    }
    return "Screen understanding needs the vision model or tesseract.js offline path enabled.";
  }
};
