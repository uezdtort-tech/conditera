# ПРОМПТ S2B3 — Security-фундамент: CSRF, заголовки, санитизация

Этап 2 «Auth/RBAC» | Блок 3. Зависимости: S2B1 (auth).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — инженер по безопасности веб-приложений. Ты закладываешь security-
фундамент v2 так, чтобы дефекты старого проекта (D4 stored-XSS, D5
timing-unsafe, отсутствие таймаутов) были невозможны архитектурно.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui; без indigo/blue.
- Данные: только Prisma. Backend: только Route Handlers.
- Безопасность: fail-closed; секреты через env; не печатать .env*.
- Процесс: коммит `[S2B3] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/Docker-секреты/upload-роуты старого проекта; старый
  проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
CSRF-защита всех state-changing API, security-заголовки, обязательная
санитизация пользовательского HTML, timing-safe сравнения секретов,
центральные таймауты исходящих fetch.

## 4. ШАГИ
1. CSRF (паттерн старого proxy.ts, исправленный):
   - GET /api/csrf-token → одноразовый токен (httponly=false кука
     cd_csrf + header X-CSRF-Token, TTL 15 мин);
   - middleware (src/middleware.ts): для POST/PUT/PATCH/DELETE —
     проверка X-CSRF-Token против куки; сравнение ТОЛЬКО через
     crypto.timingSafeEqual (закрыть D5 — в старом проекте было
     обычное сравнение на proxy.ts:128–149);
   - whitelist: /api/auth/login, /api/auth/register, /api/webhooks/*
     (внешние колбэки с собственной подписью), /api/health.
2. Security-заголовки в next.config: X-Frame-Options DENY,
   X-Content-Type-Options nosniff, Referrer-Policy strict-origin-
   when-cross-origin, Permissions-Policy минимум, HSTS (prod).
3. Санитизация: src/lib/security/sanitize.ts — обёртка над
   isomorphic-dompurify: sanitizeUserHtml(html) — whitelist тегов
   (b,i,em,strong,p,br,ul,ol,li,a[rel=noopener]) и ВЫРЕЗАНИЕ
   script/style/iframe/on*=; правило для всех поверхностей: HTML
   пользователя рендерится ТОЛЬКО через sanitize-компонент
   <SafeHtml html={...}> (выводит sanitized), прямой
   dangerouslySetInnerHTML для пользовательских данных ЗАПРЕЩЁН
   (закрыть D4: в старом admin-email-tab.tsx:303 был голый render).
4. Центральный fetch-хелпер src/lib/http/safe-fetch.ts: обязательный
   AbortSignal.timeout(ms, default 10000), ограничение размера ответа,
   запрет внутренних адресов (SSRF-guard: блок 169.254/10./127.
   кроме whitelist OLLAMA_BASE_URL) — применяется во всех будущих
   исходящих вызовах (YooKassa, Метрика, n8n, Ollama).
5. Rate-limit: src/lib/security/rate-limit.ts — in-memory token bucket
   (ключ+окно), конфиг per-route (login: 10/мин/IP; register: 5/час/IP;
   AI: per-action — SD-5). Применить к auth-эндпоинтам S2B1.
6. Заголовочная защита куки-сессий уже в S2B1 — проверить и задокумент.
7. Документ docs/SECURITY_BASELINE.md v2: список мер, как проверять
   (чек-лист приёмки каждого блока S3–S9 включает «CSRF-токен нужен,
   sanitize для user-HTML, safe-fetch для исходящих»).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/proxy.ts — CSRF-паттерн (исправить timing-unsafe!);
- src/lib/diagnostics/masking.ts — паттерн маскирования секретов в
  логах (перенести как есть);
- уроки: admin-email-tab.tsx:303 (анти-пример), auth.ts:293–296.

## 6. ЗАПРЕТЫ
- Не ослаблять CSRF-whitelist без пометки в SECURITY_BASELINE.md.
- Не применять safe-fetch к произвольным пользовательским URL без
  SSRF-guard.
- Не печатать значения секретов/кук в логах.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] POST без X-CSRF-Token → 403; с токеном → проходит;
- [ ] сравнение токена — timingSafeEqual (видно в коде middleware);
- [ ] security-заголовки присутствуют в ответе страницы;
- [ ] <SafeHtml> экранирует <script>alert(1)</script> (проверка на
      /styleguide или отдельной dev-странице);
- [ ] safe-fetch: таймаут и SSRF-guard в коде; login/register под
      rate-limit (11-й запрос подряд → 429);
- [ ] tsc 0, lint 0; коммит [S2B3]; worklog; SECURITY_BASELINE.md.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl: POST /api/auth/login без токена → 403; получить токен → 401
  (невалидные данные, но CSRF пройден);
- agent-browser: форма логина работает из браузера (токен подставляется
  автоматически клиентским хелпером);
- XSS-проверка: страница с SafeHtml не исполняет скрипт.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S2B3]; docs/SECURITY_BASELINE.md; worklog.
- Отчёт: список мер, что проверять в будущих блоках, отличия от
  старого проекта (D4/D5 закрыты).
