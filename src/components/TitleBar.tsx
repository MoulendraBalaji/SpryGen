import React from "react";
import { useTheme } from "../store/theme";
import "./titlebar.css";

export function TitleBar() {
  const { theme, toggle } = useTheme();
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    window.sprygen?.window?.isMaximized().then(setMaximized);
    const unsub = window.sprygen?.onEvent("window:maximized-change", (isMax: boolean) => {
      setMaximized(isMax);
    });
    return () => { unsub?.(); };
  }, []);

  const handleMinimize = () => window.sprygen?.window?.minimize();
  const handleMaximize = () => window.sprygen?.window?.maximize();
  const handleClose = () => window.sprygen?.window?.close();

  return (
    <div className="titlebar" onDoubleClick={handleMaximize}>
      <div className="titlebar__drag">
        <span className="titlebar__title">sprygen</span>
      </div>
      <div className="titlebar__actions">
        <button
          className="titlebar__btn titlebar__btn--theme"
          onClick={toggle}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? "\u263E" : "\u2600"}
        </button>
        <button className="titlebar__btn titlebar__btn--min" onClick={handleMinimize} title="Minimize" aria-label="Minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="1" rx="0.5" fill="currentColor" /></svg>
        </button>
        <button className="titlebar__btn titlebar__btn--max" onClick={handleMaximize} title={maximized ? "Restore" : "Maximize"} aria-label="Maximize">
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="3.5" y="1" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="1.5" y="3.5" width="7" height="7" rx="1" fill="var(--console-bg)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
          )}
        </button>
        <button className="titlebar__btn titlebar__btn--close" onClick={handleClose} title="Close" aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
