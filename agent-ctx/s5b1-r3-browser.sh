#!/bin/bash
# =============================================================================
# s5b1-r3-browser.sh — S5B1 browser-гейт (agent-browser). Паттерн
# s4b3-r3-browser.sh: cookie-injection из curl-jar, close --all, reload +
# console clear ДО счёта ошибок. Всё в одном вызове (Урок №11).
#
# Флоу: фиксdevice (order DELIVERED через API) → /account статистика →
# mobile Sheet (закрытие при выборе) → orders табы → confirm DELIVERED →
# toast → баланс вырос → favorites 2 сердца → grid 2 → удалить 1 → grid 1 →
# profile PATCH + address CRUD → console 0 → mobile 390 scrollWidth ×4 →
# dark. Скриншоты s5b1-r3-{overview,orders,favorites,profile,mobile-390,dark}.
# =============================================================================
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
V2="/home/z/my-project/conditera-v2"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }

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
csrf_token() { curl -s -b "$1" -c "$1" "$BASE/api/csrf" | jq -r '.token // empty'; }
csrf_post() { # jar url body [method]
  local jar="$1" url="$2" body="$3" method="${4:-POST}" token
  token=$(csrf_token "$jar")
  curl -s --max-time 60 -w $'\n%{http_code}' -b "$jar" -c "$jar" \
    -X "$method" -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
    -d "$body" "$BASE$url"
}
split_res() { RES_CODE=$(printf '%s' "$1" | tail -1); RES_BODY=$(printf '%s' "$1" | sed '$d'); }
login_cookie() { # email jar
  rm -f "$2"
  curl -s -m 30 -c "$2" -b "$2" -X POST -H "Content-Type: application/json" \
    "$BASE/api/auth/login" -d "{\"email\":\"$1\",\"password\":\"Demo123!\"}" -o /dev/null
  awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$2" | tail -1
}
ni() { timeout 15 agent-browser wait --load networkidle >/dev/null 2>&1 || true; }
open_authed() { # email jar — Урок №14: сначала open хоста, потом cookies
  agent-browser open "$BASE/" >/dev/null 2>&1
  ni
  agent-browser wait 800 >/dev/null 2>&1
  agent-browser cookies clear >/dev/null 2>&1
  local TOKEN; TOKEN=$(login_cookie "$1" "$2")
  [ -n "$TOKEN" ] || { bad "login $1" "no session cookie"; return 1; }
  agent-browser cookies set "sb-127-auth-token" "$TOKEN" >/dev/null 2>&1
  return 0
}
prep_page() { # url wait_ms
  agent-browser open "$1" >/dev/null 2>&1
  ni
  agent-browser wait "${2:-1500}" >/dev/null 2>&1
  agent-browser reload >/dev/null 2>&1
  ni
  agent-browser wait "${2:-1500}" >/dev/null 2>&1
  agent-browser console --clear >/dev/null 2>&1
  agent-browser errors --clear >/dev/null 2>&1
}
shot() { agent-browser screenshot "$1" >/dev/null 2>&1; [ -s "$1" ] && ok "screenshot $(basename "$1")" || bad "screenshot $(basename "$1")" "no file"; }
bal_line() { # текст строки «Бонусный баланс» + значение (innerText)
  agent-browser eval "(() => { const t=document.body.innerText; const i=t.indexOf('Бонусный баланс'); return i<0 ? 'absent' : t.slice(i, i+60).split('\n').slice(0,2).join(' | '); })()" 2>/dev/null | tail -1
}

# =============================================================================
# FIXTURE: заказ customer → pay → admin-переходы до DELIVERED
# =============================================================================
echo "=== FIXTURE: заказ до DELIVERED ==="
rm -f /tmp/s5b1-fx-c.txt /tmp/s5b1-fx-a.txt
curl -s -m 30 -c /tmp/s5b1-fx-c.txt -b /tmp/s5b1-fx-c.txt -X POST -H "Content-Type: application/json" \
  -d '{"email":"customer@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login" -o /dev/null
