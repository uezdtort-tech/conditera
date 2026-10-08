#!/usr/bin/env bash
# ============================================================================
# p0-pipeline.sh — безопасный сценарий P0 для ЖИВОЙ БД «Уездный кондитер».
#
# Строгий порядок: inspect → backup → apply → verify. Никаких слепых apply.
#
# Режимы:
#   ./scripts/ops/p0-pipeline.sh inspect   # только чтение: ledger + вердикт A/B/C
#   ./scripts/ops/p0-pipeline.sh backup    # pg_dump полный + схема-only
#   ./scripts/ops/p0-pipeline.sh apply     # backup обязателен; 0034–0037 канон + 0039–0060
#   ./scripts/ops/p0-pipeline.sh verify    # verify-money-path + p11
#   ./scripts/ops/p0-pipeline.sh all       # весь конвейер со STOP на каждом шаге
#
# ENV: DATABASE_URL (обязателен), RUNNER (npx tsx | bun, по умолчанию npx tsx)
# ЗАПРЕЩЕНО: заполнять пропуски 0038/0056, перенумеровывать, чинить ledger.
# ============================================================================
set -uo pipefail

DB_URL="${DATABASE_URL:-}"
RUNNER="${RUNNER:-npx tsx}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$REPO/download/p0-pipeline-$STAMP.log"
mkdir -p "$REPO/download"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
die() { log "STOP: $*"; exit 1; }

[ -n "$DB_URL" ] || die "DATABASE_URL не задан. Экспортируй: export DATABASE_URL=postgresql://..."
command -v psql >/dev/null || die "psql не найден"
command -v pg_dump >/dev/null || die "pg_dump не найден"

mask() { echo "$1" | sed -E 's#://[^:]+:[^@]+@#://***:***@#'; }
log "Цель: $(mask "$DB_URL")"

# ----------------------------------------------------------------------------
# МАРКЕРЫ: (миграция | маркер | SQL-EXISTS). Статика, без динамического SQL.
# ----------------------------------------------------------------------------
MARKERS_SQL=$(cat <<'EOSQL'
SELECT '0034' mig,'orders.payment_status' m, EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payment_status') ok
UNION ALL SELECT '0034','orders.tariff_snapshot',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='tariff_snapshot')
UNION ALL SELECT '0035','fn reserve_refund',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reserve_refund')
UNION ALL SELECT '0036','orders.payout_reserved_at',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payout_reserved_at')
UNION ALL SELECT '0036','fn add_confectioner_balance',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='add_confectioner_balance')
UNION ALL SELECT '0037','orders.payout_request_id',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payout_request_id')
UNION ALL SELECT '0037','fn release_escrow_order',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='release_escrow_order')
UNION ALL SELECT '0039','table yookassa_refund_events',EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='yookassa_refund_events')
UNION ALL SELECT '0039','fn apply_yookassa_refund',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='apply_yookassa_refund')
UNION ALL SELECT '0040','orders.delivery_time',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='delivery_time')
UNION ALL SELECT '0041','refunds.idempotency_key',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='refunds' AND column_name='idempotency_key')
UNION ALL SELECT '0042','idx_profiles_notify_prefs',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_profiles_notify_prefs')
UNION ALL SELECT '0043','fillings.category',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fillings' AND column_name='category')
UNION ALL SELECT '0044','idx_user_challenges_open',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_user_challenges_open')
UNION ALL SELECT '0045','fn add_bonus_balance',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='add_bonus_balance')
UNION ALL SELECT '0046','table inventory_movements',EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='inventory_movements')
UNION ALL SELECT '0047','idx_channels_support_ticket',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_channels_support_ticket')
UNION ALL SELECT '0048','fn apply_inventory_movement_atomic',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='apply_inventory_movement_atomic')
UNION ALL SELECT '0049','table inventory_write_offs',EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='inventory_write_offs')
UNION ALL SELECT '0050','idx_loyalty_tx_order_type',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_loyalty_tx_order_type')
UNION ALL SELECT '0051','idx_products_status_reviews',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_products_status_reviews')
UNION ALL SELECT '0052','table product_media',EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='product_media')
UNION ALL SELECT '0053','table domain_events',EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='domain_events')
UNION ALL SELECT '0054','table capacity_reservations',EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='capacity_reservations')
UNION ALL SELECT '0054','excl_capacity_reservations_overlap',EXISTS(SELECT 1 FROM pg_constraint WHERE conname='excl_capacity_reservations_overlap')
UNION ALL SELECT '0055','confectioners.business_scale',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='confectioners' AND column_name='business_scale')
UNION ALL SELECT '0057','idx_reviews_order',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_reviews_order')
UNION ALL SELECT '0058','uq_chat_channels_order_id',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_chat_channels_order_id')
UNION ALL SELECT '0059','notification_preferences.payment_updates',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_preferences' AND column_name='payment_updates')
UNION ALL SELECT '0060','uq_orders_idempotency',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_orders_idempotency')
UNION ALL SELECT '0060','uq_domain_events_dedup',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_domain_events_dedup')
UNION ALL SELECT '0060','uq_product_reviews_order',EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_product_reviews_order')
ORDER BY mig, m
EOSQL
)

