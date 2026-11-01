#!/bin/bash
# Chunk D2: TRUE reload hydrate test + Step 5 (guest merge) + Step 6 (PATCH)
cd /home/z/my-project
V=/home/z/my-project/agent-ctx/verify-cart

echo "=== [server] start (mem-capped) ==="
setsid nohup env NODE_OPTIONS="--max-old-space-size=2048" npm run dev >> dev.log 2>&1 < /dev/null &
disown
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://127.0.0.1:3000/)
  [ "$code" = "200" ] && { echo "server UP (poll $i)"; break; }
  sleep 3
done
[ "$code" != "200" ] && { echo "SERVER FAILED TO START"; exit 1; }

echo "=== [state] DB server cart now ==="
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"

echo "=== [HYDRATE TEST v2] close drawer, TRUE reload ==="
agent-browser press Escape 2>/dev/null
sleep 1
# close any open drawer/modal via Escape + click Close if present
CL=$(agent-browser snapshot -i -c | grep -oP 'button "Close".*?ref=\Ke[0-9]+' | head -1)
[ -n "$CL" ] && agent-browser click "@$CL" 2>/dev/null
sleep 1
agent-browser reload
agent-browser wait --load networkidle 2>/dev/null
sleep 5
echo "--- network cart+session after TRUE reload (expect NEW GET /api/auth/session AND GET /api/cart) ---"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -3
agent-browser network requests 2>&1 | grep "api/auth/session" | tail -2
CARTBTN=$(agent-browser snapshot -i -c | grep -oP 'button "Корзина".*?ref=\Ke[0-9]+' | head -1)
agent-browser click "@$CARTBTN"
sleep 2
echo "--- drawer after true reload (expect Наполеон from server) ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|Наполеон|шт|Оформить|пуста|Удалить" | head -12
CL=$(agent-browser snapshot -i -c | grep -oP 'button "(Close|Закрыть)".*?ref=\Ke[0-9]+' | head -1)
[ -n "$CL" ] && agent-browser click "@$CL" 2>/dev/null

echo "=== [step5] logout via UI ==="
SNAP=$(agent-browser snapshot -i -c)
AVREF=$(echo "$SNAP" | grep -oP 'button "ДЕ".*?ref=\Ke[0-9]+' | head -1)
echo "avatar: @$AVREF"
agent-browser click "@$AVREF"
sleep 2
SNAP=$(agent-browser snapshot -i -c)
echo "$SNAP" | grep -iE "Выйти|Профиль|Заказы" | head -6
OUTREF=$(echo "$SNAP" | grep -oP 'button "Выйти".*?ref=\Ke[0-9]+' | head -1)
echo "logout btn: @$OUTREF"
[ -z "$OUTREF" ] && { echo "FAIL: no logout button"; exit 1; }
agent-browser click "@$OUTREF"
sleep 3
agent-browser wait --load networkidle 2>/dev/null
echo "--- header after logout (expect Войти, no ДЕ) ---"
agent-browser snapshot -i -c | grep -E "button \"(ДЕ|Войти)\"" | head -3

echo "=== [step5] guest adds DIFFERENT product ==="
BEFORE=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
echo "cart api lines before guest add: $BEFORE"
agent-browser reload
agent-browser wait --load networkidle 2>/dev/null
sleep 2
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll up 4000 2>/dev/null; sleep 1
SNAP=$(agent-browser snapshot -i -c)
ADDREFS=$(echo "$SNAP" | grep -oP 'button "(В корзину|Добавить в корзину)".*?ref=\Ke[0-9]+')
echo "add buttons found:"; echo "$ADDREFS" | head -5
ADD2=$(echo "$ADDREFS" | sed -n '2p' | grep -oP 'e[0-9]+$')
echo "guest add button (2nd product): @$ADD2"
[ -z "$ADD2" ] && { echo "FAIL: no add button"; exit 1; }
agent-browser click "@$ADD2"
sleep 3
echo "--- drawer as guest ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Капкейк|Наполеон|Оформить|Удалить" | head -10
agent-browser screenshot $V/guest-cart.png
AFTER=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
echo "cart api lines after guest add: $AFTER (expect == BEFORE: no /api/cart as guest)"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -4
CL=$(agent-browser snapshot -i -c | grep -oP 'button "(Close|Закрыть)".*?ref=\Ke[0-9]+' | head -1)
[ -n "$CL" ] && agent-browser click "@$CL" 2>/dev/null

echo "=== [step5] login again → merge (expect push POST + GET reconcile) ==="
SNAP=$(agent-browser snapshot -i -c)
LOGIN_REF=$(echo "$SNAP" | grep -oP 'button "Войти".*?ref=\Ke[0-9]+' | head -1)
agent-browser click "@$LOGIN_REF"
sleep 2
SNAP2=$(agent-browser snapshot -i -c)
EMAIL_REF=$(echo "$SNAP2" | grep -oP 'textbox "Email".*?ref=\Ke[0-9]+' | head -1)
PASS_REF=$(echo "$SNAP2" | grep -oP 'textbox "Пароль".*?ref=\Ke[0-9]+' | head -1)
SUBMIT_REF=$(echo "$SNAP2" | grep -oP 'button "Войти".*?ref=\Ke[0-9]+' | tail -1)
agent-browser fill "@$EMAIL_REF" "customer@demo.ru"
agent-browser fill "@$PASS_REF" "Demo123!"
agent-browser click "@$SUBMIT_REF"
echo "--- waiting for new POST (push) and GET (reconcile) ---"
for i in $(seq 1 15); do
  PL=$(agent-browser network requests --filter cart 2>&1 | grep -E "(POST|GET) http://127.0.0.1:3000/api/cart" | tail -3)
  NP=$(echo "$PL" | grep -cE "POST http://127.0.0.1:3000/api/cart \(Fetch\) [0-9]{3}$")
  echo "poll $i:"; echo "$PL"
  [ "$NP" -ge 1 ] && break
  sleep 2
done
sleep 4
echo "--- drawer after login-merge (expect BOTH Наполеон + guest item) ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Наполеон|Капкейк|Макаронс|Оформить|Удалить|пуста" | head -14
agent-browser screenshot $V/cart-merge.png
echo "--- DB after merge ---"
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"
echo "=== chunk D2 done (browser left open) ==="
