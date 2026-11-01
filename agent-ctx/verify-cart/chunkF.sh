#!/bin/bash
# Chunk F: prove hydrate-reconcile fires on /dashboard (root-cause confirmation) + cleanup
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
[ "$code" != "200" ] && { echo "SERVER FAILED"; exit 1; }

echo "=== [warm] /dashboard via curl (with session cookie) ==="
curl -s -c /tmp/cj.txt -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"customer@demo.ru","password":"Demo123!"}' -o /tmp/login.json -w "login: %{http_code}\n"
node -e "require('fs').writeFileSync('/tmp/tok.txt', require('/tmp/login.json').accessToken||'')"
curl -s -b /tmp/cj.txt -o /dev/null -w "GET /dashboard: %{http_code} in %{time_total}s\n" --max-time 120 http://127.0.0.1:3000/dashboard

echo "=== [test] browser: navigate /dashboard → hydrate reconcile fires? ==="
CNT0=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
agent-browser open http://127.0.0.1:3000/dashboard
agent-browser wait --load networkidle 2>/dev/null
sleep 8
CNT1=$(agent-browser network requests --filter cart 2>&1 | grep -c "api/cart")
echo "api/cart lines: before=$CNT0 after=$CNT1 (delta>0 → reconcile fired on dashboard hydrate)"
agent-browser network requests --filter cart 2>&1 | grep "api/cart" | tail -3
agent-browser get url
agent-browser screenshot $V/dashboard-hydrate.png

echo "=== [cleanup] clear server cart via API (proper csrf) ==="
TOK=$(curl -s -b /tmp/cj.txt -c /tmp/cj.txt http://127.0.0.1:3000/api/csrf-token | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token||''))")
curl -s -b /tmp/cj.txt -X DELETE "http://127.0.0.1:3000/api/cart?all=1" -H "x-csrf-token: $TOK" -H "Authorization: Bearer $(cat /tmp/tok.txt)" -w " <- clear all\n"
node $V/dbq.cjs "SELECT count(*) FROM cart_items WHERE user_id='11111111-1111-4111-8111-111111111106'"
echo "=== chunk F done ==="
