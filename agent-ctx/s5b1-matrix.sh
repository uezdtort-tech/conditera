#!/usr/bin/env bash
# =============================================================================
# /home/z/my-project/agent-ctx/s5b1-matrix.sh — S5B1 curl-matrix (гейт 2).
#
# Все curl — с cookie-jar (-b jar -c jar). Секреты не печатаются: DATABASE_URL
# читается tmp-dbcheck.ts из .env.local молча; логины demo (customer/admin/
# demo2@demo.ru, Demo123!) — публичные демо-креды спеки.
#
# Сценарий: anon-редиректы → login customer → /account 200 + статистика →
# ?status= фильтр (только PENDING; мусор → 400) → создание заказа →
# foreign confirm (demo2) → 404 → owner confirm не-DELIVERED → 409 →
# pay (mock) → CONFIRMED → admin-переходы до DELIVERED → customer confirm →
# 200 + db: эскроу released + бонус начислен + OrderEvent actor CUSTOMER →
# verify-ledger OK → cancel неоплаченного → CANCELLED → cancel с бонусами →
# возврат бонусов в журнале → cancel оплаченного CONFIRMED → 409
# paid_contact_support → favorites (add×2, idempotent, delete, anon 401) →
# profile PATCH (без CSRF 403 / с 200 + db) → password (wrong 400 / ok 200 /
# re-login / ОТКАТ к Demo123!) → addresses CRUD + isDefault exclusive +
# 11-й → 400 limit → rate-burst confirm → 429 + Retry-After.
# =============================================================================
set -u
BASE="http://localhost:3100"
PROJ="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0

ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
assert_eq() { local label="$1" got="$2" want="$3"; if [ "$got" = "$want" ]; then ok "$label ($got)"; else bad "$label — got [$got], want [$want]"; fi; }
assert_has() { local label="$1" hay="$2" needle="$3"; case "$hay" in *"$needle"*) ok "$label";; *) bad "$label — не найдено [$needle] в [$hay]";; esac; }

# --- csrf helper: fresh one-time token (jar как носитель cd_csrf) -------------
csrf_token() { curl -s -b "$1" -c "$1" "$BASE/api/csrf" | jq -r '.token // empty'; }
# --- mutation helper: POST с свежим CSRF --------------------------------------
csrf_post() { # $1=jar $2=url $3=body [$4=method] -> "<code>|<body>"
  local jar="$1" url="$2" body="$3" method="${4:-POST}"
  local token; token=$(csrf_token "$jar")
  local res
  res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$jar" -c "$jar" \
        -X "$method" -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
        -d "$body" "$BASE$url")
  printf '%s' "$res"
}
split_res() { RES_CODE=$(printf '%s' "$1" | tail -1); RES_BODY=$(printf '%s' "$1" | sed '$d'); }

# --- db-check helper (Prisma; .env.local молча) -------------------------------
dbcheck() {
  (cd "$PROJ" && bun scripts/tmp-dbcheck.ts "$@" 2>/dev/null)
}

