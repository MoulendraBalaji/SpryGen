import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180000,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    trace: "on-first-retry",
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },
});
