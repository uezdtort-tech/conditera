#!/bin/bash
# S4B3 curl-matrix (гейт 2). Урок S4B1/S4B2: curl ВСЕГДА -b jar -c jar вместе.
# Каждый чек печатает [PASS]/[FAIL]; финальный счёт PASS/FAIL.
set -u
BASE="http://127.0.0.1:3100"
JAR="/tmp/s4b3-jar-customer.txt"
JAR_ADMIN="/tmp/s4b3-jar-admin.txt"
JAR_CONF="/tmp/s4b3-jar-conf.txt"
JAR_ANON="/tmp/s4b3-jar-anon.txt"
CRON_SECRET=$(grep '^CRON_SECRET=' /home/z/my-project/conditera-v2/.env.local | cut -d= -f2)
PASS=0; FAIL=0

PROD1=$(node -e "
const { Client } = require('/home/z/my-project/conditera-v2/node_modules/pg');
const c = new Client({host:'127.0.0.1',port:54330,user:'postgres',database:'conditera'});
c.connect().then(()=>c.query(\"SELECT id FROM products WHERE slug='prod-demo-03'\")).then(r=>{console.log(r.rows[0].id);c.end()});
")

ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }

csrf() { # jar -> token
  curl -s -m 30 -b "$1" -c "$1" "$BASE/api/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"
}

req() { # jar method path data csrf_flag
  local jar="$1" method="$2" path="$3" data="${4:-}" use_csrf="${5:-no}"
  local args=(-s -m 60 -b "$jar" -c "$jar" -X "$method" -w '\n%{http_code}' "$BASE$path")
  [ -n "$data" ] && args+=(-H "Content-Type: application/json" -d "$data")
  [ "$use_csrf" = "csrf" ] && args+=(-H "X-CSRF-Token: $(csrf "$jar")")
  local out; out=$(curl "${args[@]}")
  printf '%s\n%s\n' "$(printf '%s' "$out" | tail -1)" "$(printf '%s' "$out" | sed '$d')"
}

check() { # name expected_status haystack status body
  local name="$1" expected="$2" haystack="$3" status="$4" body="$5"
  if [ "$status" = "$expected" ] && printf '%s' "$body" | grep -q "$haystack"; then
    ok "$name"
  else
    bad "$name" "status=$status body=$(printf '%s' "$body" | head -c 220)"
  fi
}

jget() { # json -> python expr
  printf '%s' "$1" | python3 -c "import sys,json;d=json.load(sys.stdin);print($2)"
}

dbq() { # sql -> rows
  node -e "
const { Client } = require('/home/z/my-project/conditera-v2/node_modules/pg');
const c = new Client({host:'127.0.0.1',port:54330,user:'postgres',database:'conditera'});
c.connect().then(()=>c.query(process.argv[1])).then(r=>{console.log(JSON.stringify(r.rows));c.end()});
" "$1"
}

TOMORROW=$(date -u -d "+1 day" +%F)
echo "=== 0. health ==="
out=$(req "$JAR_ANON" GET /api/health)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "health 200 database ok" 200 '"database":"ok"' "$status" "$body"

echo "=== 1. logins (customer/admin/confectioner) ==="
out=$(req "$JAR" POST /api/auth/login '{"email":"customer@demo.ru","password":"Demo123!"}')
check "login customer" 200 '"role":"CUSTOMER"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_ADMIN" POST /api/auth/login '{"email":"admin@demo.ru","password":"Demo123!"}')
check "login admin" 200 '"role":"ADMIN"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_CONF" POST /api/auth/login '{"email":"confectioner@demo.ru","password":"Demo123!"}')
check "login confectioner" 200 '"role":"CONFECTIONER"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 2. заказ №1 (без бонусов) → mock pay → CONFIRMED ==="
ORD_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\",\"email\":\"customer@demo.ru\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$TOMORROW\",\"slot\":\"10:00–13:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}]}"
out=$(req "$JAR" POST /api/orders "$ORD_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "order#1 created 201 PENDING" 201 '"status":"PENDING"' "$status" "$body"
ORDER1=$(jget "$body" "d['orderId']")
ORDER1_NUM=$(jget "$body" "d['number']")
echo "  order1=$ORDER1 ($ORDER1_NUM)"

out=$(req "$JAR" POST "/api/orders/$ORDER1/pay" '{}' csrf)
check "pay order#1 mock succeeded" 200 '"orderStatus":"CONFIRMED"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 3. БД: escrow held per confectioner + hold-проводка + snapshot ==="
ESCROW=$(dbq "SELECT e.id, e.\"heldAmount\", e.\"confectionerAmount\", e.\"commissionRate\", e.status, p.email FROM escrow_accounts e JOIN confectioner_profiles cp ON cp.id=e.\"confectionerId\" JOIN profiles p ON p.id=cp.\"userId\" WHERE e.\"orderId\"='$ORDER1'")
echo "  escrow: $ESCROW"
if printf '%s' "$ESCROW" | grep -q '"status":"held"' && printf '%s' "$ESCROW" | grep -q 'confectioner@demo.ru'; then
  ok "escrow held для confectioner@demo.ru"
else
  bad "escrow held" "$ESCROW"
fi
if printf '%s' "$ESCROW" | grep -q '"heldAmount":340000'; then
  ok "escrow heldAmount = 340000 (сумма группы)"
else
  bad "escrow heldAmount" "$ESCROW"
fi
HOLD=$(dbq "SELECT l.kind, l.amount, l.\"balanceAfter\", p.email FROM balance_ledger l JOIN profiles p ON p.id=l.\"userId\" WHERE l.\"refType\"='order' AND l.\"refId\"='$ORDER1' AND l.kind='hold'")
if printf '%s' "$HOLD" | grep -q '"amount":-340000' && printf '%s' "$HOLD" | grep -q 'confectioner@demo.ru'; then
  ok "hold-проводка −340000 у кондитера"
else
  bad "hold-проводка" "$HOLD"
fi
SNAP=$(dbq "SELECT \"commissionRateSnapshot\" FROM orders WHERE id='$ORDER1'")
if printf '%s' "$SNAP" | grep -q '"commissionRateSnapshot":10'; then
  ok "commissionRateSnapshot = 10 (№10)"
else
  bad "commissionRateSnapshot" "$SNAP"
fi

echo "=== 4. админ-переходы CONFIRMED→…→COMPLETED ==="
for TO in PREPARING READY IN_DELIVERY DELIVERED COMPLETED; do
  out=$(req "$JAR_ADMIN" POST "/api/admin/orders/$ORDER1/transition" "{\"to\":\"$TO\"}" csrf)
  status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
  check "transition → $TO" 200 "\"to\":\"$TO\"" "$status" "$body"
done

echo "=== 5. БД: escrow released + release +net + комиссия financial_ledger + бонус покупателю ==="
REL=$(dbq "SELECT e.status, e.\"platformAmount\", e.\"releasedAt\" IS NOT NULL AS rel FROM escrow_accounts e WHERE e.\"orderId\"='$ORDER1'")
if printf '%s' "$REL" | grep -q '"status":"released"' && printf '%s' "$REL" | grep -q '"platformAmount":34000'; then
  ok "escrow released, platformAmount (комиссия) = 34000"
else
  bad "escrow released" "$REL"
fi
RELEASE_LGR=$(dbq "SELECT l.amount, p.email FROM balance_ledger l JOIN profiles p ON p.id=l.\"userId\" WHERE l.kind='release' AND l.\"refType\"='order' AND l.\"refId\"='$ORDER1'")
if printf '%s' "$RELEASE_LGR" | grep -q '"amount":306000' && printf '%s' "$RELEASE_LGR" | grep -q 'confectioner@demo.ru'; then
  ok "release-проводка +306000 (net) кондитеру"
else
  bad "release-проводка" "$RELEASE_LGR"
fi
# S4B3-R3 фикс: financial_ledger колонки camelCase (entryType/idempotencyKey/orderId,
# без @map в Prisma) — snake_case здесь ловил 42703 column does not exist.
COMMISSION=$(dbq "SELECT \"entryType\", amount, \"idempotencyKey\" FROM financial_ledger WHERE \"orderId\"='$ORDER1' AND metadata->>'type'='commission'")
if printf '%s' "$COMMISSION" | grep -q '"amount":"340.00"'; then
  ok "комиссия в financial_ledger 340.00 ₽ (adjustment)"
else
  bad "комиссия financial_ledger" "$COMMISSION"
fi
BONUS=$(dbq "SELECT amount, p.email FROM balance_ledger l JOIN profiles p ON p.id=l.\"userId\" WHERE l.kind='bonus' AND l.\"refType\"='order' AND l.\"refId\"='$ORDER1' AND l.amount>0")
if printf '%s' "$BONUS" | grep -q '"amount":17000'; then
  ok "бонус начислен +17000 коп (5% от 340000)"
else
  bad "бонус начислен" "$BONUS"
fi

echo "=== 6. verify-ledger ==="
VOUT=$(cd /home/z/my-project/conditera-v2 && bun scripts/verify-ledger.ts 2>&1); VCODE=$?
VSUM=$(printf '%s' "$VOUT" | tail -1)
if [ "$VCODE" = "0" ]; then ok "verify-ledger exit 0 ($VSUM)"; else bad "verify-ledger" "$VSUM"; fi

echo "=== 7. заказ №2 со списанием бонусов ==="
# баланс покупателя после заказа#1: 1_000_000 − 340_000 + 17_000 = 677_000; cap 50% от 340000 = 170000 коп = 1700 баллов
out=$(req "$JAR" GET "/api/orders?page=1")
ORD2_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$TOMORROW\",\"slot\":\"10:00–13:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}],\"redeemBonusPoints\":1700}"
out=$(req "$JAR" POST /api/orders "$ORD2_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "order#2 with redeem 1700 → 201" 201 '"bonusPointsRedeemed":1700' "$status" "$body"
ORDER2=$(jget "$body" "d['orderId']")
O2_DISC=$(jget "$body" "d['discountTotal']")
O2_TOTAL=$(jget "$body" "d['total']")
if [ "$O2_DISC" = "170000" ] && [ "$O2_TOTAL" = "170000" ]; then
  ok "order#2: discountTotal=170000, total=170000 (340000−170000)"
else
  bad "order#2 суммы" "discount=$O2_DISC total=$O2_TOTAL"
fi
BONUS_MINUS=$(dbq "SELECT amount FROM balance_ledger WHERE kind='bonus' AND \"refType\"='order' AND \"refId\"='$ORDER2' AND amount<0")
if printf '%s' "$BONUS_MINUS" | grep -q '"amount":-170000'; then
  ok "проводка bonus −170000 при checkout"
else
  bad "проводка bonus −" "$BONUS_MINUS"
fi

echo "=== 8. валидация cap: 1701 балл → 400 ==="
ORD3_BODY="{\"contact\":{\"name\":\"Демо Покупатель\",\"phone\":\"+79001234567\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$TOMORROW\",\"slot\":\"10:00–13:00\"},\"items\":[{\"productId\":\"$PROD1\",\"quantity\":1}],\"redeemBonusPoints\":1701}"
out=$(req "$JAR" POST /api/orders "$ORD3_BODY" csrf)
check "order#3 redeem 1701 → 400 invalid_bonus_points" 400 'invalid_bonus_points' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 9. отмена order#2 → возврат бонусов +170000 ==="
out=$(req "$JAR_ADMIN" POST "/api/admin/orders/$ORDER2/transition" '{"to":"CANCELLED"}' csrf)
check "order#2 → CANCELLED" 200 '"to":"CANCELLED"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
BONUS_BACK=$(dbq "SELECT amount FROM balance_ledger WHERE kind='bonus' AND \"refType\"='order' AND \"refId\"='$ORDER2' AND amount>0")
if printf '%s' "$BONUS_BACK" | grep -q '"amount":170000'; then
  ok "возврат бонусов +170000 (один раз)"
else
  bad "возврат бонусов" "$BONUS_BACK"
fi
BONUS_BACK2=$(dbq "SELECT count(*)::int AS n FROM balance_ledger WHERE kind='bonus' AND \"refType\"='order' AND \"refId\"='$ORDER2' AND amount>0")
if printf '%s' "$BONUS_BACK2" | grep -q '"n":1'; then
  ok "возврат бонусов ровно один (guard)"
else
  bad "guard возврата" "$BONUS_BACK2"
fi

echo "=== 10. RBAC payouts ==="
out=$(req "$JAR" POST /api/payouts '{"amount":50000}' csrf)
check "customer POST /api/payouts → 403" 403 '' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_CONF" POST "/api/admin/payouts/00000000-0000-0000-0000-000000000000/approve" '{}' csrf)
check "confectioner admin-approve → 403" 403 '' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_ANON" POST /api/payouts '{"amount":50000}' csrf)
check "anon POST /api/payouts → 401" 401 '' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"

echo "=== 11. payout: request (кондитер) → pending + hold ==="
CONF_BAL_BEFORE=$(dbq "SELECT l.\"balanceAfter\" FROM balance_ledger l JOIN profiles p ON p.id=l.\"userId\" WHERE p.email='confectioner@demo.ru' ORDER BY l.\"createdAt\" DESC, l.id DESC LIMIT 1")
echo "  баланс кондитера до заявки: $CONF_BAL_BEFORE"
P1_BODY='{"amount":50000}'
out=$(req "$JAR_CONF" POST /api/payouts "$P1_BODY" csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "payout#1 request → 201 pending" 201 '"status":"pending"' "$status" "$body"
PAYOUT1=$(jget "$body" "d['id']")
PHOLD=$(dbq "SELECT l.kind, l.amount FROM balance_ledger l WHERE l.kind='hold' AND l.\"refType\"='payout-request' LIMIT 1")
if printf '%s' "$PHOLD" | grep -q '"amount":-50000'; then
  ok "hold-резерв −50000 при заявке"
else
  bad "hold-резерв" "$PHOLD"
fi

echo "=== 12. payout#1: approve → complete 403 tfa_required / tfa_invalid / dev-код ==="
out=$(req "$JAR_ADMIN" POST "/api/admin/payouts/$PAYOUT1/approve" '{}' csrf)
check "payout#1 approve" 200 '"status":"approved"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_ADMIN" POST "/api/admin/payouts/$PAYOUT1/complete" '{}' csrf)
check "complete без кода → 403 tfa_required" 403 'tfa_required' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_ADMIN" POST "/api/admin/payouts/$PAYOUT1/complete" '{"tfaCode":"000000"}' csrf)
check "complete неверный код → 403 tfa_invalid" 403 'tfa_invalid' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_ADMIN" POST "/api/admin/payouts/$PAYOUT1/complete" '{"tfaCode":"246810"}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "complete dev-код → 200 completed" 200 '"status":"completed"' "$status" "$body"
if printf '%s' "$body" | grep -q '"completedTfaAt"'; then
  ok "completedTfaAt записан"
else
  bad "completedTfaAt" "$body"
fi
PAY_LGR=$(dbq "SELECT l.kind, l.amount FROM balance_ledger l JOIN payouts p2 ON l.\"refType\"='payout' AND l.\"refId\"=p2.id::text WHERE p2.id='$PAYOUT1'")
if printf '%s' "$PAY_LGR" | grep -q '"amount":-50000'; then
  ok "проводка payout −50000 при завершении"
else
  bad "проводка payout" "$PAY_LGR"
fi
CONF_BAL_AFTER=$(dbq "SELECT l.\"balanceAfter\" FROM balance_ledger l JOIN profiles p ON p.id=l.\"userId\" WHERE p.email='confectioner@demo.ru' ORDER BY l.\"createdAt\" DESC, l.id DESC LIMIT 1")
echo "  баланс кондитера после выплаты: $CONF_BAL_AFTER"

echo "=== 13. payout#2: reject → деньги возвращены ==="
out=$(req "$JAR_CONF" POST /api/payouts '{"amount":60000}' csrf)
status=$(printf '%s' "$out" | head -1); body=$(printf '%s' "$out" | tail -n +2)
check "payout#2 request → 201 pending" 201 '"status":"pending"' "$status" "$body"
PAYOUT2=$(jget "$body" "d['id']")
out=$(req "$JAR_ADMIN" POST "/api/admin/payouts/$PAYOUT2/reject" '{"reason":"Гейт S4B3"}' csrf)
check "payout#2 reject → 200 rejected" 200 '"status":"rejected"' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
REJECT_BACK=$(dbq "SELECT l.amount FROM balance_ledger l WHERE l.kind='release' AND l.\"refType\"='payout-reject' LIMIT 1")
if printf '%s' "$REJECT_BACK" | grep -q '"amount":60000'; then
  ok "reject вернул резерв +60000"
else
  bad "reject возврат" "$REJECT_BACK"
fi

echo "=== 14. verify-ledger после всех движений ==="
VOUT=$(cd /home/z/my-project/conditera-v2 && bun scripts/verify-ledger.ts 2>&1); VCODE=$?
VSUM=$(printf '%s' "$VOUT" | tail -1)
if [ "$VCODE" = "0" ]; then ok "verify-ledger exit 0 ($VSUM)"; else bad "verify-ledger" "$VOUT"; fi

echo "=== 15. burst complete 6x → 429 + Retry-After ==="
# payout#3: request+approve, затем 6 вызовов complete (первый может пройти 200 —
# тогда повторные invalid_state 409; burst-гейт сработает на попытках в окне)
out=$(req "$JAR_CONF" POST /api/payouts '{"amount":50000}' csrf)
PAYOUT3=$(jget "$(printf '%s' "$out" | tail -n +2)" "d['id']")
req "$JAR_ADMIN" POST "/api/admin/payouts/$PAYOUT3/approve" '{}' csrf > /dev/null
GOT429=0; RETRY_AFTER=""
for i in 1 2 3 4 5 6; do
  out=$(curl -s -m 30 -b "$JAR_ADMIN" -c "$JAR_ADMIN" -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $(csrf "$JAR_ADMIN")" -w '\n%{http_code}\n%header{retry-after}' -d '{"tfaCode":"246810"}' "$BASE/api/admin/payouts/$PAYOUT3/complete")
  status=$(printf '%s' "$out" | sed -n 2p)
  RA=$(printf '%s' "$out" | sed -n 3p)
  if [ "$status" = "429" ]; then GOT429=1; RETRY_AFTER="$RA"; break; fi
done
if [ "$GOT429" = "1" ]; then
  ok "burst complete → 429 (Retry-After: ${RETRY_AFTER:-нет заголовка})"
else
  bad "burst complete 429" "за 6 попыток 429 не получен"
fi

echo "=== 16. cron-роуты: без секрета 403 / с секретом 200 ==="
out=$(req "$JAR_ANON" POST /api/cron/auto-complete)
check "cron/auto-complete без секрета → 403" 403 'forbidden' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(req "$JAR_ANON" POST /api/cron/expiring-bonuses)
check "cron/expiring-bonuses без секрета → 403" 403 'forbidden' "$(printf '%s' "$out" | head -1)" "$(printf '%s' "$out" | tail -n +2)"
out=$(curl -s -m 30 -X POST -w '\n%{http_code}' -H "X-Cron-Secret: $CRON_SECRET" "$BASE/api/cron/auto-complete")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "cron/auto-complete с секретом → 200" 200 '"completed"' "$status" "$body"
out=$(curl -s -m 30 -X POST -w '\n%{http_code}' -H "X-Cron-Secret: $CRON_SECRET" "$BASE/api/cron/expiring-bonuses")
status=$(printf '%s' "$out" | tail -1); body=$(printf '%s' "$out" | sed '$d')
check "cron/expiring-bonuses с секретом → 200" 200 '"expiredUsers"' "$status" "$body"

echo ""
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && echo "ALL GREEN" || echo "HAS FAILURES"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
