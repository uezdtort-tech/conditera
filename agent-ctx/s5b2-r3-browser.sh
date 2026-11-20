#!/bin/bash
# =============================================================================
# s5b2-r3-browser.sh — S5B2-R3 browser-гейт (agent-browser). Паттерн
# s5b1-r3-browser.sh + dedicated --session (Урок: default session shared) +
# curl-warmup маршрутов (dev-компиляция on-demand) + polling через wait --text.
#
# Флоу: логин confectioner (cookie-injection) → /vendor/products →
# /vendor/orders → /vendor/analytics (light; скриншоты
# s5b2-r3-{products,orders,analytics}) → dark-тема на /vendor/analytics
# (s5b2-r3-dark) → mobile 390 /vendor scrollWidth==390
# (s5b2-r3-mobile-390) → console errors == 0.
# =============================================================================
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
V2="/home/z/my-project/conditera-v2"
SESS="s5b2r3-03e363425671"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
AB()   { agent-browser --session "$SESS" "$@"; }

# --- dev lift (если умер) ------------------------------------------------------
if ! curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then
  echo "… dev :3100 не отвечает — поднимаем"
  for pid in $(lsof -ti tcp:3100 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  sleep 1; rm -f "$V2/.next/dev/lock"
  (cd "$V2" && env -u DATABASE_URL nohup bun run dev > /tmp/dev-v2.log 2>&1 &)
  for i in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then echo "… health OK (${i}s)"; break; fi
    sleep 1
  done
fi

# --- helpers -------------------------------------------------------------------
login_cookie() { # email jar
  rm -f "$2"
  curl -s -m 30 -c "$2" -b "$2" -X POST -H "Content-Type: application/json" \
    "$BASE/api/auth/login" -d "{\"email\":\"$1\",\"password\":\"Demo123!\"}" -o /dev/null
  awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$2" | tail -1
}
ni() { timeout 20 AB wait --load networkidle >/dev/null 2>&1 || true; }
load_text() { # текст — ждём до 20с
  for i in $(seq 1 20); do
    if AB wait --text "$1" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
prep_page() { # url wait_ms — открытие + networkidle + load-текст-поллинг + перезагрузка
  AB open "$1" >/dev/null 2>&1
  ni
  AB wait "${2:-1500}" >/dev/null 2>&1
  load_text "Товары студии"; load_text "Заказы"; load_text "Аналитика"
  AB reload >/dev/null 2>&1
  ni
  AB wait "${2:-1500}" >/dev/null 2>&1
}
shot() { AB screenshot "$1" >/dev/null 2>&1; [ -s "$1" ] && ok "screenshot $(basename "$1")" || bad "screenshot $(basename "$1")" "no file"; }

# =============================================================================
# Warmup: dev-компиляция маршрутов через curl (аноним — редиректы тоже греют)
# =============================================================================
echo "=== S5B2-R3 browser-гейт ==="
rm -f /tmp/s5b2-warm.txt
curl -s -m 30 -c /tmp/s5b2-warm.txt -b /tmp/s5b2-warm.txt -X POST -H "Content-Type: application/json" \
  -d '{"email":"confectioner@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login" -o /dev/null
for p in /vendor/products /vendor/orders /vendor/analytics /vendor; do
  curl -s -o /dev/null -m 60 -b /tmp/s5b2-warm.txt "$BASE$p"
done
ok "warmup: маршруты кабинета прогреты через curl"

# =============================================================================
# Логин confectioner + тур страниц кабинета (light)
# =============================================================================
AB close --all >/dev/null 2>&1
AB set viewport 1280 900 >/dev/null 2>&1
AB open "$BASE/" >/dev/null 2>&1
ni; AB wait 800 >/dev/null 2>&1
AB cookies clear >/dev/null 2>&1
TOKEN=$(login_cookie "confectioner@demo.ru" /tmp/s5b2-r3-jar.txt)
[ -n "$TOKEN" ] && ok "login confectioner@demo.ru (cookie-injection)" || bad "login" "no session cookie"
AB cookies set "sb-127-auth-token" "$TOKEN" >/dev/null 2>&1
AB console --clear >/dev/null 2>&1
AB errors --clear >/dev/null 2>&1

# --- /vendor/products (light) ---
prep_page "$BASE/vendor/products" 2000
URL_NOW=$(AB get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/vendor/products" && ok "products: url /vendor/products" || bad "products url" "$URL_NOW"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Товары" && ok "products: h1 «Товары»" || bad "products h1" "absent"
shot "$CTX/s5b2-r3-products.png"

# --- /vendor/orders (light) ---
prep_page "$BASE/vendor/orders" 2000
URL_NOW=$(AB get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/vendor/orders" && ok "orders: url /vendor/orders" || bad "orders url" "$URL_NOW"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Заказы" && ok "orders: h1 «Заказы»" || bad "orders h1" "absent"
shot "$CTX/s5b2-r3-orders.png"

# --- /vendor/analytics (light) ---
prep_page "$BASE/vendor/analytics" 2000
URL_NOW=$(AB get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/vendor/analytics" && ok "analytics: url /vendor/analytics" || bad "analytics url" "$URL_NOW"
load_text "Выручка по дням" && ok "analytics: текст «Выручка по дням» дождался" || bad "analytics wait" "timeout"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Аналитика" && ok "analytics: h1 «Аналитика»" || bad "analytics h1" "absent"
printf '%s' "$SNAP" | grep -q "Топ-5 товаров" && ok "analytics: блок «Топ-5 товаров»" || bad "analytics top5" "absent"
shot "$CTX/s5b2-r3-analytics.png"

# --- dark-тема на /vendor/analytics ---
echo "=== dark ==="
CLICKED=$(AB eval 'document.querySelector("button[aria-label*=тему]") ? "btn" : "no-btn"' 2>/dev/null | tail -1)
if [ "$CLICKED" = "btn" ]; then
  AB eval 'document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
else
  bad "dark: кнопка темы" "not found ($CLICKED)"
fi
DARK_STATE=""
for i in $(seq 1 10); do
  DARK_STATE=$(AB eval 'document.documentElement.classList.contains("dark") ? "dark" : "light"' 2>/dev/null | tail -1)
  [ "$DARK_STATE" = '"dark"' ] && break
  AB wait 1000 >/dev/null 2>&1
done
[ "$DARK_STATE" = '"dark"' ] && ok "dark: класс .dark применён" || bad "dark class" "state=$DARK_STATE"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Аналитика" && ok "dark: /vendor/analytics рендерится" || bad "dark page" "absent"
shot "$CTX/s5b2-r3-dark.png"
AB eval 'document.querySelector("button[aria-label*=тему]") && document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
AB wait 800 >/dev/null 2>&1

# --- mobile 390: /vendor scrollWidth == 390 ---
echo "=== mobile 390 ==="
AB set viewport 390 844 >/dev/null 2>&1
AB open "$BASE/vendor" >/dev/null 2>&1
ni; AB wait 1500 >/dev/null 2>&1
load_text "Обзор"
URL_NOW=$(AB get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/vendor" && ok "mobile: /vendor доступен (гвард сервера)" || bad "mobile url" "$URL_NOW"
SW=$(AB eval 'document.documentElement.scrollWidth' 2>/dev/null | tail -1)
[ "${SW:-0}" = '"390"' ] && ok "mobile 390 /vendor scrollWidth=390" || bad "mobile 390 /vendor" "scrollWidth=$SW"
shot "$CTX/s5b2-r3-mobile-390.png"

# --- console errors за весь тур ---
CONSOLE_ERR=$(AB console 2>/dev/null | grep -ciE "\berror\b" || true)
PAGE_ERR=$(AB errors 2>/dev/null | grep -cv "No page errors\|^$" || true)
if [ "$CONSOLE_ERR" = "0" ] && [ "$PAGE_ERR" = "0" ]; then
  ok "console errors = 0 (console=$CONSOLE_ERR, page=$PAGE_ERR)"
else
  bad "console errors" "console=$CONSOLE_ERR page=$PAGE_ERR"
fi

AB close --all >/dev/null 2>&1
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
