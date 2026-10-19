import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startMockLlm } from "./mock-llm";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const REPLY = "Hello from the mock model.";

async function launch(userData: string, ollamaUrl: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      LLM_PROVIDERS: "ollama",
      SPRYGEN_OLLAMA_URL: ollamaUrl,
      SPRYGEN_USER_DATA: userData,
      SPRYGEN_E2E: "1",
    },
  });
}

async function listTasks(page: Page): Promise<any[]> {
  return page.evaluate(async () => ((window as any).sprygen.tasks.list() as Promise<any[]>));
}

async function coreBackendStatus(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const bridge = (window as any).sprygen;
    if (!bridge) return "no-bridge";
    const rows = (await bridge.integrations.list()) as any[];
    const core = rows.find((r) => r.id === "core-backend");
    return core?.status ?? "missing";
  });
}

test("starts healthy, chats, creates exactly one task, and persists across restart", async () => {
  const mock = await startMockLlm(REPLY);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sprygen-e2e-"));

  let app = await launch(userData, mock.url);

  try {
    let page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    // The main process only creates the window after the Python sidecar is
    // healthy; assert it through the same health monitor the UI renders.
    await expect
      .poll(() => coreBackendStatus(page), { timeout: 90000 })
      .toBe("healthy");

    // Open the Configuration section (contains Task Board + Conversation).
    await page.getByTitle("Configuration").click();

    const chatInput = page.getByPlaceholder(/Ask SPRYGEN/);
    await chatInput.fill("hello there");
    await chatInput.press("Enter");

    await expect(page.getByTestId("chat-bubble-assistant").last()).toContainText(REPLY, {
      timeout: 60000,
    });
    expect(mock.requests).toBeGreaterThan(0);

    // Anchored fast-path: "todo: ..." must create exactly one task row.
    await chatInput.fill("todo: buy milk");
    await chatInput.press("Enter");

    await expect.poll(async () => (await listTasks(page)).length, { timeout: 60000 }).toBe(1);
    const tasks = await listTasks(page);
    expect(tasks[0].title).toBe("buy milk");

    // The board is refreshed by the tasks:update push event.
    await expect(page.getByText("buy milk", { exact: true })).toBeVisible({ timeout: 30000 });

    await app.close();

    // Restart and confirm SQLite persistence.
    app = await launch(userData, mock.url);
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect.poll(async () => (await listTasks(page)).length, { timeout: 60000 }).toBe(1);
    const persisted = await listTasks(page);
    expect(persisted[0].title).toBe("buy milk");
  } finally {
    await app.close().catch(() => {});
    await mock.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
