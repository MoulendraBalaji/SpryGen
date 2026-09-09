import React, { useEffect, useState } from "react";
import { ClayCard, ClayButton, ClayInput } from "../design-system";
import { useTasks } from "../store/tasks";
import { useChat } from "../store/chat";
import * as chrono from "chrono-node";

export function TaskBoard() {
  const { tasks, load, create, toggle, remove } = useTasks();
  const [title, setTitle] = useState("");

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!title.trim()) return;
    const parsed = chrono.parse(title, new Date(), { forwardDate: true });
    const dueAt = parsed.length ? parsed[0].start.date().getTime() : null;
    await create(title.trim(), dueAt);
    setTitle("");
  };

  return (
    <ClayCard large eyebrow="01 · Task Board">
      <div className="console-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <span className="console-meta">{tasks.length} total</span>
        <span className="console-count">{tasks.filter((t) => !t.completed).length} open</span>
      </div>
      <div style={{ display: "flex", gap: 10, margin: "12px 0" }}>
        <ClayInput
          placeholder="Add a task…  e.g. Submit essay by Friday"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <ClayButton variant="primary" onClick={submit}>Add</ClayButton>
      </div>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
        {tasks.length === 0 && (
          <p className="console-meta" style={{ margin: "8px 0" }}>
            No tasks yet. Try the chat: "remind me to call mom tomorrow".
          </p>
        )}
        {tasks.map((t) => (
          <div key={t.id} className="console-row">
            <input type="checkbox" checked={!!t.completed} onChange={() => toggle(t.id)} className="console-checkbox" />
            <div style={{ flex: 1 }}>
              <div style={{ textDecoration: t.completed ? "line-through" : "none", color: t.completed ? "var(--console-text-muted)" : "var(--console-text)" }}>
                {t.title}
              </div>
              {t.dueAt && <div className="console-meta">{new Date(t.dueAt).toLocaleString()}</div>}
            </div>
            <button className="console-delete" onClick={() => remove(t.id)} aria-label="Delete task">✕</button>
          </div>
        ))}
      </div>
      <QuickAsk onAsk={(q) => useChat.getState().send(q)} />
    </ClayCard>
  );
}

function QuickAsk({ onAsk }: { onAsk: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
      <ClayInput placeholder="Or just ask SPRYGEN…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (onAsk(q), setQ(""))} />
      <ClayButton variant="ghost" onClick={() => (onAsk(q), setQ(""))}>Ask</ClayButton>
    </div>
  );
}