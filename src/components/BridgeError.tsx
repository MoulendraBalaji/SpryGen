import React from "react";

/**
 * Blocking screen shown when the preload script did not expose the IPC bridge.
 *
 * The renderer cannot talk to the main process without it, so we stop here
 * instead of rendering a UI that silently shows fabricated/empty data.
 */
export function BridgeError() {
  return (
    <div
      data-testid="bridge-error"
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--console-bg, #07070a)",
        color: "var(--console-text, #eaeaea)",
        fontFamily: "monospace",
      }}
    >
      <div style={{ maxWidth: 560, border: "1px solid var(--console-red, #E0002A)", padding: 20 }}>
        <h1 style={{ margin: "0 0 12px", fontSize: 16, color: "var(--console-red, #E0002A)" }}>
          SPRYGEN could not start
        </h1>
        <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.6 }}>
          The preload bridge (<code>window.sprygen</code>) is missing, so the interface has no access to your tasks,
          chat history or settings.
        </p>
        <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.6 }}>
          To avoid showing fake or empty data, SPRYGEN has stopped loading instead.
        </p>
        <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Restart the app.</li>
          <li>Make sure you launched the packaged app or `npm run dev` (not a raw `index.html`).</li>
          <li>Check the main-process log for preload errors.</li>
        </ul>
      </div>
    </div>
  );
}
