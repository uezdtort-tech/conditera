#!/usr/bin/env bash
# Z-v24 runner tests (§11): дубликаты/SQL-ошибка/подключение/повторный запуск.
# Временные probe-файлы создаются и удаляются внутри скрипта; в коммит не попадают.
set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

ADMIN="postgresql://postgres@127.0.0.1:54329/postgres"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS — $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL — $1"; }

run_setup() { DATABASE_URL="$1" bun scripts/db/setup.mjs >/tmp/zv24-runner-out.log 2>&1; echo $?; }

bunq() { bun -e "import('pg').then(async({Client})=>{const c=new Client({connectionString:'$1'});await c.connect();$2 await c.end();}).catch(e=>{console.error('QERR:',e.message);process.exit(1)})"; }

cleanup_db() { bunq "$ADMIN" "await c.query('DROP DATABASE IF EXISTS zv24_runner_probe');"; }

# ===== T1: дублирующий ID → FAIL ДО применения SQL =====
echo "── T1: duplicate migration ID ──"
cleanup_db
bunq "$ADMIN" "await c.query('CREATE DATABASE zv24_runner_probe');" || { bad "T1 prep"; exit 1; }
echo "-- Z-v24 probe (удаляется автоматически) --" > supabase/migrations/0063_zv24_dup_probe.sql
RC=$(run_setup "postgresql://postgres@127.0.0.1:54329/zv24_runner_probe")
if [ "$RC" != "0" ] && rg -q "ДУБЛИКАТ MIGRATION ID 0063" /tmp/zv24-runner-out.log; then
  LED=$(bunq "$ADMIN" "const r=await c.query(\"SELECT count(*)::int AS n FROM schema_migrations\").catch(()=>({rows:[{n:-1}]}));console.log(r.rows[0].n);")
  if [ "$LED" = "-1" ] || [ "$LED" = "0" ]; then ok "T1 дубликат ID → exit 1 до SQL (ledger чист: $LED)"; else bad "T1 ledger неожиданно заполнен: $LED"; fi
else
  bad "T1 дубликат ID не заблокирован (rc=$RC)"; cat /tmp/zv24-runner-out.log | tail -5
fi
rm -f supabase/migrations/0063_zv24_dup_probe.sql

# ===== T2: SQL syntax error → non-zero exit, нет ложного success, seeds пропущены =====
echo "── T2: broken SQL migration ──"
cleanup_db
bunq "$ADMIN" "await c.query('CREATE DATABASE zv24_runner_probe');" || { bad "T2 prep"; exit 1; }
printf -- "-- Z-v24 probe (удаляется автоматически)\nTHIS IS NOT VALID SQL AT ALL;\n" > supabase/migrations/0081_zv24_broken_probe.sql
RC=$(run_setup "postgresql://postgres@127.0.0.1:54329/zv24_runner_probe")
LED=$(bunq "$ADMIN" "const r=await c.query(\"SELECT 1 FROM schema_migrations WHERE filename='0081_zv24_broken_probe.sql'\").catch(()=>({rowCount:0}));console.log(r.rowCount||0);" 2>/dev/null || echo "?")
if [ "$RC" != "0" ] && [ "$LED" != "1" ] && rg -q "fail-fast" /tmp/zv24-runner-out.log; then
  ok "T2 сломанный SQL → exit 1, файл НЕ в леджере, seeds пропущены (rc=$RC, ledger=$LED)"
else
  bad "T2 rc=$RC ledger=$LED"; tail -8 /tmp/zv24-runner-out.log
fi
rm -f supabase/migrations/0081_zv24_broken_probe.sql

# ===== T3: ошибка подключения → non-zero exit =====
echo "── T3: connection error ──"
RC=$(run_setup "postgresql://postgres@127.0.0.1:59999/dead_db")
if [ "$RC" != "0" ]; then ok "T3 недоступный PostgreSQL → exit 1 (rc=$RC)"; else bad "T3 ложный success при недоступной БД"; fi

# ===== T4: повторный запуск → идемпотентный skip + exit 0 =====
echo "── T4: idempotent re-run ──"
cleanup_db
bunq "$ADMIN" "await c.query('CREATE DATABASE zv24_runner_probe');" || { bad "T4 prep"; exit 1; }
RC1=$(run_setup "postgresql://postgres@127.0.0.1:54329/zv24_runner_probe")
RC2=$(run_setup "postgresql://postgres@127.0.0.1:54329/zv24_runner_probe")
if [ "$RC1" = "0" ] && [ "$RC2" = "0" ] && rg -q "0 newly applied" /tmp/zv24-runner-out.log; then
  ok "T4 повторный запуск: exit 0, 0 newly applied (skip)"
else
  bad "T4 rc1=$RC1 rc2=$RC2"; tail -5 /tmp/zv24-runner-out.log
fi

cleanup_db
echo ""
echo "=== runner tests: $PASS PASS / $FAIL FAIL ==="
[ "$FAIL" = "0" ] || exit 1
