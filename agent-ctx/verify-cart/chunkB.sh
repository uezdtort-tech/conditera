#!/bin/bash
# Chunk B: server-side API smoke test for /api/cart (no browser) with memory-capped next dev
cd /home/z/my-project
echo "=== [server] starting dev server (max-old-space 2048) ==="
setsid nohup env NODE_OPTIONS="--max-old-space-size=2048" npm run dev >> dev.log 2>&1 < /dev/null &
disown
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://127.0.0.1:3000/)
  [ "$code" = "200" ] && { echo "server UP (poll $i)"; break; }
  sleep 3
done
[ "$code" != "200" ] && { echo "SERVER FAILED TO START"; exit 1; }
free -m | head -2

echo "=== warm routes (avoid compile stalls later) ==="
curl -s -o /dev/null -w "GET /api/csrf-token: %{http_code} in %{time_total}s\n" http://127.0.0.1:3000/api/csrf-token
curl -s -o /dev/null -w "POST /api/auth/login (bad creds, warms route): %{http_code} in %{time_total}s\n" -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"x@x.ru","password":"nope"}'

echo "=== login (real) ==="
curl -s -c /tmp/cj.txt -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"customer@demo.ru","password":"Demo123!"}' -o /tmp/login.json -w "login: %{http_code} in %{time_total}s\n"
node -e "const d=require('/tmp/login.json'); console.log('user:', d.user?.email); require('fs').writeFileSync('/tmp/tok.txt', d.accessToken||'')"

echo "=== csrf token ==="
TOK=$(curl -s -b /tmp/cj.txt -c /tmp/cj.txt http://127.0.0.1:3000/api/csrf-token | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token||''))")
echo "csrf token len: ${#TOK}"

echo "=== POST /api/cart (curl, csrf + cookie) ==="
time curl -s -b /tmp/cj.txt -X POST http://127.0.0.1:3000/api/cart \
  -H "Content-Type: application/json" -H "x-csrf-token: $TOK" \
  -H "Authorization: Bearer $(cat /tmp/tok.txt)" \
  -d '{"productId":"aaaaaaaa-0000-4000-8000-000000000003","quantity":1}' \
  --max-time 30 -w "\nPOST http %{http_code} in %{time_total}s\n"

echo "=== DB check after curl POST ==="
node agent-ctx/verify-cart/dbq.cjs "SELECT ci.id, ci.user_id, ci.product_id, ci.quantity, p.title FROM cart_items ci LEFT JOIN products p ON p.id=ci.product_id WHERE ci.user_id='11111111-1111-4111-8111-111111111106'"

echo "=== GET /api/cart (curl) ==="
curl -s -b /tmp/cj.txt -H "Authorization: Bearer $(cat /tmp/tok.txt)" http://127.0.0.1:3000/api/cart --max-time 30 -w "\nGET http %{http_code} in %{time_total}s\n" | head -c 900

echo
echo "=== dev.log tail ==="
tail -12 dev.log
