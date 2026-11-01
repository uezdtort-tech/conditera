#!/bin/bash
# Chunk C: browser flow — Steps 1..4 (login, add, reload persistence, remove)
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

echo "=== [reset] clean cart via API (fresh start) ==="
curl -s -c /tmp/cj.txt -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"customer@demo.ru","password":"Demo123!"}' -o /tmp/login.json -w "login: %{http_code}\n"
node -e "require('fs').writeFileSync('/tmp/tok.txt', require('/tmp/login.json').accessToken||'')"
curl -s -b /tmp/cj.txt -X DELETE "http://127.0.0.1:3000/api/cart?all=1" -H "Authorization: Bearer $(cat /tmp/tok.txt)" -w "\nclear cart: %{http_code}\n"
node $V/dbq.cjs "SELECT count(*) FROM cart_items WHERE user_id='11111111-1111-4111-8111-111111111106'"

echo "=== [warm] routes ==="
curl -s -o /dev/null -w "csrf-token: %{http_code} in %{time_total}s\n" http://127.0.0.1:3000/api/csrf-token
curl -s -b /tmp/cj.txt -o /dev/null -w "GET /api/cart: %{http_code} in %{time_total}s\n" http://127.0.0.1:3000/api/cart
curl -s -b /tmp/cj.txt -X PATCH http://127.0.0.1:3000/api/cart/00000000-0000-0000-0000-000000000000 -H "Content-Type: application/json" -H "x-csrf-token: $(curl -s http://127.0.0.1:3000/api/csrf-token | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token||''))")" -H "Authorization: Bearer $(cat /tmp/tok.txt)" -d '{"quantity":1}' -o /dev/null -w "PATCH /api/cart/[id] (404 warm): %{http_code} in %{time_total}s\n"
curl -s -b /tmp/cj.txt -X DELETE "http://127.0.0.1:3000/api/cart?id=00000000-0000-0000-0000-000000000000" -H "Authorization: Bearer $(cat /tmp/tok.txt)" -o /dev/null -w "DELETE /api/cart (warm): %{http_code} in %{time_total}s\n"

echo "=== [browser] STEP 0: state check + fresh reload ==="
agent-browser open http://127.0.0.1:3000 || exit 1
agent-browser wait --load networkidle 2>/dev/null
sleep 2
SNAP=$(agent-browser snapshot -i -c)
echo "--- header now ---"
echo "$SNAP" | grep -E "button \"(ДЕ|Войти)\"" | head -3

ISLOG=$(echo "$SNAP" | grep -cP 'button "ДЕ"')
if [ "$ISLOG" = "0" ]; then
  echo "=== [step1] LOGIN via UI ==="
  CLOSE_REF=$(echo "$SNAP" | grep -oP 'button "Закрыть".*?ref=\Ke[0-9]+' | head -1)
  [ -n "$CLOSE_REF" ] && agent-browser click "@$CLOSE_REF" 2>/dev/null
  SNAP=$(agent-browser snapshot -i -c)
  LOGIN_REF=$(echo "$SNAP" | grep -oP 'button "Войти".*?ref=\Ke[0-9]+' | head -1)
  agent-browser click "@$LOGIN_REF"
  sleep 2
  SNAP2=$(agent-browser snapshot -i -c)
  EMAIL_REF=$(echo "$SNAP2" | grep -oP 'textbox "Email".*?ref=\Ke[0-9]+' | head -1)
  PASS_REF=$(echo "$SNAP2" | grep -oP 'textbox "Пароль".*?ref=\Ke[0-9]+' | head -1)
  SUBMIT_REF=$(echo "$SNAP2" | grep -oP 'button "Войти".*?ref=\Ke[0-9]+' | tail -1)
  echo "EMAIL=@$EMAIL_REF PASS=@$PASS_REF SUBMIT=@$SUBMIT_REF"
  agent-browser fill "@$EMAIL_REF" "customer@demo.ru"
  agent-browser fill "@$PASS_REF" "Demo123!"
  agent-browser click "@$SUBMIT_REF"
  sleep 4
  agent-browser wait --load networkidle 2>/dev/null
else
  echo "=== [step1] already logged in from previous chunk (session persisted) ==="
fi
sleep 1
SNAP3=$(agent-browser snapshot -i -c)
echo "--- header after login (expect ДЕ avatar) ---"
echo "$SNAP3" | grep -E "button \"(ДЕ|Войти|Корзина)\"" | head -4
agent-browser screenshot $V/step1-logged-in.png
echo "--- network: auth+cart (reconcile on login) ---"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -3

echo "=== [step2] add product via UI ==="
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll up 4000 2>/dev/null; sleep 1
SNAP4=$(agent-browser snapshot -i -c)
CARTREF=$(echo "$SNAP4" | grep -oP 'button "(В корзину|Добавить в корзину)".*?ref=\Ke[0-9]+' | head -1)
echo "add-to-cart ref: @$CARTREF"
[ -z "$CARTREF" ] && { echo "FAIL: no add-to-cart button"; exit 1; }
agent-browser click "@$CARTREF"
sleep 3
for i in $(seq 1 15); do
  PL=$(agent-browser network requests --filter cart 2>&1 | grep -E "POST http://127.0.0.1:3000/api/cart")
  echo "poll POST $i: $PL"
  echo "$PL" | grep -qE "\) [0-9]{3}$" && break
  sleep 2
done
echo "--- drawer snapshot ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Оформить|Удалить|₽" | head -15
agent-browser screenshot $V/cart-added.png
echo "--- DB rows after UI add ---"
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"

echo "=== [step3] reload → persistence ==="
agent-browser reload 2>/dev/null || agent-browser open http://127.0.0.1:3000
agent-browser wait --load networkidle 2>/dev/null
sleep 3
CARTBTN=$(agent-browser snapshot -i -c | grep -oP 'button "Корзина".*?ref=\Ke[0-9]+' | head -1)
echo "cart button: @$CARTBTN"
agent-browser click "@$CARTBTN"
sleep 2
echo "--- drawer after reload ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Оформить|Удалить|пуста|₽" | head -15
agent-browser screenshot $V/cart-after-reload.png
echo "--- DB rows after reload (expect same row) ---"
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"

echo "=== [step4] remove item → DELETE → reload → empty ==="
DELREF=$(agent-browser snapshot -i -c | grep -oP 'button "Удалить".*?ref=\Ke[0-9]+' | head -1)
echo "delete ref: @$DELREF"
[ -z "$DELREF" ] && { echo "FAIL: no delete button"; exit 1; }
agent-browser click "@$DELREF"
sleep 2
for i in $(seq 1 15); do
  DL=$(agent-browser network requests --filter cart 2>&1 | grep -E "DELETE http://127.0.0.1:3000/api/cart")
  echo "poll DELETE $i: $DL"
  echo "$DL" | grep -qE "\) [0-9]{3}$" && break
  sleep 2
done
agent-browser reload 2>/dev/null
agent-browser wait --load networkidle 2>/dev/null
sleep 3
CARTBTN2=$(agent-browser snapshot -i -c | grep -oP 'button "Корзина".*?ref=\Ke[0-9]+' | head -1)
agent-browser click "@$CARTBTN2"
sleep 2
echo "--- drawer after remove+reload (expect empty) ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|пуста|Оформить|Удалить|Здесь пока" | head -12
echo "--- DB rows after remove (expect []) ---"
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity FROM cart_items ci WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"
echo "--- cart network full ---"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -8
echo "=== chunk C done (browser left open) ==="