PID1=$(curl -s --max-time 30 "$BASE/api/products" | jq -r '.items[0].id // empty')
[ -n "$PID1" ] || { echo "FATAL: нет товаров"; exit 1; }
tomorrow=$(date -u -d "+1 day" +%F 2>/dev/null || date -u +%F)
res=$(csrf_post /tmp/s5b1-fx-c.txt "/api/orders" "{\"items\":[{\"productId\":\"$PID1\",\"quantity\":1}],\"contact\":{\"name\":\"Демо-покупатель\",\"phone\":\"+7 (900) 000-00-00\"},\"delivery\":{\"method\":\"courier\",\"address\":\"Тула, ул. Металлургов, д. 12\",\"date\":\"$tomorrow\",\"slot\":\"10:00–13:00\"}}")
split_res "$res"
OID=$(printf '%s' "$RES_BODY" | jq -r '.orderId // empty')
ONUM=$(printf '%s' "$RES_BODY" | jq -r '.number // empty')
[ "$RES_CODE" = "201" ] && [ -n "$OID" ] && ok "fixture: заказ $ONUM создан" || { echo "FATAL: order create $RES_CODE"; exit 1; }
res=$(csrf_post /tmp/s5b1-fx-c.txt "/api/orders/$OID/pay" "{}")
split_res "$res"
[ "$RES_CODE" = "200" ] && ok "fixture: оплачен (CONFIRMED)" || { echo "FATAL: pay $RES_CODE"; exit 1; }
curl -s -m 30 -c /tmp/s5b1-fx-a.txt -b /tmp/s5b1-fx-a.txt -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login" -o /dev/null
for st in PREPARING READY IN_DELIVERY DELIVERED; do
  res=$(csrf_post /tmp/s5b1-fx-a.txt "/api/admin/orders/$OID/transition" "{\"to\":\"$st\"}")
  split_res "$res"
  [ "$RES_CODE" = "200" ] || { echo "FATAL: admin → $st = $RES_CODE"; exit 1; }
done
ok "fixture: DELIVERED готов ($OID)"

# =============================================================================
# B0. customer /account — статистика + баланс ДО confirm
# =============================================================================
echo "=== B0. customer /account — статистика ==="
agent-browser close --all >/dev/null 2>&1
agent-browser set viewport 1280 900 >/dev/null 2>&1
open_authed "customer@demo.ru" /tmp/s5b1-fx-b.txt || true
prep_page "$BASE/account" 2000
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/account" && ok "overview: /account доступен (гвард сервера)" || bad "overview access" "url=$URL_NOW"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Заказы всего" && ok "overview: карточка «Заказы всего»" || bad "stat orders" "absent"
printf '%s' "$SNAP" | grep -q "Бонусный баланс" && ok "overview: карточка «Бонусный баланс»" || bad "stat balance" "absent"
printf '%s' "$SNAP" | grep -q "Сумма покупок" && ok "overview: карточка «Сумма покупок»" || bad "stat purchases" "absent"
printf '%s' "$SNAP" | grep -q "Последние заказы" && ok "overview: последние заказы" || bad "last orders" "absent"
BAL_BEFORE=$(bal_line)
printf '%s' "$SNAP" | grep -q "Навигация кабинета" && ok "overview: сайдбар-навигация" || bad "sidebar nav" "absent"
shot "$CTX/s5b1-r3-overview.png"

# =============================================================================
# B1. mobile Sheet (<md): открытие → выбор «Заказы» → закрытие
# =============================================================================
echo "=== B1. mobile Sheet: открытие/выбор/закрытие ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
prep_page "$BASE/account" 1500
agent-browser eval "document.querySelector('button[aria-label=\"Открыть меню кабинета\"]').click()" >/dev/null 2>&1
agent-browser wait 1200 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Навигация кабинета" && ok "sheet: открылась с навигацией" || bad "sheet open" "absent"
printf '%s' "$SNAP" | grep -q "Выход" && ok "sheet: пункт «Выход»" || bad "sheet logout" "absent"
agent-browser eval "(() => { const l=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/account/orders'); l.click(); return l.textContent.trim(); })()" >/dev/null 2>&1
agent-browser wait 2000 >/dev/null 2>&1
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "/account/orders" && ok "sheet: выбранный пункт → /account/orders" || bad "sheet navigate" "url=$URL_NOW"
SHEET_GONE=$(agent-browser eval "document.querySelector('[role=\"dialog\"]') ? 'open' : 'closed'" 2>/dev/null | tail -1)
[ "$SHEET_GONE" = "closed" ] && ok "sheet: закрылась после выбора" || bad "sheet close" "state=$SHEET_GONE"

