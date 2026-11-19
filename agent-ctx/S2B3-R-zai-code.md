# S2B3-R — zai-code — security-фундамент: CSRF one-time, headers, sanitize, safe-fetch, rate-limit, masking (recovery)

Дата: 2026-11-19. Статус: ЗАВЕРШЕНО, все гейты пройдены (boot + curl-matrix, 29 проверок PASS), коммит + bundle созданы.

## Контекст
Ре-исполнение S2B3 (спек: docs/rebuild/prompts/S2B3-security.md; DECISIONS.md учтён) поверх S1B1-R (f4038b6) + S1B2-R (7fcf60b) + S1B3-R (3e43022) + S2B1-R (9eb3a77) + S2B2-R (96a18a6/ca122bc). Корень /home/z/my-project/conditera-v2, dev :3100, shim :3040, `env -u DATABASE_URL`. Закрыты дефекты старого проекта: D4 (stored-XSS), D5 (timing-unsafe), отсутствие таймаутов.

## Что готово для следующих блоков
- **CSRF one-time**: src/lib/security/csrf.ts (issue/verify/rotate; sha256-hashed store на globalThis, сырой токен не хранится; timingSafeEqual по 32-байтным дайджестам — D5 закрыт; TTL 15 мин; ротация на использовании — повтор → 403; whitelist в докблоке) + GET /api/csrf (route src/app/api/csrf/route.ts, rate-limit 60/мин/IP) + csrf-shared.ts (константы без node:crypto для клиента) + csrf-client.ts (csrfFetch: prefetch свежего токена перед КАЖДОЙ мутацией). Enforcement: guard.ts withRole — CSRF ЦЕНТРАЛЬНО для мутирующих admin-роутов (порядок 403 csrf → 401/403 auth); явно в /api/auth/2fa/{enroll,verify}, /api/auth/oauth/[provider]. Whitelist: login/register/logout/session + health + webhooks/* + /api/csrf + /api/diag/* (таблица с компенсирующими контролями — docs/SECURITY_BASELINE.md).
- **Security-headers**: src/lib/security/headers.ts + applySecurityHeaders в src/proxy.ts (на все ответы). Набор: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy camera/microphone/geolocation/payment/usb/interest-cohort=(), CSP по SECURITY_CSP_MODE (dev: script 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:*; strict — prod-заглушка без unsafe-eval, extra origins через SECURITY_CSP_EXTRA_CONNECT_SRC; nonce — S9B1), HSTS ТОЛЬКО prod (max-age=63072000; includeSubDomains; в dev отсутствует — проверено).
- **Sanitize + SafeHtml (D4 закрыт)**: src/lib/security/sanitize.ts — allowlist (b,i,em,strong,p,br,ul,ol,li,a[href http/https/mailto/tel/отн., rel="noopener noreferrer" принудительно]); script/style/iframe/svg/... вырезаются С содержимым; on*/javascript:/data: запрещены; сущности href декодируются до проверки (safeCodePoint — RangeError-proof); <SafeHtml> src/components/security/safe-html.tsx (универсальный, RSC+client, data-safe-html) — ЕДИНСТВЕННЫЙ способ рендера user-HTML. Демо /styleguide#safe-html: 0 живых script в rendered HTML.
- **safe-fetch**: src/lib/security/safe-fetch.ts — timeout default 10s, body cap 10MB (потоково+abort), SSRF-guard (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0.0.0.0/8, 100.64/10, ::, ::1, fe80::/10, fc00::/7 — литерал + ВСЕ DNS-адреса; http/https only; redirect manual), SAFE_FETCH_ALLOWLIST (dev-дефолт 127.0.0.1,localhost,::1; prod — явный env обязателен). SafeFetchError{INVALID_URL|SSRF_BLOCKED|TIMEOUT|TOO_LARGE|NETWORK}; возвращает SafeFetchResult{ok,status,bytes,text(),json()}. Применён в /api/health (auth/storage/n8n пробы).
- **Rate-limit**: src/lib/security/rate-limit.ts — in-memory фиксированное окно (globalThis store): login 10/мин/IP (check на входе до GoTrue, consume ТОЛЬКО на неуспехе, успех сбрасывает счётчик), register 5/час/IP (consume на каждой попытке), 2fa 5/мин/IP (общий bucket enroll+verify, ДО CSRF), csrf 60/мин/IP. 429 + Retry-After. Ключ x-forwarded-for → x-real-ip → "unknown".
- **Masking**: src/lib/security/mask.ts — maskEmail/maskPhone/maskValue; в login/register console.* (проверено в dev.log: email=cu***@demo.ru).
- **docs/SECURITY_BASELINE.md** — 14 мер + CSRF-whitelist таблица + чек-лист приёмки S3–S9 (CSRF/SafeHtml/safe-fetch/rate-limit/логи/CSP/секреты).
- env: SAFE_FETCH_ALLOWLIST, SECURITY_CSP_MODE, SECURITY_CSP_EXTRA_CONNECT_SRC (.env.example + .env).

