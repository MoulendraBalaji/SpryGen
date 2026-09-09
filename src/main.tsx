import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./global.css";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught application error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: "var(--console-bg)",
          color: "var(--console-text)",
          fontFamily: "var(--console-font-mono)"
        }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "var(--console-accent-dim)" }}>
            SPRYGEN Encountered an Error
          </h2>
          <p style={{ margin: "0 0 16px", color: "var(--console-text-muted)", fontSize: 12 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="console-btn console-btn--primary"
            style={{ padding: "10px 20px" }}
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
