#!/bin/bash
# =============================================================================
# s5b3-r3-browser.sh — S5B3-R3 browser-гейт (agent-browser). Паттерн
# s5b2-r3-browser.sh: dedicated --session + curl-warmup + wait --text polling
# + dbcheck-проверки сквозных действий (UI → API → DB).
#
# Флоу: admin login (cookie-injection) → /admin обзор (метрики) →
# /admin/moderation: UI-approve pending-товара (создан curl-ом как
# confectioner) → тост «Товар одобрен…» + db approved → /admin/tickets:
# fresh seed T-S5B3-DEMO → UI-ответ → тост «взята в работу» + db in_progress →
# /admin/email: XSS-письмо через SafeHtml-диалог (window.__xss undefined,
# alert не вызван — перехвачен, <script> в отрендеренном теле отсутствует) →
# /admin/settings: bonus_percent 7 → тост аудита + db 7 → возврат 5 →
# /admin/payouts рендерится → dark-тема → mobile 390 scrollWidth==390 на
# /admin, /admin/moderation, /admin/tickets, /admin/email → console 0.
# Скриншоты: s5b3-r3-{overview,moderation,tickets,email-xss,settings,
# mobile-390,dark}.png
# =============================================================================
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
V2="/home/z/my-project/conditera-v2"
SESS="s5b3r3-$(date +%s)"
RUNTAG="s5b3ui-$(date +%s)"
TITLE="Торт S5B3 Браузер $RUNTAG"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
AB()   { agent-browser --session "$SESS" "$@"; }
dbcheck() { (cd "$V2" && bun scripts/db/s5b3-dbcheck.ts "$@" 2>/dev/null); }

# --- dev lift ------------------------------------------------------------------
if ! curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then
  echo "… dev :3100 не отвечает — поднимаем"
  for pid in $(lsof -ti tcp:3100 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done
  sleep 1; rm -f "$V2/.next/dev/lock"
  (cd "$V2" && env -u DATABASE_URL setsid nohup bun run dev > /tmp/dev-v2.log 2>&1 < /dev/null & disown)
  for i in $(seq 1 90); do
    if curl -s -o /dev/null --max-time 3 "$BASE/api/health"; then echo "… health OK (${i}s)"; break; fi
    sleep 1
  done
fi

# --- helpers -------------------------------------------------------------------
ni() { timeout 6 AB wait --load networkidle >/dev/null 2>&1 || true; }
load_text() { # текст — ждём до 15с. AB wait --text флакует в этой песочнице
  # (timeout 4 недостаточно при dev-компиляции), поэтому поллим snapshot-grep —
  # тот же источник, что и все последующие контент-проверки.
  for i in $(seq 1 15); do
    if timeout 10 AB snapshot 2>/dev/null | grep -q "$1"; then return 0; fi
    sleep 1
  done
  return 1
}
login_cookie() { # email jar
  rm -f "$2"
  curl -s -m 30 -c "$2" -b "$2" -X POST -H "Content-Type: application/json" \
    "$BASE/api/auth/login" -d "{\"email\":\"$1\",\"password\":\"Demo123!\"}" -o /dev/null
  awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$2" | tail -1
}
csrf_post() { # jar url body -> "<code>|<body>"
  local jar="$1" url="$2" body="$3"
  local token; token=$(curl -s -b "$jar" -c "$jar" "$BASE/api/csrf" | jq -r '.token // empty')
  local res
  res=$(curl -s --max-time 60 -w $'\n%{http_code}' -b "$jar" -c "$jar" \
        -X POST -H "Content-Type: application/json" -H "X-CSRF-Token: $token" \
        -d "$body" "$BASE$url")
  printf '%s' "$res" | tr '\n' '|'
}
shot() { AB screenshot "$1" >/dev/null 2>&1; [ -s "$1" ] && ok "screenshot $(basename "$1")" || bad "screenshot $(basename "$1")" "no file"; }
# React controlled input: native setter + input-событие
js_fill() { # selector value
  AB eval "(() => { const el = document.querySelector('$1'); if (!el) return 'no-el';
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, '$2');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled'; })()" 2>/dev/null | tail -1
}

# =============================================================================
echo "=== S5B3-R3 browser-гейт ==="

# --- Подготовка данных (curl): pending-товар + свежий тикет + id XSS-письма ---
JA=/tmp/s5b3-r3-ja.txt; rm -f "$JA"
CODE=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -c "$JA" -b "$JA" -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login")
[ "$CODE" = "200" ] && ok "warmup: admin login (curl)" || bad "warmup admin login" "code=$CODE"

J1=/tmp/s5b3-r3-j1.txt; rm -f "$J1"
curl -s -m 30 -o /dev/null -c "$J1" -b "$J1" -X POST -H "Content-Type: application/json" \
  -d '{"email":"confectioner@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login"
