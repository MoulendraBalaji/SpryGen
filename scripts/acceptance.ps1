# scripts/acceptance.ps1 — run every phase check in order.
# Exits non-zero on the first failure and prints one PASS/FAIL line per phase.
$ErrorActionPreference = "Continue"

Write-Host "=== SPRYGEN PHASE 1-8 ACCEPTANCE ==="

function Fail($name) {
  Write-Host "FAIL: $name"
  exit 1
}

# --- Phase 1: typed IPC + SQLite as the single source of truth --------------
Write-Host "[1/5] npm run typecheck"
npm run typecheck
if ($LASTEXITCODE -ne 0) { Fail "Phase 1 - typecheck" }
Write-Host "PASS: Phase 1 - typed IPC surface / SQLite single source of truth"

# --- Phase 7: shared zod schemas + renderer/main build ----------------------
Write-Host "[2/5] npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Phase 7 - build" }
Write-Host "PASS: Phase 7 - shared schemas compile and the app builds"

# --- Phases 2-6: Python backend suite --------------------------------------
Write-Host "[3/5] pytest"
$py = "python"
python -m pytest backend/tests -q
if ($LASTEXITCODE -ne 0) { Fail "Phases 2-6 - pytest" }
Write-Host "PASS: Phase 2 - provider chain, privacy gate, intent routing"
Write-Host "PASS: Phase 3 - trust boundary (token / host / origin)"
Write-Host "PASS: Phase 4 - SSRF guards and automation single-flight"
Write-Host "PASS: Phase 5 - sync server security (status/capture/PIN lockout)"
Write-Host "PASS: Phase 6 - local voice/vision fail-closed"

# --- Phase 8: frontend unit tests + Electron end-to-end --------------------
Write-Host "[4/5] npm run test"
npm run test
if ($LASTEXITCODE -ne 0) { Fail "Phase 8 - vitest" }

Write-Host "[5/5] npm run test:e2e"
npm run test:e2e
if ($LASTEXITCODE -ne 0) { Fail "Phase 8 - playwright e2e" }
Write-Host "PASS: Phase 8 - frontend tests, Electron e2e smoke, CI"

Write-Host "=== ALL PHASE 1-8 ACCEPTANCE CHECKS PASSED ==="