# --- dev-server lift (если умер между вызовами) -------------------------------
if ! curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then
  echo "… dev :3100 не отвечает — поднимаем"
  for pid in $(lsof -ti tcp:3100 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  sleep 1; rm -f "$PROJ/.next/dev/lock"
  (cd "$PROJ" && env -u DATABASE_URL nohup bun run dev > /tmp/dev-v2.log 2>&1 &)
  for i in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then echo "… health OK (${i}s)"; break; fi
    sleep 1
  done
fi

# --- tmp-dbcheck.ts (prisma; создаем если нет) --------------------------------
cat > "$PROJ/scripts/tmp-dbcheck.ts" <<'DBEOF'
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function readDbUrl(): string {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url: readDbUrl() } } });
const c = process.argv[2] ?? "";
const a3 = process.argv[3] ?? "";
const a4 = process.argv[4] ?? "";
try {
  if (c === "order") {
    const o = await prisma.order.findUnique({ where: { id: a3 }, select: { status: true, paymentStatus: true, number: true, total: true, bonusPointsRedeemed: true } });
    console.log(JSON.stringify(o ?? {}));
  } else if (c === "escrow") {
    const rows = await prisma.escrow.findMany({ where: { orderId: a3 }, select: { status: true } });
    console.log(JSON.stringify({ total: rows.length, released: rows.filter((r) => r.status === "released").length, held: rows.filter((r) => r.status === "held").length }));
  } else if (c === "bonusaccrued") {
    const n = await prisma.balanceLedger.count({ where: { refId: a3, kind: "bonus", amount: { gt: 0 }, description: { not: { startsWith: "Возврат" } } } });
    console.log(JSON.stringify({ accrued: n }));
  } else if (c === "bonusreturned") {
    const n = await prisma.balanceLedger.count({ where: { refId: a3, kind: "bonus", amount: { gt: 0 }, description: { startsWith: "Возврат бонусных баллов" } } });
    console.log(JSON.stringify({ returned: n }));
  } else if (c === "event") {
    const e = await prisma.orderEvent.findFirst({ where: { orderId: a3, from: a4 as never, to: process.argv[5] as never }, orderBy: { createdAt: "desc" }, select: { actorRole: true, meta: true } });
    console.log(JSON.stringify(e ?? {}));
  } else if (c === "balance") {
    const last = await prisma.balanceLedger.findFirst({ where: { user: { email: a3 } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { balanceAfter: true } });
    console.log(JSON.stringify({ balanceAfter: last?.balanceAfter ?? 0 }));
  } else if (c === "wishlist") {
    const n = await prisma.wishlistItem.count({ where: { user: { email: a3 } } });
    const dup = await prisma.wishlistItem.count({ where: { user: { email: a3 }, productId: a4 } });
    console.log(JSON.stringify({ count: n, dupOfArg: dup }));
  } else if (c === "profile") {
    const p = await prisma.profile.findUnique({ where: { email: a3 }, select: { name: true, phone: true, city: true } });
    console.log(JSON.stringify(p ?? {}));
  } else if (c === "addresses") {
    const n = await prisma.address.count({ where: { user: { email: a3 } } });
    const d = await prisma.address.count({ where: { user: { email: a3 }, isDefault: true } });
    console.log(JSON.stringify({ count: n, defaults: d }));
  } else if (c === "products2") {
    const rows = await prisma.product.findMany({ where: { isAvailable: true, confectioner: { businessName: "Пекарня «Уездный кондитер»" } }, select: { id: true, price: true }, take: 2, orderBy: { price: "asc" } });
    console.log(JSON.stringify(rows));
  } else {
    console.log(JSON.stringify({ error: "unknown case" }));
  }
} finally {
  await prisma.$disconnect();
}
DBEOF

echo "=== [A] Аноним: все 5 страниц /account → 307 /cart?auth=1 ==="
for p in /account /account/orders /account/favorites /account/balance /account/profile; do
  out=$(curl -s -o /dev/null --max-time 60 -w "%{http_code} %{redirect_url}" "$BASE$p")
  code=${out%% *}; loc=${out#* }
  assert_eq "anon $p" "$code" "307"
  case "$loc" in */cart?auth=1*) ok "anon $p → $loc";; *) bad "anon $p redirect → [$loc]";; esac
done

echo "=== [B] Login customer → /account 200 + реальные статистики ==="
J1=/tmp/s5b1-j1.txt; rm -f "$J1"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J1" -c "$J1" -X POST -H "Content-Type: application/json" \
      -d '{"email":"customer@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login customer" "$RES_CODE" "200"
acct=$(curl -s --max-time 60 -b "$J1" -c "$J1" "$BASE/account")
assert_eq "GET /account" "$(curl -s -o /dev/null --max-time 60 -w '%{http_code}' -b "$J1" -c "$J1" "$BASE/account")" "200"
assert_has "/account: карточка «Заказы всего»" "$acct" "Заказы всего"
assert_has "/account: карточка «Бонусный баланс»" "$acct" "Бонусный баланс"
assert_has "/account: карточка «Сумма покупок»" "$acct" "Сумма покупок"

