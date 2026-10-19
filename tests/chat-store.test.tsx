import React from "react";
import { describe, it, expect } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { makeBridge, installBridge } from "./helpers";

describe("chat store", () => {
  it("sends a message and records the answer with its provider", async () => {
    const bridge = makeBridge();
    bridge.chat.send.mockResolvedValue({
      intent: "chat",
      params: {},
      routedTo: "python",
      answer: "Hello!",
      provider: "ollama",
    });
    installBridge(bridge);

    const { useChat } = await import("../src/store/chat");

    const res = await useChat.getState().send("hi");
    expect(res?.answer).toBe("Hello!");

    const st = useChat.getState();
    expect(st.thinking).toBe(false);
    expect(st.error).toBeNull();
    expect(st.messages).toHaveLength(2);
    expect(st.messages[0]).toMatchObject({ role: "user", text: "hi" });
    expect(st.messages[1]).toMatchObject({
      role: "assistant",
      text: "Hello!",
      intent: "chat",
      provider: "ollama",
    });
  });

  it("clears thinking and appends an error bubble when send throws", async () => {
    const bridge = makeBridge();
    bridge.chat.send.mockRejectedValue(new Error("backend down"));
    installBridge(bridge);

    const { useChat } = await import("../src/store/chat");

    await useChat.getState().send("hi");

    const st = useChat.getState();
    expect(st.thinking).toBe(false);
    expect(st.error).toBe("backend down");

    const last = st.messages[st.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.intent).toBe("error");
    expect(last.text).toContain("backend down");
    expect(bridge.chat.send).toHaveBeenCalledTimes(1);
  });

  it("keeps only the last 20 messages when loading history", async () => {
    const bridge = makeBridge();
    bridge.chat.history.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        id: `m${i}`,
        role: "user",
        text: `t${i}`,
        createdAt: i,
      }))
    );
    installBridge(bridge);

    const { useChat } = await import("../src/store/chat");

    await useChat.getState().load();

    const st = useChat.getState();
    expect(st.messages).toHaveLength(20);
    // The *last* 20 are kept (oldest dropped).
    expect(st.messages[0].id).toBe("m30");
    expect(st.messages[19].id).toBe("m49");
  });

  it("surfaces the provider and its privacy scope on the reply bubble", async () => {
    const bridge = makeBridge();
    bridge.chat.history.mockResolvedValue([
      { id: "a1", role: "assistant", text: "Sure.", intent: "chat", provider: "groq", createdAt: 1 },
    ]);
    installBridge(bridge);

    const { ChatPanel } = await import("../src/components/ChatPanel");
    render(<ChatPanel />);

    await waitFor(() => expect(screen.getByTestId("chat-provider")).toBeInTheDocument());
    expect(screen.getByTestId("chat-provider")).toHaveTextContent("provider: groq");
    // Groq sends prompts off-device, so the privacy label must say cloud.
    expect(screen.getByTestId("chat-provider")).toHaveTextContent("cloud");
    expect(screen.getByTestId("chat-intent")).toHaveTextContent("intent: chat");
  });

  it("labels a local provider as local", async () => {
    const bridge = makeBridge();
    bridge.chat.history.mockResolvedValue([
      { id: "a2", role: "assistant", text: "ok", intent: "chat", provider: "ollama", createdAt: 1 },
    ]);
    installBridge(bridge);

    const { ChatPanel } = await import("../src/components/ChatPanel");
    render(<ChatPanel />);

    await waitFor(() => expect(screen.getByTestId("chat-provider")).toBeInTheDocument());
    expect(screen.getByTestId("chat-provider")).toHaveTextContent("provider: ollama (local)");
  });

  it("shows the store error as a visible bubble, not a silent failure", async () => {
    const bridge = makeBridge();
    bridge.chat.send.mockRejectedValue(new Error("provider cold"));
    installBridge(bridge);

    const { useChat } = await import("../src/store/chat");
    const { ChatPanel } = await import("../src/components/ChatPanel");

    render(<ChatPanel />);
    await act(async () => {
      await useChat.getState().send("hi");
    });

    await waitFor(() => expect(screen.getByTestId("chat-bubble-assistant")).toBeInTheDocument());
    expect(screen.getByTestId("chat-bubble-assistant")).toHaveTextContent("provider cold");
  });
});
