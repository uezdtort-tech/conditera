#!/bin/bash
# Chunk E: proper merge screenshot + step3 reload evidence + step6 PATCH + step7 checkout + step8 console
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
curl -s -o /dev/null -w "warm /checkout: %{http_code} in %{time_total}s\n" --max-time 60 http://127.0.0.1:3000/checkout

echo "=== [state] DB ==="
node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"
echo "=== [state] localStorage cart snapshot ==="
agent-browser eval "JSON.parse(localStorage['conditera-storage']||'{}').state?.cart?.map(i=>({t:i.title,q:i.quantity,dbId:i.dbId}))" 2>&1 | tail -3

echo "=== [step5-evidence] open drawer → proper cart-merge.png (both items) ==="
CARTBTN=$(agent-browser snapshot -i -c | grep -oP 'button "Корзина".*?ref=\Ke[0-9]+' | head -1)
agent-browser click "@$CARTBTN"
sleep 2
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|Наполеон|Коровка|шт|Оформить|Удалить" | head -14
agent-browser screenshot $V/cart-merge.png
CL=$(agent-browser snapshot -i -c | grep -oP 'button "(Close|Закрыть)".*?ref=\Ke[0-9]+' | head -1)
[ -n "$CL" ] && agent-browser click "@$CL" 2>/dev/null

echo "=== [step3-evidence] TRUE reload → what happens ==="
CNT0=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
agent-browser reload
agent-browser wait --load networkidle 2>/dev/null
sleep 6
CNT1=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
echo "api/cart request lines: before reload=$CNT0 after reload=$CNT1 (delta must be >0 if reconcile-on-hydrate ran)"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -3
CARTBTN=$(agent-browser snapshot -i -c | grep -oP 'button "Корзина".*?ref=\Ke[0-9]+' | head -1)
agent-browser click "@$CARTBTN"
sleep 2
echo "--- drawer after reload ---"
agent-browser snapshot -i -c 2>&1 | grep -iE "Корзина|Наполеон|Коровка|шт|Оформить|пуста" | head -12
agent-browser screenshot $V/cart-after-reload.png

echo "=== [step6] quantity increment → PATCH ==="
DSNAP=$(agent-browser snapshot -i -c)
echo "$DSNAP" | grep -iE "Коровка|Наполеон|Удалить" | head -8
# find qty controls: try +/-, arrow-up/down icons, or "Увеличить"
echo "--- all buttons in drawer ---"
echo "$DSNAP" | grep -oP 'button "[^"]{1,24}"' | sort | uniq -c | sort -rn | head -20
PLUSREF=$(echo "$DSNAP" | grep -oP 'button "[^"]*(\+|Увелич|plus|Plus)[^"]*".*?ref=\Ke[0-9]+' | head -1 | grep -oP 'e[0-9]+$')
echo "plus ref: @$PLUSREF"
if [ -n "$PLUSREF" ]; then
  agent-browser click "@$PLUSREF"
  sleep 3
  for i in $(seq 1 15); do
    P=$(agent-browser network requests --filter cart 2>&1 | grep -E "PATCH http://127.0.0.1:3000/api/cart/" | tail -2)
    echo "poll PATCH $i: $P"
    echo "$P" | grep -qE "\) [0-9]{3}$" && break
    sleep 2
  done
  sleep 1
  echo "--- DB after PATCH ---"
  node $V/dbq.cjs "SELECT ci.id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"
else
  echo "no +/- button found; will try fallback in next chunk"
fi
CL=$(agent-browser snapshot -i -c | grep -oP 'button "(Close|Закрыть)".*?ref=\Ke[0-9]+' | head -1)
[ -n "$CL" ] && agent-browser click "@$CL" 2>/dev/null

echo "=== [step7] checkout page (do NOT pay) ==="
agent-browser open http://127.0.0.1:3000/checkout
agent-browser wait --load networkidle 2>/dev/null
sleep 3
agent-browser get url
echo "--- checkout page snapshot (top) ---"
agent-browser snapshot -i -c 2>&1 | head -25
agent-browser screenshot $V/checkout-page.png
echo "--- items w/ dbId present? (client-side check via localStorage) ---"
agent-browser eval "JSON.stringify(JSON.parse(localStorage['conditera-storage']||'{}').state?.cart?.map(i=>({t:i.title,dbId:i.dbId}))||null)" 2>&1 | tail -2

echo "=== [step8] console + errors ==="
agent-browser errors 2>&1 | tail -10
agent-browser console 2>&1 | grep -iE "error|warn" | grep -viE "fast refresh|hmr|chunkloaderror|radix|a11y|deprecat" | tail -15
echo "=== chunk E done ==="
