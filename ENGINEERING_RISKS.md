# ENGINEERING_RISKS.md

Подтверждённые технические риски. Каждый риск: доказательство в коде, влияние, минимальное безопасное исправление. Обновлено: 2026-11-16.

## R1. P0 — Stored-XSS в админ-панели: входящие письма без санитизации — **ИСПРАВЛЕНО 2026-11-16**

- **Было**: `admin-email-tab.tsx:303` рендерил нерасчищенный HTML (`dangerouslySetInnerHTML`); источник — `/api/email/inbound` (Mailgun/SendGrid/Postmark).
- **Исправление (AUTH_ROOT_CAUSE_REPORT.md §6A)**: `src/lib/email-sanitize.ts` (isomorphic-dompurify, whitelist тегов/атрибутов) в ДВУХ точках — inbound до записи в БД и рендер до `dangerouslySetInnerHTML` (защита легаси-строк). Тесты: `email-sanitize.test.ts`, 27 кейсов (malicious-фикстуры + сохранение вёрстки).

## R2. P1 — 299 коммитов не опубликованы (единственная копия истории)

- **Доказательство**: `git rev-list --left-right --count main...origin/main` = `299 0` (origin/main `8a31081`).
- **Влияние**: потеря песочницы = потеря всей разработки; конфликт веток при долгом расхождении.
- **Действие**: push только по явному разрешению владельца (`docs/SAFE_GIT_WORKFLOW.md`). До push — регулярный `ops:backup` (скрипт существует: `npm run ops:backup`).

## R3. P1 — Fail-open проверки блокировки пользователя — **ИСПРАВЛЕНО 2026-11-16**

- **Было**: `src/lib/auth.ts` — при ошибке чтения `profiles.is_blocked` запрос продолжался (fail-open на всех методах).
- **Исправление (AUTH_ROOT_CAUSE_REPORT.md §6B)**: мутирующие методы (POST/PUT/PATCH/DELETE) — fail-closed (null → 401 в роуте); GET/HEAD — fail-open (чтение при сбое БД). При ошибке кэш НЕ заполняется. Тесты: `auth-blocked-check.test.ts` (12 кейсов); E2E: session заблокированного → 403 + cookies очищены, мутация после TTL кэша → 401.
- Компромисс (документирован): 60-секундный кэш blocked-статуса — блокировка API-мутаций срабатывает максимум через 60с; login/session/refresh отказывают мгновенно.

## R4. P1 — Расхождение «документация vs код» по хэшированию паролей — **комментарии исправлены 2026-11-16; миграция Argon2id остаётся задачей роадмапа (P1-1)**

- **Было**: комментарии «Argon2id» в auth-роутах при фактическом bcryptjs 3 cost 10.
- **Исправлено**: комментарии в `login/route.ts` и `register/route.ts` приведены к факту (bcrypt, ссылка на R4). Миграция Argon2id с dual-verify (по префиксу `$2b$`/`$argon2`) — отдельная задача P1-1.

## R5. P1 — Секреты/каналы с не-timing-safe сравнением — **ИСПРАВЛЕНО 2026-11-16**

- **Было**: `src/lib/cron-auth.ts` — `X-Cron-Secret` сравнивался `!==`.
- **Исправление (AUTH_ROOT_CAUSE_REPORT.md §6C)**: `timingSafeEqualStr` (crypto.timingSafeEqual, как в proxy.ts CSRF и webhooks). Тесты: `cron-auth.test.ts` (10 кейсов: валид/невалид/разные длины/trim/401-ответ).
- Проверено grep: n8n/telegram/simplex/CSRF/OAuth-state — все остальные сравнения секретов timing-safe.

## R6. P2 — Чужеродный артефакт `mobile-app/` в репозитории

- **Доказательство**: появился в UUID-снапшоте `8aefa18` без утверждённой задачи; 3 из 3 ошибок ESLint репозитория в нём (`useChat.ts:268,269` refs-during-render, `SimpleXScreen.tsx:232` duplicate props); в веб-`src/` не импортируется.
- **Влияние**: смешение рабочих деревьев (нарушение п. 2 задания), красный lint.
- **Действие**: решение владельца — удалить / выделить в отдельный репозиторий / оставить. До решения — не трогать; можно исключить из `eslint.config` (владелец решает).

## R7. P2 — Ограниченное покрытие серверной валидации zod

