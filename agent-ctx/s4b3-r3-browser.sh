#!/bin/bash
# S4B3-R3 browser-гейт (agent-browser). Паттерн s4b2-browser.sh:
# cookie-injection из curl-jar, close --all (свежая вкладка), reload+console
# clear ДО счёта ошибок. Всё в одном вызове — dev стартует здесь же.
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
V2="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
login_cookie() { # email jar cookie_name
  rm -f "$2"
  curl -s -m 30 -c "$2" -b "$2" -X POST -H "Content-Type: application/json" \
    "$BASE/api/auth/login" -d "{\"email\":\"$1\",\"password\":\"Demo123!\"}" -o /dev/null
  awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$2" | tail -1
}
open_authed() { # email jar
  # Урок S4B3-R3: cookie ставится ДО open — попадает в about:blank-домен и
  # не уходит на 127.0.0.1 (редирект на несуществующий /login). Сначала
  # открываем страницу на хосте, потом чистим/ставим cookie.
  agent-browser open "$BASE/" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait 800 >/dev/null 2>&1
  agent-browser cookies clear >/dev/null 2>&1
  TOKEN=$(login_cookie "$1" "$2")
  [ -n "$TOKEN" ] || { bad "login $1" "no session cookie"; return 1; }
  agent-browser cookies set "sb-127-auth-token" "$TOKEN" >/dev/null 2>&1
  return 0
}
prep_page() { # url wait_ms
  agent-browser open "$1" >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait "${2:-1500}" >/dev/null 2>&1
  agent-browser reload >/dev/null 2>&1
  agent-browser wait --load networkidle >/dev/null 2>&1
  agent-browser wait "${2:-1500}" >/dev/null 2>&1
  agent-browser console --clear >/dev/null 2>&1
  agent-browser errors --clear >/dev/null 2>&1
}
shot() { agent-browser screenshot "$1" >/dev/null 2>&1; [ -s "$1" ] && ok "screenshot $(basename "$1")" || bad "screenshot $(basename "$1")" "no file"; }
SW=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null | tail -1)

echo "=== B0. confectioner: /account/payouts — форма + заявка ==="
agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 900 >/dev/null 2>&1
open_authed "confectioner@demo.ru" /tmp/s4b3-bjar-conf.txt || true
prep_page "$BASE/account/payouts" 2000
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/account/payouts" && ok "conf: /account/payouts доступен (гвард роль)" || bad "conf payouts access" "url=$URL_NOW"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Запросить выплату" && ok "conf: форма «Запросить выплату»" || bad "conf form" "absent"
printf '%s' "$SNAP" | grep -qiE "Доступно|Минимал" && ok "conf: блок баланса/минималки" || bad "conf balance block" "absent"
agent-browser find label "Сумма выплаты" fill "500" >/dev/null 2>&1 || agent-browser fill "#payout-amount" "500" >/dev/null 2>&1
agent-browser find role button click --name "Запросить выплату" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Заявка на выплату создана" && ok "conf: тост о создании заявки" || bad "conf toast" "absent"
printf '%s' "$SNAP" | grep -q "Ожидает" && ok "conf: бейдж «Ожидает» в истории" || bad "conf pending badge" "absent"
shot "$CTX/s4b3-r3-payouts-confectioner.png"

echo "=== B1. admin: /admin/payouts — approve → complete (dev-код) ==="
open_authed "admin@demo.ru" /tmp/s4b3-bjar-admin.txt || true
prep_page "$BASE/admin/payouts" 2000
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/admin/payouts" && ok "admin: /admin/payouts доступен" || bad "admin payouts access" "url=$URL_NOW"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Очередь заявок" && ok "admin: очередь заявок" || bad "admin queue" "absent"
agent-browser eval "(document.querySelector('button[aria-label^=\"Одобрить выплату\"]')||{click:()=>{}}).click()" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Одобрена" && ok "admin: бейдж «Одобрена»" || bad "admin approved badge" "absent"
agent-browser eval "(document.querySelector('button[aria-label^=\"Выплатить\"]')||{click:()=>{}}).click()" >/dev/null 2>&1
agent-browser wait 1200 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Подтверждение перевода" && ok "admin: 2FA-диалог открыт" || bad "admin tfa dialog" "absent"
printf '%s' "$SNAP" | grep -q "Dev-код задан в env" && ok "admin: dev-подсказка без значения кода" || bad "admin dev hint" "absent"
TFA=$(grep '^DEV_TFA_MOCK_CODE=' "$V2/.env.local" | cut -d= -f2-)
agent-browser find label "Код 2FA" fill "$TFA" >/dev/null 2>&1 || agent-browser fill "#tfa-code" "$TFA" >/dev/null 2>&1
agent-browser find role button click --name "Выплатить" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Выплачена" && ok "admin: бейдж «Выплачена»" || bad "admin completed badge" "absent"
printf '%s' "$SNAP" | grep -qE "2FA:" && ok "admin: факт 2FA (completedTfaAt) в строке" || bad "admin 2FA fact" "absent"
shot "$CTX/s4b3-r3-payouts-admin.png"