# =============================================================================
# B2. orders: табы → confirm DELIVERED → toast → таб «Завершён»
# =============================================================================
echo "=== B2. orders: табы + confirm DELIVERED ==="
agent-browser set viewport 1280 900 >/dev/null 2>&1
prep_page "$BASE/account/orders" 2000
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Фильтр заказов по статусу" && ok "orders: таб-фильтр статусов" || bad "orders tabs" "absent"
printf '%s' "$SNAP" | grep -q "Ожидает оплаты" && ok "orders: таб «Ожидает оплаты»" || bad "tab pending" "absent"
printf '%s' "$SNAP" | grep -q "$ONUM" && ok "orders: заказ $ONUM в списке" || bad "order row" "absent"
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Подтвердить получение')); if(!b) return 'none'; b.click(); return 'clicked'; })()" >/dev/null 2>&1
agent-browser wait 3000 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "спасибо за покупку" && ok "confirm: toast «…спасибо за покупку»" || bad "confirm toast" "absent"
agent-browser eval "(() => { const t=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')?.includes('status=COMPLETED')); t.click(); return 'tab'; })()" >/dev/null 2>&1
agent-browser wait 2000 >/dev/null 2>&1
URL_NOW=$(agent-browser get url 2>/dev/null)
printf '%s' "$URL_NOW" | grep -q "status=COMPLETED" && ok "orders: таб «Завершён» применился" || bad "tab completed" "url=$URL_NOW"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Завершён" && ok "orders: бейдж «Завершён»" || bad "completed badge" "absent"
shot "$CTX/s5b1-r3-orders.png"

# =============================================================================
# B3. баланс обновился после confirm (эскроу-release + бонус)
# =============================================================================
echo "=== B3. баланс вырос после confirm ==="
prep_page "$BASE/account" 2000
BAL_AFTER=$(bal_line)
if [ "$BAL_BEFORE" != "$BAL_AFTER" ] && [ "$BAL_AFTER" != "absent" ]; then
  ok "balance updated: было [$BAL_BEFORE] → стало [$BAL_AFTER]"
else
  bad "balance updated" "before=[$BAL_BEFORE] after=[$BAL_AFTER]"
fi

# =============================================================================
# B4. favorites: 2 сердца на каталоге → grid 2 → удалить 1 → grid 1
# =============================================================================
echo "=== B4. favorites: сердца + grid ==="
prep_page "$BASE/catalog" 2000
HEARTS=$(agent-browser eval "(() => { const b=[...document.querySelectorAll('button[aria-label^=\"Добавить в избранное\"]')].slice(0,2); b.forEach(x=>x.click()); return b.length; })()" 2>/dev/null | tail -1)
[ "$HEARTS" = "2" ] && ok "catalog: кликнули 2 сердца" || bad "hearts click" "count=$HEARTS"
agent-browser wait 2500 >/dev/null 2>&1
FILLED=$(agent-browser eval "document.querySelectorAll('button[aria-label^=\"Удалить из избранного\"]').length" 2>/dev/null | tail -1)
[ "$FILLED" = "2" ] && ok "catalog: 2 сердца заполнены (aria переключился)" || bad "hearts filled" "count=$FILLED"
prep_page "$BASE/account/favorites" 2000
CNT=$(agent-browser eval "document.querySelectorAll('button[aria-label^=\"Удалить из избранного\"]').length" 2>/dev/null | tail -1)
[ "$CNT" = "2" ] && ok "favorites grid: 2 товара" || bad "grid count" "count=$CNT"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Избранное" && ok "favorites: заголовок страницы" || bad "fav title" "absent"
shot "$CTX/s5b1-r3-favorites.png"
agent-browser eval "document.querySelector('button[aria-label^=\"Удалить из избранного\"]').click()" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
CNT=$(agent-browser eval "document.querySelectorAll('button[aria-label^=\"Удалить из избранного\"]').length" 2>/dev/null | tail -1)
[ "$CNT" = "1" ] && ok "favorites: после удаления 1 товар" || bad "grid after remove" "count=$CNT"

