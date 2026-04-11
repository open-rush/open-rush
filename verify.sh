#!/bin/bash
set -euo pipefail

FAIL=0

echo "=== pnpm install ==="
pnpm install --frozen-lockfile || { echo "FAIL: pnpm install"; FAIL=1; }

echo ""
echo "=== pnpm build ==="
pnpm build || { echo "FAIL: pnpm build"; FAIL=1; }

echo ""
echo "=== pnpm check (typecheck) ==="
pnpm check || { echo "FAIL: pnpm check"; FAIL=1; }

echo ""
echo "=== pnpm lint ==="
pnpm lint || { echo "FAIL: pnpm lint"; FAIL=1; }

echo ""
echo "=== pnpm test ==="
pnpm test || { echo "FAIL: pnpm test"; FAIL=1; }

echo ""
if [ $FAIL -eq 0 ]; then
  echo "All checks passed."
else
  echo "Some checks FAILED."
  exit 1
fi
