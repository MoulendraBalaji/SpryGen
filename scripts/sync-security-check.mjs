import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const tmpDir = await fs.mkdtemp(path.join(repoRoot, ".tmp-devsync-"));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = addr.port;
      s.close(() => resolve(p));
    });
  });
}

async function bundleDeviceSync() {
  const stubPath = path.join(tmpDir, "electron-stub.mjs");
  await fs.writeFile(
    stubPath,
    "import os from 'node:os';import path from 'node:path';export const app = { getPath: (p) => path.join(os.tmpdir(), 'sprygen-tests') };export default { app };\n"
  );
  const outPath = path.join(tmpDir, "deviceSync.test.cjs");
  await build({
    entryPoints: [path.join(repoRoot, "electron", "services", "deviceSync.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    outfile: outPath,
    external: ["better-sqlite3", "keytar"],
    alias: { electron: stubPath },
    sourcemap: false,
    logLevel: "silent",
  });
  return outPath;
}

function httpRequest(port, method, pathReq, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: pathReq, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let json = null;
        try {
          if (raw) json = JSON.parse(raw);
        } catch {}
        resolve({ status: res.statusCode || 0, headers: res.headers, json, raw });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const bundlePath = await bundleDeviceSync();
  const require = createRequire(import.meta.url);
  const { DeviceSyncService } = require(bundlePath);
  const port = await freePort();
  const svc = new DeviceSyncService();
  svc.port = port;
  svc.start();
  try {
    // GET /status
    let r = await httpRequest(port, "GET", "/status");
    if (r.status !== 200 || !r.json) throw new Error(`status bad: ${r.status}`);
    if ("pairingCode" in r.json && r.json.pairingCode) throw new Error("pairingCode leaked");
    if ("token" in r.json && r.json.token) throw new Error("token leaked");

    // POST /capture without device token
    r = await httpRequest(port, "POST", "/capture", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "000000" }),
    });
    if (r.status !== 401) throw new Error(`capture no token status ${r.status}`);

    // 6 wrong PINs -> lockout (via /pair)
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      r = await httpRequest(port, "POST", "/pair", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "000000" }),
      });
      lastStatus = r.status;
    }
    if (lastStatus !== 429) throw new Error(`6 wrong PINs expected lockout 429, got ${lastStatus}`);

    console.log("PASS: sync-server security");
  } finally {
    try { svc.stop(); } catch {}
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
  // Open keep-alive sockets can keep the event loop alive; this is a check
  // script, so exit explicitly once every assertion has passed.
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