echo "=== [C] GET /api/orders?status= — только PENDING; мусор → 400 ==="
res=$(curl -s --max-time 60 -b "$J1" "$BASE/api/orders?status=PENDING")
pending_only=$(printf '%s' "$res" | jq '[.orders[].status] | all(. == "PENDING")' 2>/dev/null)
assert_eq "?status=PENDING — все строки PENDING" "$pending_only" "true"
res=$(curl -s -o /dev/null --max-time 60 -w "%{http_code}" -b "$J1" "$BASE/api/orders?status=WAT")
assert_eq "?status=WAT" "$res" "400"

echo "=== [D] Создание заказа (customer) ==="
tomorrow=$(date -u -d "+1 day" +%F 2>/dev/null || date -u +%F)
P2=$(dbcheck products2); PID1=$(printf '%s' "$P2" | jq -r '.[0].id'); PID2=$(printf '%s' "$P2" | jq -r '.[1].id')
echo "… products: $PID1, $PID2"
res=$(csrf_post "$J1" "/api/orders" "{\"items\":[{\"productId\":\"$PID1\",\"quantity\":1}],\"contact\":{\"name\":\"Демо-покупатель\",\"phone\":\"+7 (900) 000-00-00\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Тула, ул. Металлургов, д. 12\",\"date\":\"$tomorrow\",\"slot\":\"10:00–13:00\"}}")
split_res "$res"
assert_eq "POST /api/orders" "$RES_CODE" "201"
ORDER1=$(printf '%s' "$RES_BODY" | jq -r '.orderId // empty')
echo "… order1=$ORDER1 number=$(printf '%s' "$RES_BODY" | jq -r '.number')"

echo "=== [E] Foreign confirm (demo2) → 404 ==="
J2=/tmp/s5b1-j2.txt; rm -f "$J2"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J2" -c "$J2" -X POST -H "Content-Type: application/json" \
      -d '{"email":"demo2@demo.ru","password":"Demo123!","role":"CUSTOMER","displayName":"Демо-покупатель 2"}' "$BASE/api/auth/register")
split_res "$res"
if [ "$RES_CODE" != "201" ]; then
  res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$J2" -c "$J2" -X POST -H "Content-Type: application/json" \
        -d '{"email":"demo2@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
  split_res "$res"
fi
assert_eq "demo2 auth" "$RES_CODE" "200"
res=$(csrf_post "$J2" "/api/orders/$ORDER1/confirm" "{}")
split_res "$res"
assert_eq "foreign confirm" "$RES_CODE" "404"
assert_has "foreign confirm body" "$RES_BODY" '"error":"not_found"'

echo "=== [F] Owner confirm не-DELIVERED (PENDING) → 409 ==="
res=$(csrf_post "$J1" "/api/orders/$ORDER1/confirm" "{}")
split_res "$res"
assert_eq "owner confirm PENDING" "$RES_CODE" "409"
assert_has "owner confirm body" "$RES_BODY" '"error":"invalid_state"'

echo "=== [G] Pay (mock) → CONFIRMED ==="
res=$(csrf_post "$J1" "/api/orders/$ORDER1/pay" "{}")
split_res "$res"
assert_eq "pay" "$RES_CODE" "200"
assert_has "pay body" "$RES_BODY" '"orderStatus":"CONFIRMED"'
db=$(dbcheck order "$ORDER1")
assert_eq "db order1 status" "$(printf '%s' "$db" | jq -r '.status')" "CONFIRMED"
escrow_before=$(dbcheck escrow "$ORDER1")
assert_eq "db эскроу held после CONFIRMED" "$(printf '%s' "$escrow_before" | jq -r '.held')" "$(printf '%s' "$escrow_before" | jq -r '.total')"

echo "=== [H] Admin-переходы до DELIVERED ==="
JA=/tmp/s5b1-ja.txt; rm -f "$JA"
res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$JA" -c "$JA" -X POST -H "Content-Type: application/json" \
      -d '{"email":"admin@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