WINDOW="0034 0035 0036 0037 0039 0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 0050 0051 0052 0053 0054 0055 0057 0058 0059 0060"

# ----------------------------------------------------------------------------
do_inspect() {
  log "─── ЭТАП 1: INSPECT (только чтение) ───"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT version();" >>"$LOG" 2>&1 || die "psql не подключился — проверь DATABASE_URL/сеть"

  log ""
  log "[Механизм миграций]"
  HAS_LEDGER=$(psql "$DB_URL" -Atc "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='supabase_migrations' AND table_name='schema_migrations');" 2>>"$LOG")
  if [ "$HAS_LEDGER" = "t" ]; then
    log "supabase_migrations.schema_migrations СУЩЕСТВУЕТ; последние версии:"
    psql "$DB_URL" -Atc "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15;" | tee -a "$LOG"
    log "ВНИМАНИЕ: CLI-ledger существует, но apply-движок репозитория в него НЕ пишет."
    log "Сверь этот список с маркерами ниже; расхождение = вердикт C."
  else
    log "supabase_migrations.schema_migrations ОТСУТСТВУЕТ — миграции ставились напрямую (psql/apply-движок), состояние определяется МАРКЕРАМИ."
  fi

  log ""
  log "[Критичные объекты money-path]"
  psql "$DB_URL" -At <<SQL | tee -a "$LOG"
SELECT 'orders: '            || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'products: '         || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='products') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'confectioners: '    || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='confectioners') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'payments: '         || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payments') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'refunds: '          || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='refunds') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'payout_requests: '  || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payout_requests') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'payouts: '          || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payouts') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'confectioner_transactions: ' || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='confectioner_transactions') THEN 'есть' ELSE 'НЕТ' END
UNION ALL SELECT 'domain_events: '    || CASE WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='domain_events') THEN 'есть' ELSE 'НЕТ' END;
SQL

  log ""
  log "[Identity-модель A и деньги]"
  psql "$DB_URL" -At <<SQL | tee -a "$LOG"
SELECT 'orders.confectioner_id тип: ' || data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='confectioner_id'
UNION ALL SELECT 'confectioners."userId" есть: ' || EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='confectioners' AND column_name='userId')::text
UNION ALL SELECT 'payments.amount тип: ' || data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name='amount'
UNION ALL SELECT 'CHECK payments_amount_positive: ' || EXISTS(SELECT 1 FROM pg_constraint WHERE conname='payments_amount_positive')::text;
SQL

  log ""
  log "[Маркеры окна 0034→0060]  (формат: миграция | маркер | t/f)"
  psql "$DB_URL" -At -F ' | ' -c "$MARKERS_SQL" | tee -a "$LOG"
}

# Статус каждого файла окна: FULL / MISSING / PARTIAL
marker_status() {
  psql "$DB_URL" -At -F'|' -c "$MARKERS_SQL" 2>>"$LOG" | awk -F'|' '
    { tot[$1]++; if ($3=="t") got[$1]++ }
    END { for (m in tot) { if (got[m]==tot[m]) print m" FULL"; else if (got[m]==0) print m" MISSING"; else print m" PARTIAL" } }' | sort
}

verdict() {
  log ""
  log "─── ВЕРДИКТ ───"
  local statuses; statuses=$(marker_status)
  echo "$statuses" | tee -a "$LOG"
  local partial missing_count total_applied
  partial=$(echo "$statuses" | rg -c "PARTIAL" || true)
  missing_count=$(echo "$statuses" | rg -c "MISSING" || true)
  total_applied=$(echo "$statuses" | rg -c "FULL" || true)

  if [ "${partial:-0}" -gt 0 ]; then
    log "ВЕРДИКТ C: есть PARTIAL-миграции (часть маркеров есть, часть нет) — схема расходится с файлами."
    log "STOP. Автоматическую починку НЕ выполнять. Прислать владельцу диагностику."
    return 2
  fi
  if [ "${missing_count:-0}" -eq 0 ]; then
    log "ВЕРДИКТ A: всё окно 0034→0060 уже применено. Apply не нужен. Переходи к verify."
    return 0
  fi
  # Контуральность: FULL обязаны быть строгим префиксом окна, MISSING — суффиксом.
  local seen_missing=0; local ok_shape=1
  for m in $WINDOW; do
    local st; st=$(echo "$statuses" | awk -v m="$m" '$1==m{print $2}')
    if [ "$st" = "FULL" ] && [ "$seen_missing" = "1" ]; then ok_shape=0; fi
    [ "$st" = "MISSING" ] && seen_missing=1
  done
  if [ "$ok_shape" = "1" ]; then
    log "ВЕРДИКТ B: применён строгий префикс окна, отсутствует суффикс ($missing_count миграций). Apply только отсутствующих, в порядке нумерации."
    return 1
  fi
  log "ВЕРДИКТ C: применённые миграции НЕ образуют префикс окна (дыры). STOP — прислать владельцу диагностику."
  return 2
}

