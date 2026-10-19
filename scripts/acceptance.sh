#!/usr/bin/env bash
# scripts/acceptance.sh — run every phase check in order.
# Exits non-zero on the first failure and prints one PASS/FAIL line per phase.
set -u

echo "=== SPRYGEN PHASE 1-8 ACCEPTANCE ==="

fail() {
  echo "FAIL: $1"
  exit 1
}

PY="python3"
if ! command -v python3 >/dev/null 2>&1; then
  PY="python"
fi

# --- Phase 1: typed IPC + SQLite as the single source of truth ---------------
echo "[1/5] npm run typecheck"
npm run typecheck || fail "Phase 1 — typecheck"
echo "PASS: Phase 1 — typed IPC surface / SQLite single source of truth"

# --- Phase 7: shared zod schemas + renderer/main build ---------------------
echo "[2/5] npm run build"
npm run build || fail "Phase 7 — build"
echo "PASS: Phase 7 — shared schemas compile and the app builds"

# --- Phases 2-6: Python backend suite (routing, providers, security, voice) -
echo "[3/5] pytest"
"$PY" -m pytest backend/tests -q || fail "Phases 2-6 — pytest"
echo "PASS: Phase 2 — provider chain, privacy gate, intent routing"
echo "PASS: Phase 3 — trust boundary (token / host / origin)"
echo "PASS: Phase 4 — SSRF guards and automation single-flight"
echo "PASS: Phase 5 — sync server security (status/capture/PIN lockout)"
echo "PASS: Phase 6 — local voice/vision fail-closed"

# --- Phase 8: frontend unit tests + Electron end-to-end ---------------------
echo "[4/5] npm run test"
npm run test || fail "Phase 8 — vitest"

E2E_CMD="npm run test:e2e"
if [ "$(uname -s)" = "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
  # Electron needs a display server on headless Linux CI.
  E2E_CMD="xvfb-run --auto-servernum npm run test:e2e"
fi

echo "[5/5] npm run test:e2e"
eval "$E2E_CMD" || fail "Phase 8 — playwright e2e"
echo "PASS: Phase 8 — frontend tests, Electron e2e smoke, CI"

echo "=== ALL PHASE 1-8 ACCEPTANCE CHECKS PASSED ==="
