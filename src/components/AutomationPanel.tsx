import React, { useEffect, useState } from "react";
import { ClayCard, ClayButton, ClayInput, ClayBadge } from "../design-system";
import { useAutomation } from "../store/automation";

export function AutomationPanel() {
  const { status, result, running, error, refresh, abort, webScrape, browserTask, desktopAction } = useAutomation();
  const [url, setUrl] = useState("");
  const [selector, setSelector] = useState("");
  const [taskUrl, setTaskUrl] = useState("");
  const [typeText, setTypeText] = useState("");
  const [extractSelector, setExtractSelector] = useState("");

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const doScrape = () => {
    if (!url.trim()) return;
    webScrape({ url: url.trim(), selector: selector.trim() || undefined, headless: true });
  };

  const doBrowserTask = () => {
    const steps = [
      { action: "goto" as const, url: taskUrl || "https://example.com" },
      ...(extractSelector.trim()
        ? [{ action: "extract" as const, selector: extractSelector.trim(), by: "css" }]
        : [])
    ];
    browserTask({ steps, headless: true });
  };

  const doAction = (command: string, params?: Record<string, unknown>) => {
    desktopAction({ command, params });
  };

  return (
    <div className="w-full max-w-3xl grid grid-cols-2 gap-4 overflow-y-auto p-2 [&>*]:h-min">
      <ClayCard eyebrow="A · Web Scrape (Selenium + BS4)">
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--console-text-muted)" }}>
          Scrape dynamic or protected DOM content, clean the text, and feed it straight into the LLM context.
        </p>
        <ClayInput placeholder="https://site.com/articles" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <ClayInput placeholder="CSS selector (optional)" value={selector} onChange={(e) => setSelector(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <ClayButton variant="primary" onClick={doScrape} disabled={running || !url.trim()}>
            {running ? "Running…" : "Scrape & Clean"}
          </ClayButton>
        </div>
      </ClayCard>

      <ClayCard eyebrow="B · Browser Task">
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--console-text-muted)" }}>
          Scripted headless browser run — navigate, extract tabular data, and screenshot pages.
        </p>
        <ClayInput placeholder="Target URL" value={taskUrl} onChange={(e) => setTaskUrl(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <ClayInput placeholder="Extract selector (optional)" value={extractSelector} onChange={(e) => setExtractSelector(e.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <ClayButton variant="accent" onClick={doBrowserTask} disabled={running}>
            {running ? "Running…" : "Run Browser Script"}
          </ClayButton>
        </div>
      </ClayCard>

      <ClayCard eyebrow="C · Desktop Actions (PyAutoGUI)">
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--console-text-muted)" }}>
          Safe screen control — FAILSAFE on, ESC / screen corners abort anything in flight.
        </p>
        <ClayInput placeholder="Type text…" value={typeText} onChange={(e) => setTypeText(e.target.value)} />
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <ClayButton variant="accent" onClick={() => doAction("screenshot")} disabled={running}>
            Screenshot
          </ClayButton>
          <ClayButton variant="accent" onClick={() => doAction("hotkey", { keys: ["alt", "tab"] })} disabled={running}>
            Alt+Tab
          </ClayButton>
          <ClayButton variant="accent" onClick={() => doAction("hotkey", { keys: ["win", "d"] })} disabled={running}>
            Win+D
          </ClayButton>
          <ClayButton variant="accent" onClick={() => doAction("hotkey", { keys: ["ctrl", "c"] })} disabled={running}>
            Ctrl+C
          </ClayButton>
          <ClayButton variant="accent" onClick={() => doAction("type", { text: typeText })} disabled={running || !typeText}>
            Type
          </ClayButton>
        </div>
      </ClayCard>

      <ClayCard eyebrow="D · Workflow Status & Kill Switch">
        <div className="console-row" style={{ justifyContent: "space-between" }}>
          <span style={{ fontSize: 12 }}>ACTIVE WORKFLOW</span>
          <ClayBadge status={status.active ? "healthy" : "unauthenticated"}>
            {status.active ? (status.workflow ?? "running") : "idle"}
          </ClayBadge>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--console-text-muted)" }}>
          Moving the mouse to a screen corner or pressing Esc fluor-aborts the running script.
        </p>
        <div style={{ marginTop: 12 }}>
          <ClayButton variant="primary" onClick={abort} disabled={!status.active}>
            ABORT AUTOMATION
          </ClayButton>
        </div>
        {error && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--console-red)" }}>
            {error}
          </p>
        )}
        {result && result.error && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--console-red)" }}>
            [{result.error.code}] {result.error.message}
          </p>
        )}
      </ClayCard>

      {result && result.ok && (
        <ClayCard eyebrow="Result" style={{ gridColumn: "1 / -1" }}>
          <pre className="console-pre" style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 260 }}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
          {result.logs?.map((l, i) => (
            <div key={i} className="console-meta" style={{ marginTop: 4 }}>
              {l}
            </div>
          ))}
        </ClayCard>
      )}
    </div>
  );
}