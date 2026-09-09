import React from "react";
import { ClayCard, ClayInput, ClayButton } from "../design-system";
import { useRecall } from "../store/recall";

export function RecallPanel() {
  const { query, result, searching, searched, setQuery, search } = useRecall();

  const submit = () => {
    if (query.trim()) search();
  };

  return (
    <ClayCard large eyebrow="06 · Memory & Recall">
      <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--console-text-muted)" }}>
        Search SPRYGEN's long-term memory graph. Every remembered fact and quick capture is
        stored locally and retrievable here.
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <ClayInput
          placeholder="e.g. what is my passport expiration date"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          autoFocus
        />
        <ClayButton variant="primary" onClick={submit} disabled={searching}>
          {searching ? "…" : "Recall"}
        </ClayButton>
      </div>

      {!searched && !searching && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--console-text-muted)" }}>
          Ask something you previously told SPRYGEN — say "remember that…" in chat to store
          facts, then recall them here.
        </p>
      )}

      {searched && !searching && result && (
        <pre className="console-pre" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
          {result}
        </pre>
      )}

      {searched && !searching && !result && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--console-text-muted)" }}>
          No matching memories found for "{query}".
        </p>
      )}

      {searching && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--console-text-muted)" }}>searching memory graph…</p>
      )}
    </ClayCard>
  );
}