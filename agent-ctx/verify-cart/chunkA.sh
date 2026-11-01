#!/bin/bash
# Chunk A v3: Step 1 (login) + Step 2 (add product; wait for POST /api/cart completion + DB row)
cd /home/z/my-project
echo "=== [server] starting dev server ==="
setsid nohup npm run dev >> dev.log 2>&1 < /dev/null &
disown
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://127.0.0.1:3000/)
  [ "$code" = "200" ] && { echo "server UP (poll $i)"; break; }
  sleep 3
done
[ "$code" != "200" ] && { echo "SERVER FAILED TO START"; exit 1; }

echo "=== [browser] open homepage (fresh context expected) ==="
agent-browser open http://127.0.0.1:3000 || exit 1
agent-browser wait --load networkidle 2>/dev/null
sleep 2

SNAP=$(agent-browser snapshot -i -c)
CLOSE_REF=$(echo "$SNAP" | grep -oP 'button "Закрыть".*?ref=\Ke[0-9]+' | head -1)
[ -n "$CLOSE_REF" ] && agent-browser click "@$CLOSE_REF" 2>/dev/null

SNAP=$(agent-browser snapshot -i -c)
LOGIN_REF=$(echo "$SNAP" | grep -oP 'button "Войти".*?ref=\Ke[0-9]+' | head -1)
echo "LOGIN_REF=@$LOGIN_REF"

echo "=== [step1] login ==="
agent-browser click "@$LOGIN_REF"
sleep 2
agent-browser wait --load networkidle 2>/dev/null
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
sleep 1

SNAP3=$(agent-browser snapshot -i -c)
echo "=== [step1] header after login (expect avatar ДЕ) ==="
echo "$SNAP3" | grep -E "button \"(ДЕ|Войти|Корзина)\"" | head -5
agent-browser screenshot /home/z/my-project/agent-ctx/verify-cart/step1-logged-in.png

echo "=== [step1] network: auth + cart reconcile ==="
agent-browser network requests --filter "auth" 2>&1 | grep -E "api/auth" | tail -3
echo "--- cart requests so far (expect GET /api/cart fired on login) ---"
agent-browser network requests --filter "cart" 2>&1 | tail -4

echo "=== [step2] add product to cart ==="
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll up 4000 2>/dev/null; sleep 1
SNAP4=$(agent-browser snapshot -i -c)
CARTREF=$(echo "$SNAP4" | grep -oP 'button "(В корзину|Добавить в корзину)".*?ref=\Ke[0-9]+' | head -1)
echo "first add-to-cart ref: @$CARTREF"
[ -z "$CARTREF" ] && { echo "NO add-to-cart button"; exit 1; }
agent-browser click "@$CARTREF"
sleep 2

echo "--- polling up to 24s for POST /api/cart completion ---"
POSTLINE=""
for i in $(seq 1 12); do
  POSTLINE=$(agent-browser network requests --filter cart 2>&1 | grep -E "POST http://127.0.0.1:3000/api/cart")
  echo "poll $i: ${POSTLINE:-none}"
  echo "$POSTLINE" | grep -qE "\) (200|201|204|4[0-9][0-9]|5[0-9][0-9])$" && break
  sleep 2
done
sleep 2
echo "--- snapshot after add (drawer area) ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Оформить|₽|Назв|удалить|\+" | head -20
agent-browser screenshot /home/z/my-project/agent-ctx/verify-cart/cart-added.png

echo "=== [step2] full cart network ==="
agent-browser network requests --filter cart 2>&1 | tail -8

echo "=== [step2] DB cart_items for customer (poll up to 12s) ==="
for i in $(seq 1 6); do
  ROWS=$(node agent-ctx/verify-cart/dbq.cjs "SELECT ci.id, ci.user_id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'")
  echo "poll $i: $ROWS"
  [ "$ROWS" != "[]" ] && break
  sleep 2
done

echo "=== [step2] dev.log cart lines ==="
grep -E "api/cart" dev.log | tail -6

echo "=== [step2] page errors ==="
agent-browser errors 2>&1 | tail -6
echo "NOTE: browser left OPEN on purpose (session persists in daemon)"
echo "=== chunk A done ==="
