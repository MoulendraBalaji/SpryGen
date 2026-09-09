import React, { useEffect, useRef, useState } from "react";
import { ClayCard, ClayInput, ClayButton } from "../design-system";
import { useChat } from "../store/chat";
import { IntentResult } from "../../shared/types";

export function ChatPanel() {
  const { messages, thinking, load, send } = useChat();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    if (/^\/screen/i.test(trimmed)) {
      useChat.getState().sendScreen(trimmed);
    } else {
      send(trimmed);
    }
  };

  return (
    <ClayCard large eyebrow="08 · Conversation" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role} text={m.text} intent={m.intent} />
        ))}
        {thinking && <Bubble role="assistant" text="…" intent={undefined} />}
        <div ref={endRef} />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <ClayInput placeholder="Ask SPRYGEN anything…  or /screen to analyze the display" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <ClayButton variant="primary" onClick={submit}>Send</ClayButton>
      </div>
    </ClayCard>
  );
}

function Bubble({ role, text, intent }: { role: string; text: string; intent?: string }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        className="console-pre"
        style={{
          maxWidth: "78%",
          padding: "10px 12px",
          background: isUser ? "var(--console-accent)" : "var(--console-surface)",
          color: isUser ? "var(--console-accent-ink)" : "var(--console-text)",
          border: isUser ? "1px solid var(--console-accent)" : "1px solid var(--console-border)",
          fontSize: 13
        }}
      >
        <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
        {intent && !isUser && (
          <div className="console-meta" style={{ marginTop: 6, color: "var(--console-text-faint)" }}>
            intent: {intent}
          </div>
        )}
      </div>
    </div>
  );
}