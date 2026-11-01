#!/bin/bash
# scripts/protected-paths.sh — защита защищённых путей от drift-удалений (инциденты #13/#14/#16/#17).
# Класс инцидента: процессы песочницы удаляют защищённые файлы (upload-роуты), а UUID-snapshotter
# контейнера фиксирует удаление коммитом (371e975, eadd7d3, cd85b3e) — или его захватывает amend (fa3ca7e).
# Три уровня защиты:
#   repair      — восстановить отсутствующие файлы из последнего коммита, где путь существовал
#                 (точечно, без reset/checkout) — вызывается ensure-dev.sh до старта сессии;
#   skip-on     — бит skip-worktree: git add -A снапшоттера больше НЕ индексирует удаления
#                 этих путей (первопричина — устранена);
#   hook-guard  — pre-commit предохранитель: если staged-deletion всё же попала в индекс,
#                 блоб подменяется из последнего хорошего коммита — коммит уходит БЕЗ удаления.
# Единый источник истины: MANDATORY_PATHS.
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

MANDATORY_PATHS=(
  "src/app/api/upload/route.ts"
  "src/app/api/upload/route.test.ts"
  "src/app/api/services/upload/route.ts"
  "src/app/api/services/upload/route.test.ts"
)

last_good_commit() {
  local p="$1" c
  for c in $(git rev-list HEAD -- "$p" 2>/dev/null | head -50); do
    if git cat-file -e "$c:$p" 2>/dev/null; then echo "$c"; return 0; fi
  done
  return 1
}

repair_one() {
  local p="$1"
  if [ -f "$p" ] && git ls-files --error-unmatch "$p" >/dev/null 2>&1; then return 0; fi
  local last; last="$(last_good_commit "$p" || true)"
  if [ -z "${last:-}" ]; then
    echo "[protected-paths] FATAL: '$p' отсутствует и не найден в истории HEAD" >&2
    return 1
  fi
  git update-index --no-skip-worktree -- "$p" 2>/dev/null || true
  git restore --source="$last" --staged --worktree -- "$p"
  echo "[protected-paths] REPAIR: '$p' восстановлен из ${last:0:12}"
}

cmd_repair() { local rc=0 p; for p in "${MANDATORY_PATHS[@]}"; do repair_one "$p" || rc=1; done; return $rc; }
cmd_skip_on() { local p; for p in "${MANDATORY_PATHS[@]}"; do git update-index --skip-worktree -- "$p"; done; }
cmd_skip_off() { local p; for p in "${MANDATORY_PATHS[@]}"; do git update-index --no-skip-worktree -- "$p"; done; }
cmd_status() { git ls-files -v -- "${MANDATORY_PATHS[@]}"; }

cmd_hook_guard() {
  local rc=0 p last
  for p in "${MANDATORY_PATHS[@]}"; do
    if git cat-file -e "HEAD:$p" 2>/dev/null && ! git cat-file -e ":$p" 2>/dev/null; then
      last="$(last_good_commit "$p" || true)"
      if [ -n "${last:-}" ]; then
        git update-index --no-skip-worktree -- "$p" 2>/dev/null || true
        git restore --source="$last" --staged --worktree -- "$p" 2>/dev/null || git checkout "$last" -- "$p" 2>/dev/null || true
        echo "[protected-paths] PRE-COMMIT: заблокировано удаление '$p' — блоб восстановлен из ${last:0:12}" >&2
      else
        echo "[protected-paths] PRE-COMMIT FATAL: '$p' — staged deletion, good-коммит не найден" >&2
        rc=1
      fi
    fi
  done
  return $rc
}

case "${1:-}" in
  repair) cmd_repair ;;
  skip-on) cmd_skip_on ;;
  skip-off) cmd_skip_off ;;
  status) cmd_status ;;
  hook-guard) cmd_hook_guard ;;
  *) echo "usage: protected-paths.sh {repair|skip-on|skip-off|status|hook-guard}" >&2; exit 2 ;;
esac