CATID=$(curl -s -m 30 "$BASE/api/categories" | jq -r '.items[0].id // empty')
res=$(csrf_post "$J1" "/api/vendor/products" "{\"title\":\"$TITLE\",\"description\":\"UI-гейт S5B3\",\"priceRub\":\"1600\",\"categoryId\":\"$CATID\",\"ingredients\":[\"мука\"],\"allergens\":[],\"images\":[],\"isAvailable\":true}")
res_code=${res##*|} # csrf_post возвращает "body|code" (tr \n → |): код в ХВОСТЕ
[ "$res_code" = "201" ] && ok "подготовка: pending-товар создан (201)" || bad "pending-товар" "code=$res_code"
PSLUG=$(printf '%s' "$res" | sed 's/^|//' | jq -r '.product.slug // empty' 2>/dev/null)

(cd "$V2" && set -a && . ./.env.local && set +a && bun scripts/db/s5b3-ticket-seed.ts >/dev/null 2>&1)
TSTATUS=$(dbcheck ticket-by-number "T-S5B3-DEMO" | jq -r '.status')
[ "$TSTATUS" = "open" ] && ok "подготовка: тикет T-S5B3-DEMO пересоздан (open)" || bad "тикет seed" "status=$TSTATUS"

XEID=$(dbcheck email-by-subject "XSS probe" | jq -r '.id // empty')
[ -n "$XEID" ] && ok "подготовка: XSS-письмо в БД" || bad "XSS-письмо" "id пуст"

# --- Warmup маршрутов (curl, dev-компиляция on-demand) -------------------------
for p in /admin /admin/moderation /admin/tickets /admin/email /admin/settings /admin/payouts; do
  curl -s -o /dev/null -m 60 -b "$JA" "$BASE$p"
done
ok "warmup: маршруты админки прогреты"

# =============================================================================
# Логин admin (cookie-injection) + /admin обзор
# =============================================================================
AB close --all >/dev/null 2>&1
AB set viewport 1280 900 >/dev/null 2>&1
timeout 40 AB open "$BASE/" >/dev/null 2>&1
ni; AB wait 800 >/dev/null 2>&1
AB cookies clear >/dev/null 2>&1
TOKEN=$(login_cookie "admin@demo.ru" /tmp/s5b3-r3-jar.txt)
[ -n "$TOKEN" ] && ok "login admin@demo.ru (cookie-injection)" || bad "login admin" "no session cookie"
AB cookies set "sb-127-auth-token" "$TOKEN" >/dev/null 2>&1
AB eval 'window.alert = () => { window.__alertFired = true; return undefined; }; typeof window.__alertFired' >/dev/null 2>&1
AB console --clear >/dev/null 2>&1
AB errors --clear >/dev/null 2>&1

timeout 40 AB open "$BASE/admin" >/dev/null 2>&1
ni; AB wait 2500 >/dev/null 2>&1
load_text "Обзор платформы" && ok "overview: «Обзор платформы»" || bad "overview h1" "timeout"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Товары на модерации" && ok "overview: метрика «Товары на модерации»" || bad "overview метрика" "absent"
printf '%s' "$SNAP" | grep -q "Выручка (30 дней)" && ok "overview: метрика «Выручка (30 дней)»" || bad "overview выручка" "absent"
printf '%s' "$SNAP" | grep -q "Последние административные действия" && ok "overview: журнал admin_actions" || bad "overview журнал" "absent"
printf '%s' "$SNAP" | grep -q "ADMIN" && ok "overview: бейдж роли ADMIN" || bad "overview бейдж" "absent"
shot "$CTX/s5b3-r3-overview.png"

# --- /admin/moderation: UI-approve pending-товара -------------------------------
timeout 40 AB open "$BASE/admin/moderation" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "Товары (" && ok "moderation: вкладка «Товары»" || bad "moderation вкладка" "timeout"
CLICK=$(AB eval "(() => {
  const rows = [...document.querySelectorAll('tbody tr')];
  const row = rows.find(r => r.textContent.includes('$TITLE'));
  if (!row) return 'no-row';
  const btn = [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Одобрить');
  if (!btn) return 'no-btn';
  btn.click();
  return 'clicked'; })()" 2>/dev/null | tail -1)
[ "$CLICK" = '"clicked"' ] && ok "moderation: «Одобрить» в строке товара нажата" || bad "moderation approve click" "$CLICK"
load_text "Товар одобрен и появится на витрине" && ok "moderation: тост «Товар одобрен…»" || bad "moderation toast" "timeout"
sleep 1
DBST=$(dbcheck product-by-slug "$PSLUG" | jq -r '.moderationStatus')
[ "$DBST" = "approved" ] && ok "moderation: UI→API→DB approved" || bad "moderation db" "status=$DBST"
shot "$CTX/s5b3-r3-moderation.png"

# --- /admin/tickets: UI-ответ поддержки ------------------------------------------
timeout 40 AB open "$BASE/admin/tickets" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "T-S5B3-DEMO" && ok "tickets: тикет в таблице" || bad "tickets таблица" "timeout"
CLICK=$(AB eval '(() => {
  const btn = document.querySelector("button[aria-label=\"Открыть тикет T-S5B3-DEMO\"]");
  if (!btn) return "no-btn";
  btn.click();
  return "clicked"; })()' 2>/dev/null | tail -1)
