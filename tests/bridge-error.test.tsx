import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { removeBridge } from "./helpers";

describe("bridge error screen", () => {
  afterEach(() => {
    removeBridge();
  });

  it("renders a blocking error screen when window.sprygen is missing", async () => {
    removeBridge();

    const { default: App } = await import("../src/App");
    render(<App />);

    expect(screen.getByTestId("bridge-error")).toBeInTheDocument();
    // No fake UI should be rendered; the normal shell/chat panel must not appear.
    expect(screen.queryByText(/conversation/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-bubble-assistant")).not.toBeInTheDocument();
  });

  it("does not emit fake data when bridge is missing (explicit guard)", async () => {
    removeBridge();

    const { default: App } = await import("../src/App");
    render(<App />);

    expect(screen.getByTestId("bridge-error")).toBeInTheDocument();
    // The error screen tells the user the bridge is missing — no silent fallback.
    expect(screen.getByText(/preload bridge.*missing/i)).toBeInTheDocument();
  });
});
