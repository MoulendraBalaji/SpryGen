import * as http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal OpenAI-compatible chat-completions server.
 *
 * The Python backend's Ollama provider talks the OpenAI `/chat/completions`
 * protocol, so pointing `SPRYGEN_OLLAMA_URL` at this server lets the whole app
 * run end-to-end with no API keys and no real model.
 */
export interface MockLlm {
  url: string;
  /** Number of chat-completion requests served. */
  readonly requests: number;
  close: () => Promise<void>;
}

export async function startMockLlm(reply = "Hello from the mock model."): Promise<MockLlm> {
  let count = 0;

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && (req.url || "").includes("/chat/completions")) {
      req.on("data", () => {
        /* drain */
      });
      req.on("end", () => {
        count += 1;
        const body = JSON.stringify({
          id: "chatcmpl-mock",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "mock-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: reply },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        });
        res.end(body);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return count;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