[ "$CLICK" = '"clicked"' ] && ok "tickets: диалог тикета открыт" || bad "tickets dialog" "$CLICK"
AB wait 800 >/dev/null 2>&1
FILL=$(js_fill "#ticket-reply" "Здравствуйте! Замену оформили — новый торт привезут завтра до 12:00. Приятного дня!")
[ "$FILL" = '"filled"' ] && ok "tickets: текст ответа введён" || bad "tickets fill" "$FILL"
CLICK=$(AB eval '(() => {
  const btn = [...document.querySelectorAll("button")].find(b => b.textContent.includes("Отправить ответ"));
  if (!btn) return "no-btn";
  btn.click();
  return "clicked"; })()' 2>/dev/null | tail -1)
[ "$CLICK" = '"clicked"' ] && ok "tickets: «Отправить ответ» нажата" || bad "tickets send" "$CLICK"
load_text "Ответ отправлен — тикет взят в работу" && ok "tickets: тост «взята в работу»" || bad "tickets toast" "timeout"
sleep 1
DBT=$(dbcheck ticket-by-number "T-S5B3-DEMO" | jq -r '.status')
[ "$DBT" = "in_progress" ] && ok "tickets: UI→API→DB in_progress" || bad "tickets db" "status=$DBT"
SNAP=$(AB snapshot 2>/dev/null)
# Ответ в треде рендерится с authorName админа ("Демо-администратор"),
# а не с ролью-лейблом — проверяем текст ответа (UI-доказательство треда;
# authorRole=support проверен db-гейтом матрицы).
printf '%s' "$SNAP" | grep -q "Замену оформили" && ok "tickets: ответ поддержки в треде" || bad "tickets тред" "absent"
shot "$CTX/s5b3-r3-tickets.png"
AB press Escape >/dev/null 2>&1
AB wait 500 >/dev/null 2>&1

# --- /admin/email: XSS-письмо через SafeHtml-диалог ------------------------------
timeout 40 AB open "$BASE/admin/email" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "XSS probe" && ok "email: письмо в списке" || bad "email список" "timeout"
AB eval 'window.alert = () => { window.__alertFired = true; return undefined; }; "armed"' >/dev/null 2>&1
CLICK=$(AB eval '(() => {
  const btn = [...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || "").startsWith("Открыть письмо «S5B3 XSS probe"));
  if (!btn) return "no-btn";
  btn.click();
  return "clicked"; })()' 2>/dev/null | tail -1)
[ "$CLICK" = '"clicked"' ] && ok "email: диалог XSS-письма открыт" || bad "email dialog" "$CLICK"
load_text "promo-2026.pdf" && ok "email: вложение promo-2026.pdf в диалоге" || bad "email вложение" "timeout"
sleep 1
XSS1=$(AB eval 'typeof window.__xss' 2>/dev/null | tail -1)
[ "$XSS1" = '"undefined"' ] && ok "email: window.__xss undefined (script вырезан)" || bad "window.__xss" "$XSS1"
XSS2=$(AB eval 'window.__alertFired === true ? "alert-fired" : "no-alert"' 2>/dev/null | tail -1)
[ "$XSS2" = '"no-alert"' ] && ok "email: alert не вызван (перехват)" || bad "alert" "$XSS2"
XSS3=$(AB eval '(() => { const el = document.querySelector("[data-testid=email-html-body]");
  if (!el) return "no-body";
  return el.innerHTML.includes("<script") || /onerror/i.test(el.innerHTML) ? "dirty" : "clean"; })()' 2>/dev/null | tail -1)
[ "$XSS3" = '"clean"' ] && ok "email: тело санитизировано (no <script>/onerror)" || bad "sanitize body" "$XSS3"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "window.__xss" && bad "email: маркер payload просочился в DOM" "window.__xss найден" || ok "email: payload-маркер отсутствует в DOM"
shot "$CTX/s5b3-r3-email-xss.png"
AB press Escape >/dev/null 2>&1
AB wait 500 >/dev/null 2>&1

