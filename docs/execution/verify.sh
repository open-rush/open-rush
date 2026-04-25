#!/bin/bash
# Unified verification script for managed-agents-p0-p1 tasks.
# Usage: ./docs/execution/verify.sh <task-id>

set -u
TASK="${1:-}"
if [ -z "$TASK" ]; then
  echo "Usage: $0 <task-id>"
  exit 1
fi

FAIL=0
fail() { echo "[FAIL] $*"; FAIL=1; }
ok()   { echo "[OK]   $*"; }
step() { echo ""; echo "=== $* ==="; }

cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"

# ==== 通用门禁(所有任务必过,对齐 AGENTS.md 铁律) ====

step "Build"
pnpm build 2>&1 | tail -40
[ ${PIPESTATUS[0]} -eq 0 ] && ok "build" || fail "build"

step "Check (type-check via turbo)"
pnpm check 2>&1 | tail -40
[ ${PIPESTATUS[0]} -eq 0 ] && ok "check" || fail "check"

step "Lint"
pnpm lint 2>&1 | tail -40
[ ${PIPESTATUS[0]} -eq 0 ] && ok "lint" || fail "lint"

step "Test"
pnpm test 2>&1 | tail -60
[ ${PIPESTATUS[0]} -eq 0 ] && ok "test" || fail "test"

step "Protected files check"
PROTECTED=(
  ".claude/plans/managed-agents-p0-p1.md"
  "docs/execution/TASKS.md"
  "docs/execution/verify.sh"
)
# task-17 may modify TASKS.md checkbox only (handled below);
# PLAN.md is immutable for agents(改动方案要重跑 Sparring → 人工触发 ).
for f in "${PROTECTED[@]}"; do
  if git diff origin/main -- "$f" 2>/dev/null | grep -q "^[+-][^+-]"; then
    # TASKS.md checkbox 改动允许
    if [ "$f" = "docs/execution/TASKS.md" ]; then
      # allow only `- [ ]` <-> `- [x]` flips
      if git diff origin/main -- "$f" | grep -E "^[+-]" | grep -vE "^(\+\+\+|---|[+-]- \[[ x]\])" | grep -q "^[+-]"; then
        fail "TASKS.md 修改了 checkbox 之外的内容(可能是改动任务描述,请与方案保持一致)"
      else
        ok "TASKS.md 仅 checkbox 变动"
      fi
    else
      fail "$f 受保护,不允许修改(方案变更请通过人工流程)"
    fi
  fi
done

# ==== 任务专属验证 ====

