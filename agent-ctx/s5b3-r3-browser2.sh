#!/bin/bash
# =============================================================================
# s5b3-r3-browser2.sh — S5B3-R3-LAST дозахват 4 отсутствующих скриншотов
# (паттерн s5b3-r3-browser.sh; overview/moderation/tickets уже сняты ранее).
# Флоу: admin cookie-injection → /admin/email XSS-диалог (window.__xss
# undefined + alert перехвачен) → /admin/settings → dark /admin/moderation →
# mobile 390 /admin scrollWidth==390 → console errors 0.
# =============================================================================
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
V2="/home/z/my-project/conditera-v2"
SESS="s5b3r3b-$(date +%s)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad() { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
# NB: timeout не умеет exec-ить bash-функции — оборачиваем сам бинарник.
AB()  { timeout 45 agent-browser --session "$SESS" "$@"; }
ni()  { AB wait --load networkidle >/dev/null 2>&1 || true; }
load_text() {
  for i in $(seq 1 15); do
    if AB snapshot 2>/dev/null | grep -q "$1"; then return 0; fi
    sleep 1
  done
  return 1
}
shot() { AB screenshot "$1" >/dev/null 2>&1; [ -s "$1" ] && ok "screenshot $(basename "$1")" || bad "screenshot $(basename "$1")" "no file"; }

echo "=== S5B3-R3-LAST browser (4 shots) ==="
curl -s -o /dev/null --max-time 3 "$BASE/api/health" || { echo "dev :3100 down"; exit 1; }

# --- login (cookie-injection) ---------------------------------------------------
AB close --all >/dev/null 2>&1
AB set viewport 1280 900 >/dev/null 2>&1
AB open "$BASE/" >/dev/null 2>&1
ni; AB wait 800 >/dev/null 2>&1
AB cookies clear >/dev/null 2>&1
JAR=/tmp/s5b3-r3b-jar.txt; rm -f "$JAR"
curl -s -m 30 -c "$JAR" -b "$JAR" -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@demo.ru","password":"Demo123!"}' "$BASE/api/auth/login" -o /dev/null
TOKEN=$(awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$JAR" | tail -1)
[ -n "$TOKEN" ] && ok "login admin@demo.ru (cookie-injection)" || bad "login admin" "no cookie"
AB cookies set "sb-127-auth-token" "$TOKEN" >/dev/null 2>&1
AB console --clear >/dev/null 2>&1
AB errors --clear >/dev/null 2>&1

# --- 1) /admin/email: XSS-диалог --------------------------------------------------
AB open "$BASE/admin/email" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "XSS probe" && ok "email: письмо «XSS probe» в списке" || bad "email список" "timeout"
AB eval 'window.alert = () => { window.__alertFired = true; return undefined; }; "armed"' >/dev/null 2>&1
CLICK=$(AB eval '(() => {
  const btn = [...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") || "").startsWith("Открыть письмо «S5B3 XSS probe"));
  if (!btn) return "no-btn";
  btn.click();
  return "clicked"; })()' 2>/dev/null | tail -1)
[ "$CLICK" = '"clicked"' ] && ok "email: диалог XSS-письма открыт" || bad "email dialog" "$CLICK"
load_text "promo-2026.pdf" && ok "email: вложение в диалоге" || bad "email вложение" "timeout"
sleep 1
X1=$(AB eval 'typeof window.__xss' 2>/dev/null | tail -1)
[ "$X1" = '"undefined"' ] && ok "email: window.__xss undefined" || bad "__xss" "$X1"
X2=$(AB eval 'window.__alertFired === true ? "alert-fired" : "no-alert"' 2>/dev/null | tail -1)
[ "$X2" = '"no-alert"' ] && ok "email: alert не вызван" || bad "alert" "$X2"
X3=$(AB eval '(() => { const el = document.querySelector("[data-testid=email-html-body]");
  if (!el) return "no-body";
  return el.innerHTML.includes("<script") || /onerror/i.test(el.innerHTML) ? "dirty" : "clean"; })()' 2>/dev/null | tail -1)
[ "$X3" = '"clean"' ] && ok "email: тело санитизировано" || bad "sanitize" "$X3"
shot "$CTX/s5b3-r3-email-xss.png"
AB press Escape >/dev/null 2>&1; AB wait 500 >/dev/null 2>&1

# --- 2) /admin/settings ------------------------------------------------------------
AB open "$BASE/admin/settings" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
load_text "Процент начисления бонусов" && ok "settings: карточка bonus_percent" || bad "settings карточка" "timeout"
BV=$(AB eval 'document.querySelector("#setting-bonus_percent") ? "el" : "no-el"' 2>/dev/null | tail -1)
[ "$BV" = '"el"' ] && ok "settings: input bonus_percent" || bad "settings input" "$BV"
shot "$CTX/s5b3-r3-settings.png"

# --- 3) dark на /admin/moderation --------------------------------------------------
AB open "$BASE/admin/moderation" >/dev/null 2>&1
ni; AB wait 1500 >/dev/null 2>&1
CLICK=$(AB eval 'document.querySelector("button[aria-label*=тему]") ? "btn" : "no-btn"' 2>/dev/null | tail -1)
if [ "$CLICK" = '"btn"' ]; then
  AB eval 'document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
else
  bad "dark: кнопка темы" "$CLICK"
fi
DARK=""
for i in $(seq 1 10); do
  DARK=$(AB eval 'document.documentElement.classList.contains("dark") ? "dark" : "light"' 2>/dev/null | tail -1)
  [ "$DARK" = '"dark"' ] && break
  AB wait 1000 >/dev/null 2>&1
done
[ "$DARK" = '"dark"' ] && ok "dark: класс .dark применён" || bad "dark class" "$DARK"
load_text "Товары (" >/dev/null 2>&1
shot "$CTX/s5b3-r3-dark.png"
AB eval 'document.querySelector("button[aria-label*=тему]") && document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
AB wait 800 >/dev/null 2>&1

# --- 4) mobile 390 на /admin --------------------------------------------------------
AB set viewport 390 844 >/dev/null 2>&1
AB open "$BASE/admin" >/dev/null 2>&1
ni; AB wait 2000 >/dev/null 2>&1
SW=$(AB eval 'document.documentElement.scrollWidth' 2>/dev/null | tail -1 | tr -d '"')
[ "${SW:-0}" = "390" ] && ok "mobile 390 /admin scrollWidth=390" || bad "mobile 390" "scrollWidth=$SW"
load_text "Обзор платформы" >/dev/null 2>&1
shot "$CTX/s5b3-r3-mobile-390.png"
AB set viewport 1280 900 >/dev/null 2>&1

# --- console/page errors -------------------------------------------------------------
CE=$(AB console 2>/dev/null | grep -ciE "\berror\b" || true)
PE=$(AB errors 2>/dev/null | grep -cv "No page errors\|^$" || true)
if [ "$CE" = "0" ] && [ "$PE" = "0" ]; then
  ok "console errors = 0 (console=$CE, page=$PE)"
else
  bad "console errors" "console=$CE page=$PE"
fi

AB close --all >/dev/null 2>&1
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" = "0" ] && exit 0 || exit 1