# =============================================================================
# B5. profile: PATCH + адресная книга CRUD
# =============================================================================
echo "=== B5. profile + address CRUD ==="
prep_page "$BASE/account/profile" 2000
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Профиль" && ok "profile: форма открыта" || bad "profile open" "absent"
agent-browser eval "(() => { const el=document.querySelector('#profile-phone'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,'+7 (900) 555-77-88'); el.dispatchEvent(new Event('input',{bubbles:true})); return el.value; })()" >/dev/null 2>&1
agent-browser eval "(() => { const el=document.querySelector('#profile-city'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,'Тула'); el.dispatchEvent(new Event('input',{bubbles:true})); return el.value; })()" >/dev/null 2>&1
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Сохранить')); b.click(); return 'saved'; })()" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Профиль сохранён" && ok "profile: toast «Профиль сохранён»" || bad "profile toast" "absent"
# адрес: открыть диалог, заполнить 6 обязательных, отправить
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Добавить адрес') && !x.closest('[role=\"dialog\"]')); b.click(); return 'open'; })()" >/dev/null 2>&1
agent-browser wait 1000 >/dev/null 2>&1
for pair in "addr-label:Дом-браузер" "addr-recipient:Анна Петрова" "addr-phone:+7 (900) 222-33-44" "addr-city:Тула" "addr-street:ул. Металлургов" "addr-house:12"; do
  ID="${pair%%:*}"; VAL="${pair#*:}"
  agent-browser eval "(() => { const el=document.querySelector('#$ID'); const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; s.call(el,'$VAL'); el.dispatchEvent(new Event('input',{bubbles:true})); return el.value; })()" >/dev/null 2>&1
done
agent-browser eval "(() => { const f=document.querySelector('[role=\"dialog\"] form'); f.requestSubmit(); return 'submit'; })()" >/dev/null 2>&1
agent-browser wait 2500 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Адрес добавлен" && ok "address: toast «Адрес добавлен»" || bad "addr toast" "absent"
printf '%s' "$SNAP" | grep -q "Дом-браузер" && ok "address: карточка «Дом-браузер» в списке" || bad "addr card" "absent"
# дефолт + удаление
agent-browser eval "(() => { const b=document.querySelector('button[aria-label^=\"Сделать\"]'); b.click(); return b.getAttribute('aria-label'); })()" >/dev/null 2>&1
agent-browser wait 2000 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "адрес по умолчанию" && ok "address: toast «…адрес по умолчанию»" || bad "default toast" "absent"
printf '%s' "$SNAP" | grep -q "По умолчанию" && ok "address: бейдж «По умолчанию»" || bad "default badge" "absent"
agent-browser eval "(() => { const b=document.querySelector('button[aria-label^=\"Удалить «\"]'); b.click(); return b.getAttribute('aria-label'); })()" >/dev/null 2>&1
agent-browser wait 2000 >/dev/null 2>&1
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "удалён" && ok "address: toast «…удалён»" || bad "delete toast" "absent"
ADDR_LEFT=$(agent-browser eval "document.querySelectorAll('button[aria-label^=\"Изменить\"]').length" 2>/dev/null | tail -1)
[ "$ADDR_LEFT" = "0" ] && ok "address: список пуст после удаления" || bad "addr empty" "count=$ADDR_LEFT"
shot "$CTX/s5b1-r3-profile.png"

# =============================================================================
# B6. консоль: 0 ошибок
# =============================================================================
echo "=== B6. консоль ==="
CONSOLE_ERR=$(agent-browser console 2>/dev/null | grep -ciE "\berror\b" || true)
PAGE_ERR=$(agent-browser errors 2>/dev/null | grep -cv "No page errors\|^$" || true)
if [ "${CONSOLE_ERR:-0}" = "0" ] && [ "${PAGE_ERR:-0}" = "0" ]; then
  ok "console errors = 0 (console=$CONSOLE_ERR, page=$PAGE_ERR)"
else
  bad "console errors" "console=$CONSOLE_ERR page=$PAGE_ERR"
fi

# =============================================================================
# B7. mobile 390: scrollWidth == 390 ×4 страниц
# =============================================================================
echo "=== B7. mobile 390 ==="
agent-browser set viewport 390 844 >/dev/null 2>&1
for P in /account /account/orders /account/favorites /account/profile; do
  prep_page "$BASE$P" 1500
  SW=$(agent-browser eval "document.documentElement.scrollWidth" 2>/dev/null | tail -1)
  [ "${SW:-0}" = "390" ] && ok "mobile 390 $P scrollWidth=390" || bad "mobile 390 $P" "scrollWidth=$SW"
done
prep_page "$BASE/account" 1200
shot "$CTX/s5b1-r3-mobile-390.png"

# =============================================================================
# B8. dark-тема (переключатель в шапке)
# =============================================================================
echo "=== B8. dark-тема ==="
agent-browser set viewport 1280 900 >/dev/null 2>&1
prep_page "$BASE/account" 1500
agent-browser eval "document.querySelector('button[aria-label=\"Переключить тему\"]').click()" >/dev/null 2>&1
agent-browser wait 1200 >/dev/null 2>&1
DARK_ON=$(agent-browser eval "document.documentElement.classList.contains('dark') ? 'dark' : 'light'" 2>/dev/null | tail -1)
[ "$DARK_ON" = "dark" ] && ok "dark: класс .dark применён" || bad "dark class" "state=$DARK_ON"
SNAP=$(agent-browser snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Бонусный баланс" && ok "dark: /account рендерится" || bad "dark page" "absent"
shot "$CTX/s5b1-r3-dark.png"
agent-browser eval "document.querySelector('button[aria-label=\"Переключить тему\"]').click()" >/dev/null 2>&1
agent-browser wait 600 >/dev/null 2>&1

echo ""
echo "==============================================="
echo "S5B1 BROWSER: PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" = "0" ]; then echo "BROWSER GATE: GREEN"; else echo "BROWSER GATE: RED"; fi
exit 0
