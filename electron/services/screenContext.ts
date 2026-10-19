import { desktopCapturer } from "electron";
import { proxyToPython } from "./pythonClient";

/**
 * Screen understanding is local-only (privacy). Electron grabs a single frame
 * with `desktopCapturer` and hands the PNG to the Python backend, which asks the
 * local Ollama vision model (llava-class) to describe it. Nothing leaves the
 * machine, and if no vision model is installed the call reports that clearly.
 */
export const screenContext = {
  async describe(prompt: string): Promise<string> {
    let sources: Electron.DesktopCapturerSource[];
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1280, height: 800 }
      });
    } catch (err) {
      return `Screen capture failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const source = sources.find((s) => !s.thumbnail.isEmpty()) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      return "No screen frame was available to analyse.";
    }

    const image = source.thumbnail.toPNG().toString("base64");
    const res = await proxyToPython<{ ok?: boolean; description?: string; error?: string }>(
      "/api/vision/describe",
      { method: "POST", body: JSON.stringify({ image, prompt }) },
      120_000
    );

    if (!res.ok) return `Local vision model unavailable: ${res.message}`;
    if (!res.data?.ok) {
      return `Local vision model unavailable: ${res.data?.error ?? "unknown error"}`;
    }
    return res.data.description ?? "(the vision model returned no description)";
  }
};
