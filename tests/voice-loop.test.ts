import { describe, it, expect, vi } from "vitest";
import { makeBridge, installBridge } from "./helpers";

/**
 * Speech-to-speech: a `voice:transcript` event must go through the chat
 * pipeline and the answer must be spoken back through local TTS.
 */
describe("speech-to-speech loop", () => {
  it("sends the transcript to chat and speaks the answer", async () => {
    const bridge = makeBridge();
    let handler: ((text: string) => void) | null = null;
    bridge.onEvent.mockImplementation((channel: string, cb: (payload: unknown) => void) => {
      if (channel === "voice:transcript") handler = cb as (text: string) => void;
      return () => {};
    });
    bridge.chat.send.mockResolvedValue({
      intent: "chat",
      params: {},
      routedTo: "python" as const,
      answer: "The weather is sunny.",
      provider: "ollama",
    });
    installBridge(bridge);

    const { wireVoiceLoop } = await import("../src/lib/voiceLoop");
    const unsubscribe = wireVoiceLoop();
    expect(handler).toBeTypeOf("function");

    handler!("what is the weather");

    await vi.waitFor(() => expect(bridge.chat.send).toHaveBeenCalledWith("what is the weather"));
    await vi.waitFor(() => expect(bridge.voice.speak).toHaveBeenCalledWith("The weather is sunny."));

    unsubscribe();
  });

  it("does not speak when the answer is empty or replies are muted", async () => {
    const bridge = makeBridge();
    let handler: ((text: string) => void) | null = null;
    bridge.onEvent.mockImplementation((channel: string, cb: (payload: unknown) => void) => {
      if (channel === "voice:transcript") handler = cb as (text: string) => void;
      return () => {};
    });
    installBridge(bridge);

    const { wireVoiceLoop } = await import("../src/lib/voiceLoop");
    const { useVoice } = await import("../src/store/voice");
    wireVoiceLoop();

    useVoice.setState({ speakReplies: false });
    handler!("mute me");
    await vi.waitFor(() => expect(bridge.chat.send).toHaveBeenCalledWith("mute me"));
    expect(bridge.voice.speak).not.toHaveBeenCalled();

    // A TTS failure must never throw out of the loop.
    bridge.voice.speak.mockRejectedValue(new Error("no tts"));
    bridge.chat.send.mockResolvedValue({
      intent: "chat",
      params: {},
      routedTo: "python" as const,
      answer: "still fine",
      provider: "ollama",
    });
    useVoice.setState({ speakReplies: true });
    handler!("unmute me");
    await vi.waitFor(() => expect(bridge.voice.speak).toHaveBeenCalledWith("still fine"));
  });

  it("ignores empty transcripts", async () => {
    const bridge = makeBridge();
    let handler: ((text: string) => void) | null = null;
    bridge.onEvent.mockImplementation((channel: string, cb: (payload: unknown) => void) => {
      if (channel === "voice:transcript") handler = cb as (text: string) => void;
      return () => {};
    });
    installBridge(bridge);

    const { wireVoiceLoop } = await import("../src/lib/voiceLoop");
    wireVoiceLoop();

    handler!("   ");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bridge.chat.send).not.toHaveBeenCalled();
    expect(bridge.voice.speak).not.toHaveBeenCalled();
  });
});
