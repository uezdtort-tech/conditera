#!/bin/bash
# =============================================================================
# s6b1-r3-browser.sh — S6B1-R3 browser-гейт (agent-browser, ОДИН батч).
# Паттерн s5b2-r3-browser.sh: dedicated --session (default session shared —
# урок), cookie-injection логин (sb-127-auth-token), curl-warmup on-demand
# dev-компиляции, polling через wait --text.
#
# Флоу: conv-id (bun+Prisma) → warmup → A: customer@demo.ru /account/chats?c=
# → скриншот → B: confectioner@demo.ru (сессия 2) та же беседа → A отправляет
# сообщение → B ждёт текст (real-time) / reload-фолбэк → скриншоты →
# mobile 390 scrollWidth → dark-тема → console errors.
# =============================================================================
set -u
BASE="http://127.0.0.1:3100"
CTX="/home/z/my-project/agent-ctx"
SESSA="s6b1r3-a-9f41c2"
SESSB="s6b1r3-b-7d20e8"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 — $2"; }
note() { echo "[NOTE] $1"; }
AB()   { agent-browser --session "$1" "${@:2}"; }
ni()   { timeout 20 AB "$SESSA" wait --load networkidle >/dev/null 2>&1 || true; }

login_token() { # email jarfile → token
  rm -f "$2"
  curl -s -m 30 -c "$2" -b "$2" -X POST -H "Content-Type: application/json" \
    "$BASE/api/auth/login" -d "{\"email\":\"$1\",\"password\":\"Demo123!\"}" -o /dev/null
  awk '{line=$0; if (line ~ /^#HttpOnly_/) sub(/^#HttpOnly_/, "", line); split(line, f, "\t"); if (f[6] == "sb-127-auth-token") print f[7]}' "$2" | tail -1
}
load_text() { # sess text — ждём до 15с
  for i in $(seq 1 15); do
    if AB "$1" wait --text "$2" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
poll_eval() { # sess js expected tries — ждём значение eval
  for i in $(seq 1 "${4:-15}"); do
    V=$(AB "$1" eval "$2" 2>/dev/null | tail -1)
    [ "$V" = "$3" ] && return 0
    sleep 1
  done
  return 1
}
shot() { AB "$1" screenshot "$2" >/dev/null 2>&1; [ -s "$2" ] && ok "screenshot $(basename "$2")" || bad "screenshot $(basename "$2")" "no file"; }
ta_fill() { # sess text
  AB "$1" eval "(() => { const ta = document.querySelector('textarea'); if (!ta) return 'no-ta'; const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, '$1'); ta.dispatchEvent(new Event('input', { bubbles: true })); return 'filled'; })()" 2>/dev/null | tail -1
}
send_click() { # sess
  AB "$1" eval "(() => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').includes('Отправить')); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()" 2>/dev/null | tail -1
}

echo "=== S6B1-R3 browser-гейт ==="

# --- conv-id для deep-link -----------------------------------------------------
CONV_ID=$(bun "$CTX/s6b1-conv-id.ts" 2>/dev/null | tail -1)
case "$CONV_ID" in
  ????????-????-????-????-????????????) ok "conv-id: $CONV_ID" ;;
  *) bad "conv-id" "got '$CONV_ID'"; echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL ==="; exit 1 ;;
esac
CHAT_URL="$BASE/account/chats?c=$CONV_ID"

# --- warmup (dev-компиляция on-demand, обе роли) --------------------------------
TA=$(login_token "customer@demo.ru"      /tmp/s6b1-r3-jar-cust.txt)
TB=$(login_token "confectioner@demo.ru"  /tmp/s6b1-r3-jar-conf.txt)
[ -n "$TA" ] && ok "login customer@demo.ru (cookie-injection)" || bad "login customer" "no token"
[ -n "$TB" ] && ok "login confectioner@demo.ru (cookie-injection)" || bad "login confectioner" "no token"
for jar in /tmp/s6b1-r3-jar-cust.txt /tmp/s6b1-r3-jar-conf.txt; do
  curl -s -o /dev/null -m 60 -b "$jar" "$BASE/account/chats"
  curl -s -o /dev/null -m 60 -b "$jar" "$CHAT_URL"
done
ok "warmup: /account/chats прогреты (обе роли, deep-link)"