# ----------------------------------------------------------------------------
do_backup() {
  log "─── ЭТАП 2: BACKUP ───"
  local full="$REPO/download/backup-before-money-path-$STAMP.sql"
  local schema="$REPO/download/backup-schema-$STAMP.sql"
  log "pg_dump (полный) → $full"
  if pg_dump "$DB_URL" --no-owner --no-privileges > "$full" 2>>"$LOG"; then
    log "pg_dump (схема-only) → $schema"
    pg_dump "$DB_URL" --schema-only --no-owner > "$schema" 2>>"$LOG" || { rm -f "$full"; die "schema dump упал (полный удалён, повтори backup целиком)"; }
    log "✅ Backup готов: $full ($(du -h "$full" | cut -f1))."
  else
    rm -f "$full"
    die "pg_dump УПАЛ. Apply ЗАПРЕЩЁН без backup. Разберись с доступом/диском и повтори."
  fi
}

# ----------------------------------------------------------------------------
do_apply() {
  log "─── ЭТАП 3: APPLY ───"
  local backups; backups=$(ls -1 "$REPO"/download/backup-before-money-path-*.sql 2>/dev/null | wc -l)
  [ "${backups:-0}" -gt 0 ] || die "Backup не найден в download/. Сначала: $0 backup"
  log "Backup присутствует ✓"

  verdict; local v=$?
  [ "$v" -eq 2 ] && die "Вердикт C — apply запрещён."
  [ "$v" -eq 0 ] && { log "Вердикт A — применять нечего."; return 0; }

  log ""
  log "Каноническое окно 0034–0037 (preflight + маркеры репозитория):"
  ( cd "$REPO" && DATABASE_URL="$DB_URL" $RUNNER scripts/ops-apply-money-path.ts ) >>"$LOG" 2>&1 \
    || die "ops-apply-money-path упал — смотри $LOG"
  log "0034–0037: OK"

  log ""
  log "Окно 0039–0060 (строгий порядок, маркеры на каждый файл):"
  ( cd "$REPO" && DATABASE_URL="$DB_URL" $RUNNER scripts/ops-apply-0039-0060.ts ) >>"$LOG" 2>&1 \
    || die "ops-apply-0039-0060 упал — смотри $LOG"
  log "0039–0060: OK"
  log ""
  log "Повторный inspect для подтверждения (все маркеры должны быть FULL):"
  marker_status | tee -a "$LOG"
  marker_status | rg -q "MISSING|PARTIAL" && die "После apply остались MISSING/PARTIAL — STOP."
  log "✅ APPLY завершён, окно 0034→0060 подтверждено маркерами."
}

# ----------------------------------------------------------------------------
do_verify() {
  log "─── ЭТАП 4: VERIFY ───"
  ( cd "$REPO" && DATABASE_URL="$DB_URL" $RUNNER scripts/verify-money-path.ts ) 2>&1 | tee -a "$LOG"
  local r1=${PIPESTATUS[0]}
  ( cd "$REPO" && PGURL="$DB_URL" node scripts/verify/p11-hardening-verify.mjs ) 2>&1 | tee -a "$LOG"
  local r2=${PIPESTATUS[0]}
  log "verify-money-path: $([ "$r1" = "0" ] && echo PASS || echo FAIL)"
  log "p11-hardening-verify: $([ "$r2" = "0" ] && echo PASS || echo FAIL)"
  [ "$r1" = "0" ] && [ "$r2" = "0" ] || die "Verify красный — деплой money-path ЗАПРЕЩЁН."
  log "✅ VERIFY зелёный."
}

# ----------------------------------------------------------------------------
case "${1:-}" in
  inspect) do_inspect ;;
  backup)  do_backup ;;
  apply)   do_apply ;;
  verify)  do_verify ;;
  all)
    do_inspect
    verdict; v=$?
    [ "$v" -eq 2 ] && die "Вердикт C — конвейер остановлен."
    if [ "$v" -eq 0 ]; then
      log "Вердикт A — apply пропущен."
    else
      do_backup || die "Backup не прошёл — STOP."
      do_apply
    fi
    do_verify
    ;;
  *) echo "Usage: $0 {inspect|backup|apply|verify|all}  (ENV: DATABASE_URL, RUNNER)"; exit 1 ;;
esac