## Гейты (все пройдены 2026-11-19)
1. lint 0, tsc --noEmit 0.
2. Boot ОДНИМ вызовом (bash /home/z/gates/s2b3-gate.sh): shim :3040 + app :3100 UP, PG :54330 listening; health payload {status:ok, database:ok, auth:ok}.
3. curl-matrix (29/29 PASS): d) headers на HEAD / — XFO DENY, nosniff, referrer, permissions, CSP dev; HSTS отсутствует (dev); a) POST /api/admin/roles без токена → 403 {"error":"csrf"}; GET /api/csrf → 200 + Set-Cookie cd_csrf + token 64hex; POST с токеном (anon) → 401 (CSRF пройден, auth-guard); b) reuse токена → 403; e) customer login 200 → session 200; admin login 200 → users 200 → assign MODERATOR с X-CSRF-Token → 200 {previousRole:CONFECTIONER, claimsSynced:true, auditLogged:true} → DELETE с потраченным токеном → 403 → DELETE свежим → 200 {restoredRole:CONFECTIONER}; health 200; /styleguide 200; / 200; c) 11-й wrong-password login (XFF .77) → 429 + Retry-After; 6-й register (XFF .78) → 429; 6-я 2fa (XFF .79) → 429; demo login без XFF → 200. SafeHtml: 0 живых <script>alert(1)</script> в /styleguide.
4. Коммит **8628458** (`[S2B3] security: CSRF one-time (sha256+timingSafeEqual), headers, sanitize+SafeHtml, safe-fetch, rate-limit, masking, baseline (recovery)`); bundle /home/z/my-project/backups/conditera-v2-S2B3-8628458.bundle (309345 B, verify OK, полная история); дерево чистое. worklog.md — полная запись (отклонения ×10, уроки ×5).

## Отклонения (ключевые, полный список в worklog.md)
1. CSRF enforcement на РОУТАХ (guard.ts централизует admin; 2fa/oauth явно), не в proxy.ts — edge-сандбокс не гарантирует общий state для one-time store; proxy.ts — только headers.
2. Whitelist шире спеки §4.1: + logout (идемпотентен, sb-куки Lax) и session (GET-only); /api/csrf (выдача) и /api/diag/* (GET-only) — всё с компенсирующими контролями в baseline.
3. login-лимит — только неуспешные попытки (успех сбрасывает счётчик IP): анти-брутосил сохранён, регресс-гейт «demo login 200» не ломается после burst-теста.
4. Burst-тесты гейта шлют X-Forwarded-For (203.0.113.7x) — лимиты ключуются по XFF (спека), матрица детерминирована.
5. safeFetch возвращает SafeFetchResult (не Response) — body cap требует потокового контроля; redirect manual (SSRF-обход через 3xx исключён).
6. isomorphic-dompurify не ставился: allowlist-санитайзер pure-string — одинаков server/client (SafeHtml — последний рубеж), без jsdom-депа; allowlist точно по спеку §4.3.
7. SafeHtml без "use client" (универсальный компонент) — работает в RSC и client, граница клиента не добавляет бандл.
8. Первый прогон гейт-скрипта: 5 FAIL-строк по headers — дефект скрипта (сломанный presence-check), точные проверки PASS; скрипт исправлен, дамп curl -sSI подтверждает набор.

## Уроки (обязательны к учёту)
1. In-memory state в Route Handlers — ТОЛЬКО через globalThis-store (паттерн Prisma-singleton): бандлы роутов создают отдельные инстансы модуля.
2. CsrfFetchInit extends RequestInit целиком (не Omit<body>) — иначе tsc 2339.
3. String.fromCodePoint — RangeError на >0x10FFFF: декодеры сущностей защищать safeCodePoint.
4. Retry-After — обязательный заголовок 429 (гейт greps headers).
5. Порядок проверок мутирующих роутов зафикирован: admin = CSRF → auth → RBAC; 2fa = rate-limit → CSRF → флаг; login = rate-check → GoTrue (consume на неуспехе); register = rate-consume → валидация.

## Дальше
- S2B4 (Storage): httpOnly-куки → аплоады через server-роуты; RLS-политики (мера 13 baseline — снять placeholder).
- S3B1: удалить /api/diag/*; новые UI-блоки с user-HTML — ТОЛЬКО SafeHtml; исходящие — только safeFetch.
- S4B2: webhook YooKassa — whitelist CSRF + ОБЯЗАТЕЛЬНАЯ HMAC-подпись; исходящие YooKassa — safeFetch.
- S9B1: прод-CSP (nonce), SAFE_FETCH_ALLOWLIST явный prod-список, HSTS включится автоматически (NODE_ENV=production).