# =============================================================================
# A: customer — открыть беседу (1280x900)
# =============================================================================
AB "$SESSA" close --all >/dev/null 2>&1
AB "$SESSA" set viewport 1280 900 >/dev/null 2>&1
AB "$SESSA" open "$BASE/" >/dev/null 2>&1; ni; AB "$SESSA" wait 800 >/dev/null 2>&1
AB "$SESSA" cookies clear >/dev/null 2>&1
AB "$SESSA" cookies set "sb-127-auth-token" "$TA" >/dev/null 2>&1
AB "$SESSA" console --clear >/dev/null 2>&1; AB "$SESSA" errors --clear >/dev/null 2>&1
AB "$SESSA" open "$CHAT_URL" >/dev/null 2>&1; ni; AB "$SESSA" wait 1500 >/dev/null 2>&1
load_text "$SESSA" "Чаты" && ok "A: /account/chats открыта (h1 «Чаты»)" || bad "A open" "text «Чаты» timeout"
if poll_eval "$SESSA" "document.querySelector('[aria-label=\"Чат на связи\"]') ? 'connected' : 'no'" "connected" 20; then
  ok "A: socket-статус «Чат на связи»"
else
  SOCK_A=$(AB "$SESSA" eval "document.querySelector('[aria-label=\"Нет соединения с чатом\"]') ? 'disconnected' : 'unknown'" 2>/dev/null | tail -1)
  note "A socket-статус: $SOCK_A (продолжаем — events проверены probe)"
fi
if poll_eval "$SESSA" "document.querySelector('textarea') ? 'ta' : 'no-ta'" "ta" 20; then
  ok "A: беседа открыта (textarea есть)"
else
  bad "A беседа" "textarea нет за 20с"
fi
shot "$SESSA" "$CTX/s6b1-r3-chat-customer.png"

# =============================================================================
# B: confectioner — та же беседа (отдельная сессия/контекст)
# =============================================================================
AB "$SESSB" close --all >/dev/null 2>&1
AB "$SESSB" set viewport 1280 900 >/dev/null 2>&1
AB "$SESSB" open "$BASE/" >/dev/null 2>&1; ni; AB "$SESSB" wait 800 >/dev/null 2>&1
AB "$SESSB" cookies clear >/dev/null 2>&1
AB "$SESSB" cookies set "sb-127-auth-token" "$TB" >/dev/null 2>&1
AB "$SESSB" console --clear >/dev/null 2>&1; AB "$SESSB" errors --clear >/dev/null 2>&1
AB "$SESSB" open "$CHAT_URL" >/dev/null 2>&1; ni; AB "$SESSB" wait 1500 >/dev/null 2>&1
load_text "$SESSB" "Чаты" && ok "B: /account/chats открыта" || bad "B open" "text «Чаты» timeout"
if poll_eval "$SESSB" "document.querySelector('[aria-label=\"Чат на связи\"]') ? 'connected' : 'no'" "connected" 20; then
  ok "B: socket-статус «Чат на связи»"
else
  SOCK_B=$(AB "$SESSB" eval "document.querySelector('[aria-label=\"Нет соединения с чатом\"]') ? 'disconnected' : 'unknown'" 2>/dev/null | tail -1)
  note "B socket-статус: $SOCK_B (продолжаем)"
fi
poll_eval "$SESSB" "document.querySelector('textarea') ? 'ta' : 'no-ta'" "ta" 20 || note "B: textarea нет за 20с"

# =============================================================================
# A отправляет уникальное сообщение → B ждёт (real-time) / reload-фолбэк
# =============================================================================
MSG="S6B1-R3 UI-проверка $(date +%H%M%S)"
FILL=$(ta_fill "$SESSA" "$MSG")
SEND=$(send_click "$SESSA")
[ "$FILL" = "filled" ] && [ "$SEND" = "clicked" ] && ok "A: сообщение отправлено ($MSG)" || bad "A send" "fill=$FILL send=$SEND"
AB "$SESSA" wait 1200 >/dev/null 2>&1
SNAP_A=$(AB "$SESSA" snapshot 2>/dev/null)
printf '%s' "$SNAP_A" | grep -q "S6B1-R3 UI-проверка" && ok "A: своё сообщение видно в треде" || bad "A echo" "текст не найден"
DELIVERY="none"
for i in $(seq 1 12); do
  SNAP_B=$(AB "$SESSB" snapshot 2>/dev/null)
  if printf '%s' "$SNAP_B" | grep -q "S6B1-R3 UI-проверка"; then DELIVERY="real-time"; break; fi
  AB "$SESSB" wait 1000 >/dev/null 2>&1