split_res "$res"
assert_eq "login admin" "$RES_CODE" "200"
for st in PREPARING READY IN_DELIVERY DELIVERED; do
  res=$(csrf_post "$JA" "/api/admin/orders/$ORDER1/transition" "{\"to\":\"$st\"}")
  split_res "$res"
  assert_eq "admin → $st" "$RES_CODE" "200"
done
db=$(dbcheck order "$ORDER1")
assert_eq "db order1 DELIVERED" "$(printf '%s' "$db" | jq -r '.status')" "DELIVERED"

echo "=== [I] Customer confirm → 200 + эскроу released + бонус + OrderEvent ==="
res=$(csrf_post "$J1" "/api/orders/$ORDER1/confirm" "{}")
split_res "$res"
assert_eq "customer confirm" "$RES_CODE" "200"
assert_has "confirm body" "$RES_BODY" '"status":"COMPLETED"'
db=$(dbcheck escrow "$ORDER1")
assert_eq "db эскроу released" "$(printf '%s' "$db" | jq -r '.released')" "$(printf '%s' "$db" | jq -r '.total')"
db=$(dbcheck bonusaccrued "$ORDER1")
assert_eq "db бонус начислен (kind=bonus >0)" "$(printf '%s' "$db" | jq -r '.accrued')" "1"
db=$(dbcheck event "$ORDER1" DELIVERED COMPLETED)
assert_eq "OrderEvent actorRole" "$(printf '%s' "$db" | jq -r '.actorRole')" "CUSTOMER"
assert_has "OrderEvent meta via" "$(printf '%s' "$db" | jq -c '.meta')" "customer-confirm"
led=$(cd "$PROJ" && bun scripts/verify-ledger.ts 2>/dev/null | tail -2)
assert_has "verify-ledger" "$led" "OK"

echo "=== [J] Cancel неоплаченного PENDING → 200 CANCELLED ==="
res=$(csrf_post "$J1" "/api/orders" "{\"items\":[{\"productId\":\"$PID2\",\"quantity\":1}],\"contact\":{\"name\":\"Демо-покупатель\",\"phone\":\"+7 (900) 000-00-00\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$tomorrow\",\"slot\":\"13:00–16:00\"}}")
split_res "$res"
assert_eq "POST order2" "$RES_CODE" "201"
ORDER2=$(printf '%s' "$RES_BODY" | jq -r '.orderId // empty')
res=$(csrf_post "$J1" "/api/orders/$ORDER2/cancel" "{}")
split_res "$res"
assert_eq "cancel unpaid PENDING" "$RES_CODE" "200"
assert_has "cancel body" "$RES_BODY" '"status":"CANCELLED"'
db=$(dbcheck order "$ORDER2")
assert_eq "db order2 CANCELLED" "$(printf '%s' "$db" | jq -r '.status')" "CANCELLED"

echo "=== [K] Cancel заказа со списанными бонусами → возврат бонусов ==="
res=$(csrf_post "$J1" "/api/orders" "{\"items\":[{\"productId\":\"$PID1\",\"quantity\":1}],\"contact\":{\"name\":\"Демо-покупатель\",\"phone\":\"+7 (900) 000-00-00\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$tomorrow\",\"slot\":\"10:00–13:00\"},\"redeemBonusPoints\":100}")
split_res "$res"
assert_eq "POST order3 (redeem 100)" "$RES_CODE" "201"
ORDER3=$(printf '%s' "$RES_BODY" | jq -r '.orderId // empty')
assert_eq "order3 bonusDiscountRub" "$(printf '%s' "$RES_BODY" | jq -r '.bonusPointsRedeemed')" "100"
res=$(csrf_post "$J1" "/api/orders/$ORDER3/cancel" "{}")
split_res "$res"
assert_eq "cancel order3" "$RES_CODE" "200"
db=$(dbcheck bonusreturned "$ORDER3")
assert_eq "db возврат бонусов (ОДИН раз)" "$(printf '%s' "$db" | jq -r '.returned')" "1"
db=$(dbcheck order "$ORDER3")
assert_eq "order3 bonusPointsRedeemed сохранён" "$(printf '%s' "$db" | jq -r '.bonusPointsRedeemed')" "100"

