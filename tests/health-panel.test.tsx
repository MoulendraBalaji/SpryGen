import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { makeBridge, installBridge } from "./helpers";

describe("health panel and provider/voice surfacing", () => {
  it("renders each provider/adapter row in the health panel", async () => {
    const bridge = makeBridge();
    const providerRows = [
      { id: "provider:ollama", label: "Ollama", description: "local", status: "healthy", lastSyncAt: null, category: "provider" },
      { id: "provider:groq", label: "Groq", description: "cloud", status: "unauthenticated", lastSyncAt: null, category: "provider" },
      { id: "provider:cerebras", label: "Cerebras", description: "cloud", status: "unauthenticated", lastSyncAt: null, category: "provider" },
      { id: "provider:openrouter", label: "OpenRouter", description: "cloud", status: "unauthenticated", lastSyncAt: null, category: "provider" },
      { id: "provider:mistral", label: "Mistral", description: "cloud", status: "unauthenticated", lastSyncAt: null, category: "provider" },
    ];
    bridge.integrations.list.mockResolvedValue(providerRows);
    installBridge(bridge);

    const { IntegrationsHealth } = await import("../src/components/IntegrationsHealth");
    render(<IntegrationsHealth />);

    await waitFor(() => expect(screen.getByText("Ollama")).toBeInTheDocument());
    for (const name of ["Ollama", "Groq", "Cerebras", "OpenRouter", "Mistral"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    // Both healthy and unauthenticated statuses appear.
    expect(screen.getAllByText(/healthy|unauthenticated/i).length).toBeGreaterThan(0);
    // The effect must have loaded from the bridge.
    expect(bridge.integrations.list).toHaveBeenCalled();
  });

  it("shows a provider-config notice when keys are missing", async () => {
    const bridge = makeBridge();
    bridge.integrations.list.mockResolvedValue([
      {
        id: "env",
        label: "LLM Providers",
        description: "No cloud LLM key — running fully local via Ollama.",
        status: "healthy",
        lastSyncAt: null,
        category: "config",
      },
    ]);
    installBridge(bridge);

    const { ConfigNotice } = await import("../src/components/ConfigNotice");
    const { render } = await import("@testing-library/react");

    const { unmount } = render(<ConfigNotice />);
    // When healthy (or just informational), the notice does not render its blocking UI.
    await waitFor(() => expect(bridge.integrations.list).toHaveBeenCalled());
    expect(screen.queryByText(/No cloud LLM key/i)).not.toBeInTheDocument();
    unmount();

    bridge.integrations.list.mockResolvedValueOnce([
      {
        id: "env",
        label: "LLM Providers",
        description: "Some AI service keys are not configured.",
        status: "degraded",
        lastSyncAt: null,
        category: "config",
      },
    ]);
    installBridge(bridge);
    const { ConfigNotice: ConfigNotice2 } = await import("../src/components/ConfigNotice");
    render(<ConfigNotice2 />);
    await waitFor(() => expect(screen.getByText(/Some AI service keys/i)).toBeInTheDocument());
  });

  it("displays voice component status, including when the engine is unavailable", async () => {
    const bridge = makeBridge();
    bridge.profile.get.mockResolvedValue({
      activeHours: { start: 9, end: 22 },
      phrasingStyle: "concise",
      recurringCategories: [],
      learnedFacts: [],
      summary: "",
    });
    bridge.voice.getStatus.mockResolvedValue({
      state: "listening",
      enrolled: false,
      active: false,
      engineAvailable: false,
      speakerSimilarityThreshold: 0.85,
    });
    bridge.sync.getStatus.mockResolvedValue({
      paired: false,
      pairingCode: "123456",
      serverPort: 8765,
      connectedDevices: 0,
    });
    installBridge(bridge);

    const { ProfileSettings } = await import("../src/components/ProfileSettings");
    render(<ProfileSettings />);

    await waitFor(() => expect(screen.getByTestId("voice-engine-status")).toBeInTheDocument());
    expect(screen.getByTestId("voice-engine-status")).toHaveTextContent("state: listening");
    expect(screen.getByTestId("voice-engine-status")).toHaveTextContent("voice engine unavailable");
  });
});
