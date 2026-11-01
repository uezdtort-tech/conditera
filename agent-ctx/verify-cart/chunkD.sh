#!/bin/bash
# Chunk D: hydrate-reconcile test + Step 5 (guest→login merge) + Step 6 (PATCH qty)
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

echo "=== [prep] curl login + csrf + seed server cart with Бенто-торт qty1 ==="
curl -s -c /tmp/cj.txt -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"customer@demo.ru","password":"Demo123!"}' -o /tmp/login.json -w "login: %{http_code}\n"
node -e "require('fs').writeFileSync('/tmp/tok.txt', require('/tmp/login.json').accessToken||'')"
TOK=$(curl -s -b /tmp/cj.txt -c /tmp/cj.txt http://127.0.0.1:3000/api/csrf-token | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token||''))")
CSRF() { curl -s -b /tmp/cj.txt -c /tmp/cj.txt http://127.0.0.1:3000/api/csrf-token | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token||''))"; }
curl -s -b /tmp/cj.txt -X DELETE "http://127.0.0.1:3000/api/cart?all=1" -H "x-csrf-token: $(CSRF)" -H "Authorization: Bearer $(cat /tmp/tok.txt)" -w " <- clear all\n"
curl -s -b /tmp/cj.txt -X POST http://127.0.0.1:3000/api/cart -H "Content-Type: application/json" -H "x-csrf-token: $(CSRF)" -H "Authorization: Bearer $(cat /tmp/tok.txt)" -d '{"productId":"aaaaaaaa-0000-4000-8000-000000000002","quantity":1}' -w " <- seed Наполеон\n"
echo "--- DB now ---"
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"

echo "=== [HYDRATE TEST] browser is logged-in with EMPTY local cart; reload → does server row appear in drawer? ==="
agent-browser open http://127.0.0.1:3000
agent-browser wait --load networkidle 2>/dev/null
sleep 4
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -3
CARTBTN=$(agent-browser snapshot -i -c | grep -oP 'button "Корзина".*?ref=\Ke[0-9]+' | head -1)
agent-browser click "@$CARTBTN"
sleep 2
echo "--- drawer contents (expect Наполеон from server) ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Наполеон|Оформить|пуста|Удалить" | head -12

echo "=== [step5] logout via UI ==="
SNAP=$(agent-browser snapshot -i -c)
AVREF=$(echo "$SNAP" | grep -oP 'button "ДЕ".*?ref=\Ke[0-9]+' | head -1)
echo "avatar: @$AVREF"
agent-browser click "@$AVREF"
sleep 2
agent-browser snapshot -i -c | grep -iE "выйти|logout|профиль|menu" | head -8
OUTREF=$(agent-browser snapshot -i -c | grep -oP 'button "Выйти".*?ref=\Ke[0-9]+' | head -1)
echo "logout btn: @$OUTREF"
[ -z "$OUTREF" ] && { echo "FAIL: no logout button"; exit 1; }
agent-browser click "@$OUTREF"
sleep 3
agent-browser wait --load networkidle 2>/dev/null
echo "--- header after logout (expect Войти) ---"
agent-browser snapshot -i -c | grep -E "button \"(ДЕ|Войти)\"" | head -3

echo "=== [step5] guest adds DIFFERENT product (Наполеон is server item; guest adds Капкейки aaaaaaaa-...-0004) ==="
# clear network log marker: note current count
BEFORE=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
echo "cart api lines before guest add: $BEFORE"
agent-browser reload 2>/dev/null
agent-browser wait --load networkidle 2>/dev/null
sleep 2
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll down 1500 2>/dev/null; sleep 1
agent-browser scroll up 4000 2>/dev/null; sleep 1
SNAP=$(agent-browser snapshot -i -c)
# find the Капкейки card's add button: take 2nd add button (different product)
ADDREFS=$(echo "$SNAP" | grep -oP 'button "(В корзину|Добавить в корзину)".*?ref=\Ke[0-9]+')
echo "$ADDREFS" | head -5
ADD2=$(echo "$ADDREFS" | sed -n '2p' | grep -oP 'e[0-9]+$')
echo "guest add button (2nd product): @$ADD2"
[ -z "$ADD2" ] && { echo "FAIL: no add button"; exit 1; }
agent-browser click "@$ADD2"
sleep 3
echo "--- drawer as guest ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Капкейк|Оформить|Удалить" | head -10
agent-browser screenshot $V/guest-cart.png
AFTER=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
echo "cart api lines after guest add: $AFTER (must equal BEFORE — no /api/cart calls as guest)"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -4

echo "=== [step5] login again → merge ==="
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
echo "--- waiting for POST /api/cart (push of guest item) ---"
for i in $(seq 1 15); do
  PL=$(agent-browser network requests --filter cart 2>&1 | grep -E "POST http://127.0.0.1:3000/api/cart" | tail -2)
  echo "poll $i: $PL"
  echo "$PL" | grep -qE "\) [0-9]{3}$" && break
  sleep 2
done
sleep 3
echo "--- drawer after login-merge (expect BOTH: Наполеон + Капкейки) ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|шт|Наполеон|Капкейк|Оформить|Удалить|пуста" | head -14
agent-browser screenshot $V/cart-merge.png
echo "--- DB after merge (expect 2 rows incl. pushed Капкейки) ---"
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"

echo "=== [step6] quantity sync: click '+' (or increment) on first item ==="
agent-browser snapshot -i -c > /tmp/drawer.txt 2>&1
grep -iE "Капкейк|Наполеон|\\+|−|-\"|plus|minus|Увелич|Уменьш|quantity" /tmp/drawer.txt | head -20
# try common increment patterns
PLUSREF=$(grep -oP 'button "\\+".*?ref=\Ke[0-9]+' /tmp/drawer.txt | head -1)
[ -z "$PLUSREF" ] && PLUSREF=$(grep -oiP 'button "(Увеличить|\\+1|plus)".*?ref=\Ke[0-9]+' /tmp/drawer.txt | head -1)
echo "plus ref: @$PLUSREF"
if [ -n "$PLUSREF" ]; then
  agent-browser click "@$PLUSREF"
  sleep 2
  for i in $(seq 1 15); do
    P=$(agent-browser network requests --filter cart 2>&1 | grep -E "PATCH http://127.0.0.1:3000/api/cart/" | tail -2)
    echo "poll PATCH $i: $P"
    echo "$P" | grep -qE "\) [0-9]{3}$" && break
    sleep 2
  done
  echo "--- DB after PATCH (expect quantity 2 on Капкейки or patched item) ---"
  node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"
else
  echo "no +/- button found — dumping drawer snapshot fully:"
  cat /tmp/drawer.txt | head -40
fi
echo "=== chunk D done (browser left open) ==="