echo "=== [L] Cancel ОПЛАЧЕННОГО CONFIRMED → 409 paid_contact_support ==="
res=$(csrf_post "$J1" "/api/orders" "{\"items\":[{\"productId\":\"$PID2\",\"quantity\":1}],\"contact\":{\"name\":\"Демо-покупатель\",\"phone\":\"+7 (900) 000-00-00\"},\"delivery\":{\"method\":\"pickup\",\"date\":\"$tomorrow\",\"slot\":\"16:00–19:00\"}}")
split_res "$res"
assert_eq "POST order4" "$RES_CODE" "201"
ORDER4=$(printf '%s' "$RES_BODY" | jq -r '.orderId // empty')
res=$(csrf_post "$J1" "/api/orders/$ORDER4/pay" "{}")
split_res "$res"
assert_eq "pay order4" "$RES_CODE" "200"
res=$(csrf_post "$J1" "/api/orders/$ORDER4/cancel" "{}")
split_res "$res"
assert_eq "cancel paid CONFIRMED" "$RES_CODE" "409"
assert_has "cancel body" "$RES_BODY" '"error":"paid_contact_support"'
db=$(dbcheck order "$ORDER4")
assert_eq "order4 остался CONFIRMED" "$(printf '%s' "$db" | jq -r '.status')" "CONFIRMED"

echo "=== [M] Favorites: add×2 → GET 2; idempotent-toggle; delete; anon 401 ==="
res=$(csrf_post "$J1" "/api/favorites" "{\"productId\":\"$PID1\"}")
split_res "$res"; assert_eq "fav add #1" "$RES_CODE" "200"
res=$(csrf_post "$J1" "/api/favorites" "{\"productId\":\"$PID2\"}")
split_res "$res"; assert_eq "fav add #2" "$RES_CODE" "200"
res=$(csrf_post "$J1" "/api/favorites" "{\"productId\":\"$PID1\"}")
split_res "$res"
assert_eq "fav toggle same (idempotent)" "$(printf '%s' "$RES_BODY" | jq -r '.total')" "2"
res=$(curl -s --max-time 60 -b "$J1" "$BASE/api/favorites")
assert_eq "GET /api/favorites → 2" "$(printf '%s' "$res" | jq '.total')" "2"
db=$(dbcheck wishlist customer@demo.ru "$PID1")
assert_eq "db unique-констрейнт (dup=1)" "$(printf '%s' "$db" | jq -r '.dupOfArg')" "1"
res=$(curl -s -o /dev/null --max-time 60 -w "%{http_code}" "$BASE/api/favorites")
assert_eq "anon GET favorites" "$res" "401"
# Анон POST: CSRF-гейт стоит ДО auth (порядок ground truth S2B3) → 403 csrf.
res=$(curl -s -o /dev/null --max-time 60 -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "{\"productId\":\"$PID1\"}" "$BASE/api/favorites")
assert_eq "anon POST favorites (csrf-first)" "$res" "403"

echo "=== [N] Profile PATCH: без CSRF 403 / с CSRF 200 + db ==="
res=$(curl -s -o /dev/null --max-time 60 -w "%{http_code}" -b "$J1" -X PATCH -H "Content-Type: application/json" \
      -d '{"name":"Демо-покупатель","phone":"+7 (900) 111-22-33","city":"Тула"}' "$BASE/api/account/profile")
assert_eq "profile PATCH без CSRF" "$res" "403"
res=$(csrf_post "$J1" "/api/account/profile" '{"name":"Демо-покупатель","phone":"+7 (900) 111-22-33","city":"Тула"}' "PATCH")
split_res "$res"
assert_eq "profile PATCH с CSRF" "$RES_CODE" "200"
db=$(dbcheck profile customer@demo.ru)
assert_eq "db profile city" "$(printf '%s' "$db" | jq -r '.city')" "Тула"
assert_eq "db profile phone" "$(printf '%s' "$db" | jq -r '.phone')" "+7 (900) 111-22-33"

