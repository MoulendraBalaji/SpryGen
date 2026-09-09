import React from "react";
import { ClayCard, ClayInput, ClayButton } from "../design-system";
import { useScreen } from "../store/screen";

export function ScreenContext() {
  const { prompt, result, capturing, error, setPrompt, capture } = useScreen();

  const submit = () => {
    if (!capturing) capture();
  };

  return (
    <ClayCard large eyebrow="05 · Screen Context">
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--console-text-muted)" }}>
        Capture what is currently on your display and ask SPRYGEN to describe or analyze it —
        errors, docs, code, anything visible.
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <ClayInput
          placeholder="e.g. explain this error on the display"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        <ClayButton variant="primary" onClick={submit} disabled={capturing}>
          {capturing ? "capturing…" : "Analyze"}
        </ClayButton>
      </div>

      {!result && !error && !capturing && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--console-text-muted)" }}>
          You can also type <span className="console-kbd">/screen what is on my screen</span>{" "}
          in chat, or press <span className="console-kbd">Ctrl K</span>.
        </p>
      )}

      {capturing && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--console-text-muted)" }}>
          grabbing framebuffer and describing…
        </p>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--console-error)" }}>
          Screen capture failed: {error}
        </p>
      )}

      {result && !capturing && (
        <pre className="console-pre" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
          {result}
        </pre>
      )}
    </ClayCard>
  );
}