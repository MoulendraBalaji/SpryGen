#!/usr/bin/env bash
set -euo pipefail

# acceptance.sh - runs all phase checks in order
echo "=== PHASE 1–8 ACCEPTANCE ==="

# Typecheck
echo "[1] Running typecheck..."
if npx tsc --noEmit; then
  echo "PASS: typecheck"
else
  echo "FAIL: typecheck"; exit 1
fi

# Build
echo "[2] Running build..."
if npm run build; then
  echo "PASS: build"
else
  echo "FAIL: build"; exit 1
fi

# Python tests
echo "[3] Running pytest..."
if python -m pytest backend/tests -q; then
  echo "PASS: pytest"
else
  echo "FAIL: pytest"; exit 1
fi

# Frontend tests
echo "[4] Running vitest..."
if npm run test -- --run 2>/dev/null || npm run test; then
  echo "PASS: vitest"
else
  echo "FAIL: vitest"; exit 1
fi

# E2E tests
echo "[5] Running e2e..."
if npm run test:e2e 2>/dev/null; then
  echo "PASS: e2e"
else
  echo "FAIL: e2e"; exit 1
fi

echo "=== ALL ACCEPTANCE CHECKS PASSED ==="