# --- /admin/settings: bonus_percent 7 → тост + db → возврат 5 --------------------
timeout 40 AB open "$BASE/admin/settings" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "Процент начисления бонусов" && ok "settings: карточка bonus_percent" || bad "settings карточка" "timeout"
FILL=$(js_fill "#setting-bonus_percent" "7")
[ "$FILL" = '"filled"' ] && ok "settings: значение 7 введено" || bad "settings fill" "$FILL"
CLICK=$(AB eval '(() => {
  const input = document.querySelector("#setting-bonus_percent");
  if (!input) return "no-input";
  let el = input;
  for (let i = 0; i < 8 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const btn = [...el.querySelectorAll("button")].find(b => b.textContent.includes("Сохранить"));
    if (btn) { btn.click(); return "clicked"; }
  }
  return "no-btn"; })()' 2>/dev/null | tail -1)
[ "$CLICK" = '"clicked"' ] && ok "settings: «Сохранить» нажата" || bad "settings save" "$CLICK"
load_text "сохранена и записана в аудит" && ok "settings: тост аудита" || bad "settings toast" "timeout"
sleep 1
DBV=$(dbcheck setting-value bonus_percent | jq -r '.value')
[ "$DBV" = "7" ] && ok "settings: UI→API→DB value=7" || bad "settings db" "value=$DBV"
js_fill "#setting-bonus_percent" "5" >/dev/null 2>&1
AB eval '(() => {
  const input = document.querySelector("#setting-bonus_percent");
  let el = input;
  for (let i = 0; i < 8 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const btn = [...el.querySelectorAll("button")].find(b => b.textContent.includes("Сохранить"));
    if (btn) { btn.click(); return "clicked"; }
  }
  return "no-btn"; })()' >/dev/null 2>&1
load_text "сохранена и записана в аудит" >/dev/null 2>&1
sleep 1
DBV2=$(dbcheck setting-value bonus_percent | jq -r '.value')
[ "$DBV2" = "5" ] && ok "settings: возврат 5" || bad "settings restore" "value=$DBV2"
shot "$CTX/s5b3-r3-settings.png"

# --- /admin/payouts: очередь рендерится ------------------------------------------
timeout 40 AB open "$BASE/admin/payouts" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "Выплаты исполнителям" && ok "payouts: «Выплаты исполнителям»" || bad "payouts h1" "timeout"
SNAP=$(AB snapshot 2>/dev/null)
printf '%s' "$SNAP" | grep -q "Очередь\|выплат\|Статус" && ok "payouts: очередь/таблица рендерится" || bad "payouts очередь" "absent"

# --- dark-тема на /admin/moderation ----------------------------------------------
timeout 40 AB open "$BASE/admin/moderation" >/dev/null 2>&1
ni; AB wait 1500 >/dev/null 2>&1
CLICK=$(AB eval 'document.querySelector("button[aria-label*=тему]") ? "btn" : "no-btn"' 2>/dev/null | tail -1)
if [ "$CLICK" = '"btn"' ]; then
  AB eval 'document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
else
  bad "dark: кнопка темы" "not found ($CLICK)"
fi
DARK_STATE=""
for i in $(seq 1 10); do
  DARK_STATE=$(AB eval 'document.documentElement.classList.contains("dark") ? "dark" : "light"' 2>/dev/null | tail -1)
  [ "$DARK_STATE" = '"dark"' ] && break
  AB wait 1000 >/dev/null 2>&1
done
[ "$DARK_STATE" = '"dark"' ] && ok "dark: класс .dark применён" || bad "dark class" "state=$DARK_STATE"
load_text "Товары (" >/dev/null 2>&1
shot "$CTX/s5b3-r3-dark.png"
AB eval 'document.querySelector("button[aria-label*=тему]") && document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
AB wait 800 >/dev/null 2>&1

# --- mobile 390: scrollWidth == 390 ----------------------------------------------
AB set viewport 390 844 >/dev/null 2>&1
MOBILE_OK=1
for p in /admin /admin/moderation /admin/tickets /admin/email; do
  timeout 40 AB open "$BASE$p" >/dev/null 2>&1
  ni; AB wait 1500 >/dev/null 2>&1
  SW=$(AB eval 'document.documentElement.scrollWidth' 2>/dev/null | tail -1)
  if [ "${SW:-0}" = '"390"' ]; then ok "mobile 390 $p scrollWidth=390"; else bad "mobile 390 $p" "scrollWidth=$SW"; MOBILE_OK=0; fi
done
[ "$MOBILE_OK" = "1" ] && shot "$CTX/s5b3-r3-mobile-390.png" || { timeout 40 AB open "$BASE/admin" >/dev/null 2>&1; ni; shot "$CTX/s5b3-r3-mobile-390.png"; }

# --- console errors за весь тур ---------------------------------------------------
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