step "Task-specific checks: $TASK"
case "$TASK" in
  task-1)
    pnpm --filter @openrush/db test -- agent-definition-versions 2>&1 | tail -30 \
      && ok "db agent-definition-versions tests" \
      || fail "db agent-definition-versions tests"
    ;;
  task-2)
    pnpm --filter @openrush/db test -- service-tokens 2>&1 | tail -30 \
      && ok "db service-tokens tests" \
      || fail "db service-tokens tests"
    ;;
  task-3)
    pnpm --filter @openrush/db test -- runs 2>&1 | tail -30 \
      && ok "db runs tests" \
      || fail "db runs tests"
    ;;
  task-4)
    pnpm --filter @openrush/contracts test 2>&1 | tail -40 \
      && ok "contracts v1 tests" \
      || fail "contracts v1 tests"
    ;;
  task-5)
    pnpm --filter @openrush/web test -- unified-auth 2>&1 | tail -30 \
      && ok "unified-auth tests" \
      || fail "unified-auth tests"
    ;;
  task-6|task-8|task-9|task-12|task-13|task-14)
    pnpm --filter @openrush/web test -- "api/v1" 2>&1 | tail -40 \
      && ok "v1 api tests" \
      || fail "v1 api tests"
    ;;
  task-7|task-11)
    pnpm --filter @openrush/control-plane test 2>&1 | tail -40 \
      && ok "control-plane tests" \
      || fail "control-plane tests"
    ;;
  task-10)
    pnpm --filter @openrush/agent-worker test 2>&1 | tail -40 \
      && ok "agent-worker tests" \
      || fail "agent-worker tests"
    ;;
  task-15)
    if [ -f scripts/validate-openapi.ts ]; then
      pnpm tsx scripts/validate-openapi.ts 2>&1 | tail -20 \
        && ok "openapi spec valid" \
        || fail "openapi spec invalid"
    else
      fail "scripts/validate-openapi.ts missing"
    fi
    ;;
  task-16)
    pnpm --filter @open-rush/sdk test 2>&1 | tail -30 \
      && ok "sdk tests" \
      || fail "sdk tests"
    pnpm --filter @open-rush/sdk build 2>&1 | tail -20 \
      && ok "sdk build" \
      || fail "sdk build"
    ;;
  task-17)
    # README/docs changes — check links and presence
    test -f README.md && ok "README exists" || fail "README missing"
    test -f docs/quickstart.md && ok "quickstart exists" || fail "quickstart missing"
    test -f docs/api.md && ok "api.md exists" || fail "api.md missing"
    ;;
  task-18)
    if [ ! -f apps/web/e2e/v1-api.spec.ts ]; then
      fail "apps/web/e2e/v1-api.spec.ts missing"
    else
      ok "e2e spec exists"
      # 跑 E2E(需要 postgres + redis 容器就绪,见 AGENTS.md)
      step "Running E2E (task-18 gate)"
      pnpm --filter @openrush/web test:e2e -- v1-api 2>&1 | tail -60 \
        && ok "e2e v1-api passes (6 scenarios)" \
        || fail "e2e v1-api failed - 必须覆盖 specs/managed-agents-api.md §E2E 6 场景"
    fi
    ;;
  task-19)
    # 前端迁移 + legacy 清理
    # 1. /api/v1/ 下关键 endpoint 必须存在
    for p in "auth/tokens" "agent-definitions" "agents" "vaults/entries"; do
      if [ ! -d "apps/web/app/api/v1/$p" ]; then
        fail "/api/v1/$p 目录不存在"
      fi
    done

    # 2. legacy routes 必须完全删除(按 PLAN §8 task-19 完整清单)
    # 允许保留: /api/auth/*, /api/health, 以及 UI 专属(install/star/members/generate-title)
    LEGACY_TO_REMOVE=(
      "apps/web/app/api/tasks"
      "apps/web/app/api/runs"
      "apps/web/app/api/chat/route.ts"
      "apps/web/app/api/chat/start"
      "apps/web/app/api/chat/abort"
      "apps/web/app/api/conversations"
      "apps/web/app/api/agents/route.ts"
      "apps/web/app/api/agents/[id]/route.ts"
      "apps/web/app/api/skills/route.ts"
      "apps/web/app/api/skills/[id]/route.ts"
      "apps/web/app/api/skills/upload"
      "apps/web/app/api/mcps/route.ts"
      "apps/web/app/api/mcps/[id]/route.ts"
      "apps/web/app/api/projects/route.ts"
      "apps/web/app/api/projects/[id]/route.ts"
      "apps/web/app/api/projects/[id]/vault"
    )
    for p in "${LEGACY_TO_REMOVE[@]}"; do
      if [ -e "$p" ]; then
        fail "legacy 仍存在: $p(应在 task-19 删除,见 .claude/plans/managed-agents-p0-p1.md §8 task-19)"
      fi
    done

    # 3. 保留清单存在性检查
    KEEP=(
      "apps/web/app/api/auth"
      "apps/web/app/api/health"
    )
    for p in "${KEEP[@]}"; do
      if [ ! -e "$p" ]; then
        fail "应保留但缺失: $p"
      fi
    done

    # 4. 前端 fetch('/api/...') 不应再指向已删 legacy
    # 简单检查:grep 前端源码
    LEGACY_FETCH=$(grep -rnE "fetch\(['\"]/api/(tasks|runs|chat|conversations)" apps/web/app apps/web/components 2>/dev/null | grep -v "/api/v1/" || true)
    if [ -n "$LEGACY_FETCH" ]; then
      fail "前端仍有 legacy fetch:
$LEGACY_FETCH"
    else
      ok "前端无 legacy fetch"
    fi
    ;;
  *)
    echo "[WARN] 未为 $TASK 定义专属检查,仅通用门禁"
    ;;
esac

# ==== 通用 Sparring 提醒 ====

step "Sparring reminder"
echo "本地 verify 通过后,必须跑 Sparring code review(APPROVE 才 commit)。"
echo "执行:"
echo "  diff_content=\$(git diff origin/main)"
echo "  HTTP_PROXY= HTTPS_PROXY= agent --print --trust --model gpt-5.3-codex-xhigh \\"
echo "    \"Review the following diff for task $TASK ...\""

step "Result"
if [ $FAIL -eq 0 ]; then
  echo "[PASS] $TASK"
  exit 0
else
  echo "[FAIL] $TASK(见上)"
  exit 1
fi
