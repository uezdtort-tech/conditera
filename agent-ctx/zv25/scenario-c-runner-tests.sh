#!/usr/bin/env bash
# Z-v25 Этап 2.3 — Сценарий C: сбой миграции + дубликат ID + legacy-runner fake-success.
# Probe-файлы создаются и удаляются внутри скрипта; рабочая БД не затрагивается.
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS — $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL — $1"; }

ADMIN="postgresql://postgres@127.0.0.1:54329/postgres"
bunq() { bun -e "import('pg').then(async({Client})=>{const c=new Client({connectionString:'$1'});await c.connect();$2 await c.end();}).catch(e=>{console.error('QERR:',e.message);process.exit(1)})"; }
mkins() { bunq "$ADMIN" "await c.query('DROP DATABASE IF EXISTS $1'); await c.query('CREATE DATABASE $1');"; }
# Леджер/таблицы целевой БД (не admin!)
qdb() { bunq "postgresql://postgres@127.0.0.1:54329/$1" "$2"; }

echo "── C1: SQL-ошибка в pending-миграции → ненулевой exit, леджер чист, откат ──"
mkins zv25_c_fail
cat > supabase/migrations/9999_zv25_c_fail_probe.sql <<'SQL'
-- Z-v25 disposable probe (удаляется автоматически)
CREATE TABLE public.zv25_c_probe (id int primary key);
SELECT * FROM public.zv25_no_such_table_zv25;
SQL
RC=0
DATABASE_URL="postgresql://postgres@127.0.0.1:54329/zv25_c_fail" bun scripts/db/setup.mjs > agent-ctx/zv25/c1.log 2>&1 || RC=$?
rm -f supabase/migrations/9999_zv25_c_fail_probe.sql
if [ "$RC" != "0" ] && grep -q "Migration failed\|Миграция не применена" agent-ctx/zv25/c1.log; then
  LED=$(qdb zv25_c_fail "const r=await c.query(\"SELECT count(*)::int AS n FROM schema_migrations WHERE filename LIKE '9999%'\").catch(()=>({rows:[{n:-1}]}));console.log(r.rows[0].n);")
  TBL=$(qdb zv25_c_fail "const r=await c.query(\"SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='zv25_c_probe'\").catch(()=>({rows:[{n:-1}]}));console.log(r.rows[0].n);")
  if [ "$LED" = "0" ]; then ok "C1 exit=$RC, леджер не содержит упавший файл"; else bad "C1 леджер содержит упавший файл: $LED"; fi
  if [ "$TBL" = "0" ]; then ok "C1 частичное состояние откачено (таблица probe отсутствует)"; else bad "C1 осталась частично применённая таблица: $TBL"; fi
  SEEDED=$(qdb zv25_c_fail "const r=await c.query(\"SELECT count(*)::int AS n FROM public.products\").catch(()=>({rows:[{n:-1}]}));console.log(r.rows[0].n);")
  LEDALL=$(qdb zv25_c_fail "const r=await c.query(\"SELECT count(*)::int AS n FROM schema_migrations\").catch(()=>({rows:[{n:-1}]}));console.log(r.rows[0].n);")
  if [ "$SEEDED" = "0" ] && grep -q "seeds пропущены" agent-ctx/zv25/c1.log && [ "$LEDALL" -gt "70" ]; then
    ok "C1 fail-fast корректен: сиды пропущены намеренно (products=0), применённых миграций в леджере: $LEDALL"
  else
    bad "C1 неожиданное состояние: products=$SEEDED, ledger=$LEDALL"; fi
else
  bad "C1 setup.mjs не отчитался об ошибке (rc=$RC)"; tail -5 agent-ctx/zv25/c1.log
fi

echo "── C2: после устранения причины повторный прогон завершается успешно ──"
RC2=0
DATABASE_URL="postgresql://postgres@127.0.0.1:54329/zv25_c_fail" bun scripts/db/setup.mjs > agent-ctx/zv25/c2.log 2>&1 || RC2=$?
if [ "$RC2" = "0" ]; then
  ok "C2 повторный прогон exit 0"
else
  bad "C2 повторный прогон упал (rc=$RC2)"; tail -5 agent-ctx/zv25/c2.log
fi

echo "── C3: дубликат migration ID → блокировка ДО SQL ──"
mkins zv25_c_dup
echo "-- Z-v25 dup probe (удаляется автоматически) --" > supabase/migrations/0063_zv25_dup_probe.sql
RC3=0
DATABASE_URL="postgresql://postgres@127.0.0.1:54329/zv25_c_dup" bun scripts/db/setup.mjs > agent-ctx/zv25/c3.log 2>&1 || RC3=$?
rm -f supabase/migrations/0063_zv25_dup_probe.sql
if [ "$RC3" != "0" ] && grep -q "ДУБЛИКАТ MIGRATION ID 0063" agent-ctx/zv25/c3.log; then
  LED3=$(qdb zv25_c_dup "const r=await c.query(\"SELECT count(*)::int AS n FROM schema_migrations\").catch(()=>({rows:[{n:-1}]}));console.log(r.rows[0].n);")
  if [ "$LED3" = "0" ]; then ok "C3 дубликат заблокирован до SQL (ledger пуст: $LED3, exit=$RC3)"; else bad "C3 ledger неожиданно заполнен: $LED3"; fi
else
  bad "C3 дубликат не заблокирован (rc=$RC3)"; tail -5 agent-ctx/zv25/c3.log
fi

echo "── C4: legacy apply-migrations.ts — эмпирическое доказательство fake-success ──"
mkdir -p /tmp/zv25_amts/supabase/migrations
cat > /tmp/zv25_amts/supabase/migrations/0001_zv25_bad.sql <<'SQL'
CREATE TABLE public.zv25_amts_probe (id int primary key);
SELECT * FROM public.zv25_no_such_table_zv25;
SQL
mkins zv25_c_amts
(cd /tmp/zv25_amts && DATABASE_URL="postgresql://postgres@127.0.0.1:54329/zv25_c_amts" bun /home/z/my-project/scripts/apply-migrations.ts > /home/z/my-project/agent-ctx/zv25/c4.log 2>&1)
RC4=$?
FAILLINE=$(grep -oE "[0-9]+ ok, [0-9]+ failed" agent-ctx/zv25/c4.log | head -1)
FAILEDN=$(echo "$FAILLINE" | grep -oE "[0-9]+ failed" | grep -oE "[0-9]+")
if [ "$RC4" = "0" ] && [ "${FAILEDN:-0}" != "0" ] && grep -q "All migrations applied successfully" agent-ctx/zv25/c4.log; then
  ok "C4 ПОДТВЕРЖДЕНО: legacy-раннер рапортует success (exit 0) при $FAILLINE — дефект реален"
else
  bad "C4 неожиданное поведение legacy-раннера (rc=$RC4, '$FAILLINE')"; tail -5 agent-ctx/zv25/c4.log
fi
rm -rf /tmp/zv25_amts

echo ""
echo "=== SCENARIO C SUMMARY: $PASS PASS, $FAIL FAIL ==="
exit $FAIL
