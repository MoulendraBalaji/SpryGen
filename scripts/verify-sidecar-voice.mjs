/**
 * Verify that a built (frozen) sidecar actually ships the core voice stack.
 *
 * Regression guard for the packaged-app ENGINE_FAILURE bug: CI installs only
 * `requirements.txt` before PyInstaller, so without an explicit install of
 * `requirements-voice-core.txt` the released app reported every voice component
 * as missing and the mic toggle always failed.
 *
 * Usage:
 *   node scripts/verify-sidecar-voice.mjs [path/to/sprygen-backend]
 *
 * Exits 0 when capture + wake + stt are importable inside the frozen binary,
 * 1 otherwise (so the release job fails instead of shipping a voice-less app).
 * speaker/tts are optional here: they pull PyTorch and are intentionally not
 * part of packaged builds (text-to-speech falls back to the OS synthesiser).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const REQUIRED = ["capture", "wake", "stt"];
const OPTIONAL = ["numpy", "speaker", "tts"];
const TOKEN = "verify-sidecar-token";

function resolveBinary() {
  const base = process.argv[2] ?? "backend/dist/sprygen-backend";
  const candidates = [base, `${base}.exe`];
  for (const candidate of candidates) {
    // Absolute path: the child is spawned with cwd set to the binary's folder,
    // which would break a relative reference.
    if (existsSync(candidate)) return path.resolve(candidate);
  }
  console.error(`verify-sidecar-voice: binary not found (tried ${candidates.join(", ")})`);
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const binary = resolveBinary();
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

console.log(`verify-sidecar-voice: starting ${binary} on ${port}`);
const child = spawn(binary, [], {
  cwd: path.dirname(binary),
  env: {
    ...process.env,
    SPRYGEN_HOST: "127.0.0.1",
    SPRYGEN_PORT: String(port),
    SPRYGEN_TOKEN: TOKEN,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.stdout.write(`[sidecar] ${d}`));
child.stderr.on("data", (d) => process.stderr.write(`[sidecar] ${d}`));
child.on("error", (err) => {
  console.error(`verify-sidecar-voice: FAIL — could not spawn sidecar: ${err.message}`);
  process.exit(1);
});

let exitCode = 1;
try {
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const deadline = Date.now() + 90_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`sidecar exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`, { headers });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  if (!ready) throw new Error("sidecar did not become healthy within 90s");

  const res = await fetch(`${baseUrl}/api/voice/status`, { headers });
  if (!res.ok) throw new Error(`/api/voice/status returned HTTP ${res.status}`);
  const status = await res.json();
  const components = status?.components ?? {};

  console.log("verify-sidecar-voice: components", JSON.stringify(status));
  const missing = REQUIRED.filter((name) => components[name] !== true);
  const missingOptional = OPTIONAL.filter((name) => components[name] !== true);

  if (missing.length === 0) {
    console.log(
      `verify-sidecar-voice: PASS — bundled core voice stack present (${REQUIRED.join(", ")})`
    );
    if (missingOptional.length) {
      console.log(
        `verify-sidecar-voice: note — optional components not bundled: ${missingOptional.join(", ")}`
      );
    }
    exitCode = 0;
  } else {
    console.error(
      `verify-sidecar-voice: FAIL — frozen sidecar is missing required voice components: ${missing.join(
        ", "
      )}\n  Install them in the build environment:\n    pip install -r backend/requirements-voice-core.txt`
    );
  }
} catch (err) {
  console.error(`verify-sidecar-voice: FAIL — ${err instanceof Error ? err.message : err}`);
} finally {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  await sleep(300);
  if (child.exitCode === null && typeof child.pid === "number") {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  // The sidecar keeps event-loop handles open; exit explicitly.
  await sleep(200);
  process.exit(exitCode);
}