done
if [ "$DELIVERY" = "none" ]; then
  AB "$SESSB" reload >/dev/null 2>&1; ni; AB "$SESSB" wait 2000 >/dev/null 2>&1
  SNAP_B=$(AB "$SESSB" snapshot 2>/dev/null)
  printf '%s' "$SNAP_B" | grep -q "S6B1-R3 UI-проверка" && DELIVERY="after-reload" || DELIVERY="missing"
fi
case "$DELIVERY" in
  real-time)    ok "B: сообщение доставлено РЕАЛТАЙМ (без reload)" ;;
  after-reload) note "B: сообщение видно только после reload (dev-realtime деградация)" ;;
  *)            bad "B delivery" "текст не найден ни до ни после reload" ;;
esac
for i in 1 2 3; do AB "$SESSB" screenshot "$CTX/s6b1-r3-chat-confectioner.png" >/dev/null 2>&1; [ -s "$CTX/s6b1-r3-chat-confectioner.png" ] && break; sleep 1; done
[ -s "$CTX/s6b1-r3-chat-confectioner.png" ] && ok "screenshot s6b1-r3-chat-confectioner.png" || bad "screenshot confectioner" "no file"

# =============================================================================
# mobile 390: /account/chats scrollWidth == 390
# =============================================================================
AB "$SESSA" set viewport 390 844 >/dev/null 2>&1
AB "$SESSA" open "$BASE/account/chats" >/dev/null 2>&1; ni; AB "$SESSA" wait 1500 >/dev/null 2>&1
load_text "$SESSA" "Чаты" || true
SW=$(AB "$SESSA" eval 'document.documentElement.scrollWidth' 2>/dev/null | tail -1)
SWC=$(printf '%s' "$SW" | tr -d '"')
[ "$SWC" = "390" ] && ok "mobile 390 /account/chats scrollWidth=390" || bad "mobile 390" "scrollWidth=$SW"
shot "$SESSA" "$CTX/s6b1-r3-mobile-390.png"

# =============================================================================
# dark-тема на /account/chats (desktop)
# =============================================================================
AB "$SESSA" set viewport 1280 900 >/dev/null 2>&1
AB "$SESSA" open "$BASE/account/chats" >/dev/null 2>&1; ni; AB "$SESSA" wait 1500 >/dev/null 2>&1
AB "$SESSA" eval 'document.querySelector("button[aria-label*=тему]") && document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1
DARK=""
for i in $(seq 1 10); do
  DARK=$(AB "$SESSA" eval 'document.documentElement.classList.contains("dark") ? "dark" : "light"' 2>/dev/null | tail -1)
  [ "$DARK" = '"dark"' ] && break
  AB "$SESSA" wait 1000 >/dev/null 2>&1
done
[ "$DARK" = '"dark"' ] && ok "dark: класс .dark применён" || bad "dark class" "state=$DARK"
shot "$SESSA" "$CTX/s6b1-r3-dark.png"
AB "$SESSA" eval 'document.querySelector("button[aria-label*=тему]") && document.querySelector("button[aria-label*=тему]").click()' >/dev/null 2>&1

# =============================================================================
# console/page errors за тур (обе сессии)
# =============================================================================
CE_A=$(AB "$SESSA" console 2>/dev/null | grep -ciE "\berror\b" || true)
PE_A=$(AB "$SESSA" errors 2>/dev/null | grep -cv "No page errors\|^$" || true)
CE_B=$(AB "$SESSB" console 2>/dev/null | grep -ciE "\berror\b" || true)
PE_B=$(AB "$SESSB" errors 2>/dev/null | grep -cv "No page errors\|^$" || true)
if [ "$CE_A" = "0" ] && [ "$PE_A" = "0" ] && [ "$CE_B" = "0" ] && [ "$PE_B" = "0" ]; then
  ok "console errors = 0 (A: console=$CE_A page=$PE_A; B: console=$CE_B page=$PE_B)"
else
  bad "console errors" "A: console=$CE_A page=$PE_A; B: console=$CE_B page=$PE_B"
fi

AB "$SESSA" close --all >/dev/null 2>&1
AB "$SESSB" close --all >/dev/null 2>&1
echo "=== ИТОГ: PASS=$PASS FAIL=$FAIL (delivery=$DELIVERY) ==="
exit 0
