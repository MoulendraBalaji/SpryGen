Write-Host "=== PHASE 1–8 ACCEPTANCE ==="
$exitCode = 0

Write-Host "[1] Running typecheck..."
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL: typecheck"
  exit 1
}
Write-Host "PASS: typecheck"

Write-Host "[2] Running build..."
npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL: build"
  exit 1
}
Write-Host "PASS: build"

Write-Host "[3] Running pytest..."
python -m pytest backend/tests -q
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL: pytest"
  exit 1
}
Write-Host "PASS: pytest"

Write-Host "[4] Running vitest..."
npm run test
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL: vitest"
  exit 1
}
Write-Host "PASS: vitest"

Write-Host "[5] Running e2e..."
npm run test:e2e
if ($LASTEXITCODE -ne 0) {
  Write-Host "FAIL: e2e"
  exit 1
}
Write-Host "PASS: e2e"

Write-Host "=== ALL ACCEPTANCE CHECKS PASSED ==="
