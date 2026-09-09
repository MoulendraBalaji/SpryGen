import React, { useEffect, useMemo, useState } from "react";
import { useUI, View } from "../store/ui";
import { useTasks } from "../store/tasks";
import { useRecall } from "../store/recall";
import { useScreen } from "../store/screen";
import { useChat } from "../store/chat";
import * as chrono from "chrono-node";

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

const NAV_LABELS: { id: View; label: string; hint: string }[] = [
  { id: "briefing", label: "Daily Briefing", hint: "view" },
  { id: "tasks", label: "Task Board", hint: "view" },
  { id: "chat", label: "Chat", hint: "view" },
  { id: "recall", label: "Memory & Recall", hint: "view" },
  { id: "screen", label: "Screen Context", hint: "view" },
  { id: "integrations", label: "Sources / Integrations", hint: "view" },
  { id: "focus", label: "Focus Guardian", hint: "view" },
  { id: "profile", label: "Profile Settings", hint: "view" }
];

export function CommandPalette() {
  const { paletteOpen, paletteQuery, setPaletteQuery, closePalette, setView } = useUI();
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUI.getState().openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [paletteOpen, paletteQuery]);

  useEffect(() => {
    if (!paletteOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePalette();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, commands.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = commands[active];
        if (cmd) cmd.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const commands = useMemo<Command[]>(() => {
    const q = paletteQuery.trim();
    const actions: Command[] = [
      {
        id: "task",
        label: q ? `Create task: ${q}` : "Create task…",
        hint: "enter a task (dates are parsed)",
        run: () => {
          const title = q;
          const parsed = chrono.parse(title, new Date(), { forwardDate: true });
          const dueAt = parsed.length ? parsed[0].start.date().getTime() : null;
          void useTasks.getState().create(title || "Untitled task", dueAt);
          setView("tasks");
          closePalette();
        }
      },
      {
        id: "recall",
        label: q ? `Recall: ${q}` : "Search memory…",
        hint: "run a memory-graph query",
        run: () => {
          const query = q || "what do I know about this week";
          useRecall.getState().setQuery(query);
          void useRecall.getState().search(query);
          setView("recall");
          closePalette();
        }
      },
      {
        id: "screen",
        label: q ? `Describe screen: ${q}` : "Describe screen…",
        hint: "capture current display",
        run: () => {
          void useScreen.getState().capture(q || "Summarize what is currently on screen.");
          setView("screen");
          closePalette();
        }
      },
      {
        id: "chat",
        label: q ? `Ask SPRYGEN: ${q}` : "Ask SPRYGEN anything…",
        hint: "send to chat",
        run: () => {
          if (q) void useChat.getState().send(q);
          setView("chat");
          closePalette();
        }
      }
    ];

    if (!q) return [...actions, ...NAV_LABELS.map((n) => ({ id: n.id, label: n.label, hint: n.hint, run: () => { setView(n.id); closePalette(); } } as Command))];

    const navMatches = NAV_LABELS.filter((n) => n.label.toLowerCase().includes(q.toLowerCase()) || n.hint.includes(q.toLowerCase()));
    if (!navMatches.length) return actions;
    return [...navMatches.map((n) => ({ id: n.id, label: n.label, hint: n.hint, run: () => { setView(n.id); closePalette(); } } as Command)), ...actions];
  }, [paletteQuery, setView, closePalette]);

  if (!paletteOpen) return null;

  return (
    <div className="console-palette__backdrop" onClick={closePalette}>
      <div className="console-palette" onClick={(e) => e.stopPropagation()}>
        <input
          className="console-palette__input"
          placeholder="Type a command — e.g. add a task, recall a memory, describe screen…"
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          autoFocus
          spellCheck={false}
        />
        <div className="console-palette__list">
          {commands.map((cmd, idx) => (
            <button
              key={cmd.id}
              className={`console-palette__item ${idx === active ? "console-palette__item--active" : ""}`}
              onMouseEnter={() => setActive(idx)}
              onClick={cmd.run}
            >
              <span className="console-palette__label">{cmd.label}</span>
              <span className="console-palette__hint">{cmd.hint}</span>
            </button>
          ))}
          {commands.length === 0 && (
            <div className="console-palette__empty">No commands match "{paletteQuery}".</div>
          )}
        </div>
        <div className="console-palette__footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}