- **Доказательство**: zod в 12/333 route.ts; auth-роуты валидируют вручную (`register/route.ts:134-152` — без проверки формата email/сложности пароля, `validation-schemas.ts` не подключён).
- **Влияние**: неоднородность контрактов, риск пропуска инвариантов в новых роутах.
- **Исправление**: постепенно подключать готовые `validations/*` и `validation-schemas.ts`, начиная с auth.

## R8. P2 — in-memory rate-limit без Redis

- **Доказательство**: `src/lib/rate-limit.ts:126-141` — Map per-instance; `REDIS_URL` на проде не настроен.
- **Влияние**: при масштабировании >1 инстанса лимиты не глобальны; рестарт сбрасывает окна.
- **Исправление**: не срочно (сейчас 1 инстанс); при масштабировании — Redis.

## R9. P2 — Sandbox-drift: процессы песочницы изменяют рабочее дерево

- **Доказательство**: инциденты #13–#17 (`scripts/protected-paths.sh`); рецидив 2026-11-16: удаление защищённых upload-роутов (восстановлено) + воскрешение сироты-теста `cart-sync.test.ts` в `8aefa18` (удалён коммитом `e7da599` с обоснованием).
- **Влияние**: фантомные файлы ломают typecheck/tests/lint.
- **Профилактика**: перед сессией `bash scripts/protected-paths.sh repair && skip-on`; проверять содержимое UUID-коммитов.

## R10. P2 — Производительность картинок и заглушки продуктовых модулей

- **Доказательство**: `next/image` только в 3 файлах (каталог — голые `<img>`); подарочные сертификаты — только zustand; корпоративные заказы — только mock.
- **Влияние**: Core Web Vitals (LCP), несоответствие продуктовым обещаниям страниц.
- **Исправление**: поэтапно — см. `DEVELOPMENT_ROADMAP.md`.

## R11. P3 — Известные ограничения (зафиксированы, не активные угрозы)

`/en` без контента; Supabase Realtime мёртв (используется socket.io :3030); вложения чата не реализованы; `product` без `/[id]`-маршрута (SEO); prisma-артефакты в `prisma/`; SMTP/Telegram/YooKassa env на проде не заданы. Детали: `docs/KNOWN_LIMITATIONS.md`.

## R12. Production-инцидент (внешний, контекст для разработки)

JWT_SECRET демонстрационный (скомпрометирован); supabase-rest/auth и Caddy unhealthy; 5 API молчат; регистрация на проде 500 до передеплоя cb42589. Задача Pi. Влияние на разработку: верификация auth-потоков на проде невозможна; все проверки — локально/тестовая БД. См. `PRODUCTION_COMPATIBILITY.md`.

## R13. P1 — Загруженные файлы на проде: эфемерный диск, вне бэкапов, вне supabase-storage

- **Доказательство**: весь upload-код идёт через Supabase Storage API (`supabaseAdmin.storage.from('media')` — `src/lib/upload-service.ts:137-146`, потребители: `/api/upload`, `/api/services/upload`, `/api/cms/media`), но байты принимает Storage-совместимый шим Next.js `src/app/storage/v1/[...path]/route.ts` — файлы пишутся на диск контейнера (`<cwd>/upload/storage/<bucket>/…`), метаданные — в `storage.objects` (compat 0000). Caddyfile не имеет блока `/storage/v1` → catch-all шлёт в web:3000, т.е. шим обрабатывает storage и на проде. Контейнер `supabase-storage` (storage-api + S3-бэкенд) подготовлен в `docker-compose.supabase.yml`, но маршрутизацией не задействован. У сервиса `web` в `docker-compose.yml` **томов нет** (awk-проверка пуста); `scripts/ops/run-backup.mjs` каталог `upload/` не включает.
- **Влияние**: пересоздание web-контейнера (деплой новой версии через `docker compose up`) теряет все загруженные пользователями/кондитерами файлы (портфолио, медиа товаров), при этом URL в БД остаются — «битые» картинки.
- **Минимальное исправление (P1, независимо от Pi)**: смонтировать named volume на `/app/upload` в compose (не требует изменений кода); среднесрочно — включить `upload/` в `ops:backup` либо переключить `/storage/v1` на контейнер `supabase-storage` (изменение Caddyfile — по решению владельца, шаблон `SUPABASE_STORAGE_HOSTNAME=cdn.conditera.ru` уже есть в `.env.production.example`).