echo "=== B2. /account/balance — история + фильтр по виду ==="
open_authed "confectioner@demo.ru" /tmp/s4b3-bjar-conf.txt || true
prep_page "$BASE/account/balance" 2000
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/account/balance" && ok "balance: страница доступна" || bad "balance access" "url=$URL_NOW"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -qiE "Баланс" && ok "balance: карточка баланса" || bad "balance card" "absent"
printf '%s' "$SNAP" | grep -q "Заморозка" && ok "balance: проводки с RU-видами (Заморозка)" || bad "balance kinds" "absent"
CNT=$(agent-browser get count 'button[aria-label="Фильтр по виду проводок"]' 2>/dev/null | tail -1)
[ "${CNT:-0}" = "1" ] && ok "balance: фильтр по виду присутствует" || bad "balance filter" "count=$CNT"
agent-browser find label "Фильтр по виду проводок" click >/dev/null 2>&1 || agent-browser eval 'document.querySelector("button[aria-label=\"Фильтр по виду проводок\"]").click()' >/dev/null 2>&1
agent-browser wait 800 >/dev/null 2>&1
agent-browser find role option click --name "Выплата" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "kind=payout" && ok "balance: фильтр kind=payout применился (URL)" || bad "balance kind filter" "url=$URL_NOW"
SNAP=$(agent-browser snapshot 2>/dev/null)
if printf '%s' "$SNAP" | grep -q "Оплата заказа\|Эскроу"; then
  bad "balance filter rows" "не-выплатные проводки в отфильтрованном списке"
else
  ok "balance: отфильтрованный список содержит только выплаты"
fi
shot "$CTX/s4b3-r3-balance.png"

echo "=== B3. консоль: 0 ошибок ==="
CONSOLE_ERR=$(agent-browser console 2>/dev/null | grep -ciE "\berror\b" || true)
PAGE_ERR=$(agent-browser errors 2>/dev/null | grep -cv "No page errors\|^$" || true)
if [ "${CONSOLE_ERR:-0}" = "0" ] && [ "${PAGE_ERR:-0}" = "0" ]; then
  ok "console errors = 0 (console=$CONSOLE_ERR, page=$PAGE_ERR)"
else
  bad "console errors" "console=$CONSOLE_ERR page=$PAGE_ERR"
fi

echo "=== B4. mobile 390: scrollWidth == 390 на трёх страницах ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
for P in /account/payouts /admin/payouts /account/balance; do
  prep_page "$BASE$P" 1500
  SW=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null | tail -1)
  [ "${SW:-0}" = "390" ] && ok "mobile 390 $P scrollWidth=390" || bad "mobile 390 $P" "scrollWidth=$SW"
done
shot "$CTX/s4b3-r3-mobile-390.png"

echo "=== B5. dark-тема ==="
agent-browser set viewport 1280 900 >/dev/null 2>&1
open_authed "admin@demo.ru" /tmp/s4b3-bjar-admin.txt || true
prep_page "$BASE/admin/payouts" 1500
agent-browser set media dark >/dev/null 2>&1
agent-browser eval "document.documentElement.classList.add('dark')" >/dev/null 2>&1
agent-browser wait 800 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Очередь заявок" && ok "dark: /admin/payouts рендерится" || bad "dark page" "absent"
shot "$CTX/s4b3-r3-dark.png"

echo ""
echo "=== БРАУЗЕР-ГЕЙТ: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && echo "ALL GREEN" || echo "HAS FAILURES"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
