// Screen understanding is intentionally local-only (privacy). Phase 6 replaces
// this with Electron desktopCapturer + a local Ollama vision model (llava-class).
export const screenContext = {
  async describe(_prompt: string): Promise<string> {
    return "Screen understanding needs a local vision model. Install one with `ollama pull llava` and retry.";
  }
};
