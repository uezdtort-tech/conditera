#!/bin/bash
# S4B2 browser-гейт (agent-browser): вход через cookie-injection из curl-jar
# (UI-модалка нестабильна на свежескомпилированных страницах), затем
# /account/orders → «Оплатить» → /checkout/success → бейджи → консоль →
# mobile 390 → dark → 4 скриншота.
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
JAR="/tmp/s4b2-browser-jar.txt"
rm -f "$JAR"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }

pay_btn_count() {
  agent-browser eval "Array.from(document.querySelectorAll('button')).filter(b => (b.textContent||'').includes('Оплатить')).length" 2>/dev/null | tail -1
}

echo "=== B0. curl-login + cookie injection ==="
# Свежая сессия браузера (урок recreate-3: вкладка, унаследованная от прошлого
# прогона, держит старые чанки Turbopack — ChunkLoadError hmr-client при рестарте dev).
agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 900 >/dev/null 2>&1
agent-browser open "$BASE/cart" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1000 >/dev/null 2>&1
curl -s -m 30 -c "$JAR" -b "$JAR" -X POST -H "Content-Type: application/json" "$BASE/api/auth/login" -d '{"email":"customer@demo.ru","password":"Demo123!"}' -o /dev/null
TOKEN=$(awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$JAR" | tail -1)
if [ -n "$TOKEN" ]; then ok "curl login, session cookie получен (значение не печатается)"; else bad "login" "no session cookie in jar"; fi
agent-browser cookies set "sb-127-auth-token" "$TOKEN" >/dev/null 2>&1
agent-browser open "$BASE/account/orders" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
# Первый прогруз после рестарта dev может отдать устаревший HMR-чанк (шум
# Turbopack dev, не код приложения): reload + очистка консоли ДО счёта ошибок.
agent-browser reload >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
agent-browser console --clear >/dev/null 2>&1
URL_NOW=$(agent-browser get url 2>/dev/null)
if printf '%s' "$URL_NOW" | grep -q "/account/orders"; then
  ok "авторизованный доступ к /account/orders (нет редиректа на /cart)"
else
  bad "account/orders access" "url=$URL_NOW"
fi

echo "=== B2. кнопка «Оплатить» на PENDING-заказе ==="
PAY_COUNT_BEFORE=$(pay_btn_count)
echo "    кнопок Оплатить до оплаты: $PAY_COUNT_BEFORE"
if [ "${PAY_COUNT_BEFORE:-0}" -ge 1 ] 2>/dev/null; then
  ok "кнопки Оплатить присутствуют ($PAY_COUNT_BEFORE)"
else
  bad "pay buttons" "count=$PAY_COUNT_BEFORE"
fi
agent-browser screenshot "$CTX/s4b2-r3-account-orders.png" >/dev/null 2>&1
[ -s "$CTX/s4b2-r3-account-orders.png" ] && ok "screenshot account-orders" || bad "screenshot account-orders" "no file"

echo "=== B3. клик «Оплатить» (первая карточка — свежий PENDING-заказ) → тост → /checkout/success ==="
# Клик СТРОГО по кнопке (aria-label), не по тексту подзаголовка «…кнопкой «Оплатить»»
# (урок recreate-3: find text ловил абзац-описание, оплата не происходила).
agent-browser eval "(document.querySelector('button[aria-label=\"Оплатить заказ\"]')||{click:()=>{}}).click()" >/dev/null 2>&1
agent-browser wait --url "/checkout/success" >/dev/null 2>&1 || agent-browser wait 8000 >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
URL_NOW=$(agent-browser get url 2>/dev/null)
if printf '%s' "$URL_NOW" | grep -q "/checkout/success?orderId="; then
  ok "redirect на success-страницу"
else
  bad "redirect success" "url=$URL_NOW"
fi
BODY_TXT=$(agent-browser snapshot 2>/dev/null)
if printf '%s' "$BODY_TXT" | grep -q "Заказ CD-"; then ok "success: «Заказ CD-… принят»"; else bad "success CD text" "absent"; fi
if printf '%s' "$BODY_TXT" | grep -q "Подтверждён"; then ok "success: бейдж Подтверждён"; else bad "badge Подтверждён" "absent"; fi
if printf '%s' "$BODY_TXT" | grep -q "Оплата получена"; then ok "success: Оплата получена"; else bad "Оплата получена" "absent"; fi
ORDER_NUM=$(printf '%s' "$BODY_TXT" | python3 -c "
import sys, re
for l in sys.stdin:
    m = re.search(r'CD-\d{4}-\d{4}', l)
    if m: print(m.group(0)); break")
echo "    success page order=$ORDER_NUM"
agent-browser screenshot "$CTX/s4b2-r3-success.png" >/dev/null 2>&1
[ -s "$CTX/s4b2-r3-success.png" ] && ok "screenshot success" || bad "screenshot success" "no file"

echo "=== B4. /account/orders: бейдж обновлён, кнопка оплаченного заказа исчезла ==="
agent-browser open "$BASE/account/orders" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
BODY2=$(agent-browser snapshot 2>/dev/null)
if printf '%s' "$BODY2" | grep -q "Подтверждён"; then ok "account/orders: бейдж Подтверждён присутствует"; else bad "badge updated" "absent"; fi
PAY_COUNT_AFTER=$(pay_btn_count)
echo "    кнопок Оплатить после оплаты: $PAY_COUNT_AFTER"
EXPECT=$(( ${PAY_COUNT_BEFORE:-0} - 1 ))
if [ "${PAY_COUNT_AFTER:-0}" -eq "$EXPECT" ] 2>/dev/null; then
  ok "кнопок Оплатить стало на 1 меньше ($PAY_COUNT_BEFORE → $PAY_COUNT_AFTER)"
else
  bad "pay button count" "before=$PAY_COUNT_BEFORE after=$PAY_COUNT_AFTER expect=$EXPECT"
fi

echo "=== B5. console errors ==="
CONSOLE=$(agent-browser console 2>/dev/null)
ERR_COUNT=$(printf '%s' "$CONSOLE" | grep -ci "error" || true)
PAGES_ERR=$(agent-browser errors 2>/dev/null | grep -c "Error" || true)
if [ "$ERR_COUNT" = "0" ] && [ "$PAGES_ERR" = "0" ]; then ok "console errors = 0, page errors = 0"; else bad "console/page errors" "console=$ERR_COUNT page=$PAGES_ERR"; fi

echo "=== B6. mobile 390 ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
agent-browser open "$BASE/account/orders" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
W1=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null | tail -1)
agent-browser open "$BASE/checkout/success?orderId=$(cat /tmp/s4b2-order4.txt 2>/dev/null)" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
W2=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null | tail -1)
if [ "$W1" = "390" ] && [ "$W2" = "390" ]; then ok "mobile 390: scrollWidth orders=$W1 success=$W2"; else bad "mobile scrollWidth" "orders=$W1 success=$W2"; fi
agent-browser screenshot "$CTX/s4b2-r3-mobile-390.png" >/dev/null 2>&1
[ -s "$CTX/s4b2-r3-mobile-390.png" ] && ok "screenshot mobile-390" || bad "screenshot mobile" "no file"

echo "=== B7. dark mode ==="
agent-browser set media dark >/dev/null 2>&1
agent-browser set viewport 1280 900 >/dev/null 2>&1
agent-browser open "$BASE/account/orders" >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
agent-browser wait 1500 >/dev/null 2>&1
agent-browser screenshot "$CTX/s4b2-r3-dark.png" >/dev/null 2>&1
[ -s "$CTX/s4b2-r3-dark.png" ] && ok "screenshot dark" || bad "screenshot dark" "no file"
agent-browser set media light >/dev/null 2>&1

echo ""
echo "=== BROWSER итог: PASS=$PASS FAIL=$FAIL ==="