echo "=== [O] Password: wrong 400 / ok 200 / re-login / ОТКАТ к Demo123! ==="
res=$(csrf_post "$J1" "/api/auth/password" '{"currentPassword":"Ne Tot!","newPassword":"Demo124!x"}')
split_res "$res"
assert_eq "wrong current" "$RES_CODE" "400"
assert_has "wrong body" "$RES_BODY" '"error":"wrong_password"'
res=$(csrf_post "$J1" "/api/auth/password" '{"currentPassword":"Demo123!","newPassword":"Demo124!x"}')
split_res "$res"
assert_eq "change password" "$RES_CODE" "200"
J3=/tmp/s5b1-j3.txt; rm -f "$J3"
res=$(curl -s -o /dev/null --max-time 60 -w "%{http_code}" -c "$J3" -X POST -H "Content-Type: application/json" \
      -d '{"email":"customer@demo.ru","password":"Demo124!x"}' "$BASE/api/auth/login")
assert_eq "re-login новым паролем" "$res" "200"
res=$(csrf_post "$J1" "/api/auth/password" '{"currentPassword":"Demo124!x","newPassword":"Demo123!"}')
split_res "$res"
assert_eq "ОТКАТ пароля к Demo123!" "$RES_CODE" "200"
J4=/tmp/s5b1-j4.txt; rm -f "$J4"
res=$(curl -s -o /dev/null --max-time 60 -w "%{http_code}" -c "$J4" -X POST -H "Content-Type: application/json" \
      -d '{"email":"customer@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
assert_eq "re-login Demo123! (для следующих гейтов)" "$res" "200"

# Пауза перед [P]: платформенный общий бакет admin-mutation 30/мин/IP
# (ground truth S2B3, consume в withRole на КАЖДОЙ мутирующей попытке) к
# концу [O] исчерпан (~22 события [D]..[O]). Окно 60с — ждём его истечения,
# чтобы [P] (11 мутаций) уложился в свежее окно. Спека не ослабляется:
# 20/мин/user для адресов проверяется СВОИМ ключом, пауза — только pacing.
sleep 61

echo "=== [P] Addresses CRUD + isDefault exclusive + 11-й → 400 ==="
res=$(curl -s --max-time 60 -b "$J1" "$BASE/api/account/addresses")
n0=$(printf '%s' "$res" | jq '.total')
echo "… стартовое число адресов: $n0"
mk_addr() { # $1=jar $2=label $3=house $4=default(true/false)
  csrf_post "$1" "/api/account/addresses" "{\"label\":\"$2\",\"recipient\":\"Анна Петрова\",\"phone\":\"+7 (900) 222-33-44\",\"city\":\"Тула\",\"street\":\"ул. Металлургов\",\"house\":\"$3\",\"flat\":\"45\",\"isDefault\":$4}"
}
res=$(mk_addr "$J1" "Дом-matrix" "12" "true"); split_res "$res"
assert_eq "addr create #1" "$RES_CODE" "201"
A1=$(printf '%s' "$RES_BODY" | jq -r '.address.id // empty')
res=$(mk_addr "$J1" "Работа-matrix" "22" "true"); split_res "$res"
assert_eq "addr create #2 (default)" "$RES_CODE" "201"
A2=$(printf '%s' "$RES_BODY" | jq -r '.address.id // empty')
db=$(dbcheck addresses customer@demo.ru)
assert_eq "isDefault эксклюзивность (defaults=1)" "$(printf '%s' "$db" | jq -r '.defaults')" "1"
res=$(csrf_post "$J1" "/api/account/addresses/$A2" "{\"label\":\"Работа-matrix 2\",\"recipient\":\"Анна Петрова\",\"phone\":\"+7 (900) 222-33-44\",\"city\":\"Тула\",\"street\":\"ул. Металлургов\",\"house\":\"23\",\"isDefault\":false}" "PATCH")
split_res "$res"
assert_eq "addr PATCH" "$RES_CODE" "200"
res=$(mk_addr "$J1" "Dacha-matrix" "8" "false"); split_res "$res"
assert_eq "addr create #3" "$RES_CODE" "201"
A3=$(printf '%s' "$RES_BODY" | jq -r '.address.id // empty')
res=$(csrf_post "$J1" "/api/account/addresses/$A3" '{}' "DELETE")
split_res "$res"
assert_eq "addr DELETE" "$RES_CODE" "200"
db=$(dbcheck addresses customer@demo.ru)
assert_eq "addr после DELETE" "$(printf '%s' "$db" | jq -r '.count')" "2"
# Долив до 10 (ещё 8) и проверка 11-го → 400 limit
for i in 4 5 6 7 8 9 10 11; do
  res=$(mk_addr "$J1" "Адрес-$i" "3$i" "false")
  split_res "$res"
  [ "$RES_CODE" = "201" ] || bad "addr create #$i → $RES_CODE (ожидали 201)"
done
res=$(mk_addr "$J1" "Адрес-12" "39" "false"); split_res "$res"
assert_eq "11-й адрес → 400 limit" "$RES_CODE" "400"
assert_has "limit body" "$RES_BODY" '"error":"limit"'
db=$(dbcheck addresses customer@demo.ru)
assert_eq "addr count == 10" "$(printf '%s' "$db" | jq -r '.count')" "10"
# Чужой адрес (demo2) → 404
res=$(csrf_post "$J2" "/api/account/addresses/$A1" '{}' "DELETE")
split_res "$res"
assert_eq "чужой адрес DELETE → 404" "$RES_CODE" "404"

# Cleanup адресов до 2 (best-effort): свежее окно rate (62s), 8 DELETE
sleep 62
res=$(curl -s --max-time 60 -b "$J1" "$BASE/api/account/addresses")
ids=$(printf '%s' "$res" | jq -r '.addresses[] | select(.isDefault==false) | .id')
for id in $ids; do
  res=$(csrf_post "$J1" "/api/account/addresses/$id" '{}' "DELETE")
  split_res "$res"
  [ "$RES_CODE" = "200" ] || bad "addr cleanup $id → $RES_CODE"
done
db=$(dbcheck addresses customer@demo.ru)
echo "… адресов после cleanup: $(printf '%s' "$db" | jq -r '.count') (default: $(printf '%s' "$db" | jq -r '.defaults'))"

echo "=== [Q] Rate-burst confirm (10/мин/user) → 429 + Retry-After ==="
burst429=0; retry_after=""
for i in $(seq 1 11); do
  token=$(csrf_token "$J1")
  out=$(curl -s -D /tmp/s5b1-h.txt -w $'\n%{http_code}' -o /dev/null --max-time 60 -b "$J1" \
        -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $token" -d '{}' "$BASE/api/orders/$ORDER4/confirm")
  code=$(printf '%s' "$out" | tail -1)
  if [ "$code" = "429" ]; then
    burst429=1
    retry_after=$(grep -i '^Retry-After:' /tmp/s5b1-h.txt | tr -d '\r' | awk '{print $2}')
    break
  fi
done
assert_eq "burst → 429 получен" "$burst429" "1"
assert_eq "Retry-After присутствует (значение: $retry_after)" "$([ -n "$retry_after" ] && echo yes || echo no)" "yes"

echo "=== [R] Favorites cleanup: удалить добавленные (best-effort) ==="
csrf_post "$J1" "/api/favorites" "{\"productId\":\"$PID1\"}" "DELETE" > /dev/null
csrf_post "$J1" "/api/favorites" "{\"productId\":\"$PID2\"}" "DELETE" > /dev/null

echo ""
echo "==============================================="
echo "S5B1 MATRIX: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" = "0" ]; then echo "GATE 2: GREEN"; else echo "GATE 2: RED"; fi
rm -f "$PROJ/scripts/tmp-dbcheck.ts"
exit 0
