# SECURITY REVIEW — релиз release/readiness-fixes

> Дата: 2026-09-29. Основа: трёхсторонний аудит (CI/БД, финансы/2FA, API/AI/UX)
> с file:line-доказательствами. Полные журналы — worklog.md, задачи R-1a/R-1b/R-1c.

## 1. Исправленные проблемы

### P0 — блокировали публикацию

| # | Проблема | Где было | Исправление |
|---|---|---|---|
| S1 | Журнал финопераций `confectioner_transactions` без RLS при широком `GRANT SELECT ... TO anon, authenticated` (0011:314) — балансы/суммы читал любой anon через PostgREST | миграция 0017:892 | 0039: RLS owner-only, GRANT anon/authenticated отозваны |
| S2 | deploy.yml: сломанный heredoc → `.env.production` пуст; секреты runner'а печатались в лог (`cat /tmp/env-to-append`); `StrictHostKeyChecking=no`; миграции 5 из 38 по несуществующему пути без fail-fast; рассинхрон git pull/latest/локальной сборки; `image prune` уничтожал версии для отката | deploy.yml:91-163 | Полная переработка: workflow_dispatch-only, immutable SHA-теги, ledger-мигратор (ON_ERROR_STOP=1), healthcheck retry, откат без prune, секреты не печатаются |
| S3 | Вебхук `refund.succeeded`: (а) гейт идемпотентности с `dbStatus="succeeded"===payment.status` проглатывал ВСЕ refund-события по оплаченному платежу; (б) обходной путь суммировал возврат read-add-write — повторная доставка задваивала сумму частичного возврата | webhook/route.ts:187,415-426 | 0039 RPC `apply_yookassa_refund` (дедуп по refund id, атомарный инкремент); webhook вызывает RPC, при отсутствии — fail-closed 500 (YooKassa повторит) |
| S4 | Отмена заказа с `payment_status='released'` оставляла отменённый заказ в составе выплаты → кондитеру платили за отменённый заказ, деньги клиента не возвращались | orders/[id]/cancel:50-83 | 409 при payout-резерве и при released |
| S5 | 2FA-гейт выплат был мёртвым: читал колонки `tfa_*`, которые никто не пишет (живая система — `two_factor_*`) → выплаты фактически не защищались 2FA | payouts/request:203-215 | Гейт читает обе системы; TOTP-секрет из живой колонки |
| S6 | Backup-коды: fail-open fallback (`tfaOk=true` при отсутствии RPC) + read-filter-write в login-verify → два параллельных логина с одним кодом получали JWT; один код авторизовал две payout-заявки | payouts/request:257-270; 2fa/login-verify:174-199 | Атомарные RPC (0037 + 0039 v2 для живой колонки); PGRST202 → 503 fail-closed; токены только после успешного consume |

### P1 — исправлены до релиза

| # | Проблема | Исправление |
|---|---|---|
| S7 | IDOR в ai-dialogue learn/respond/context: customerId/confectionerId из body/query без сверки с токеном | `src/lib/ai-dialogue-access.ts`: покупатель — свой customerId; кондитер — своя пара |
| S8 | 12 POST-вызовов AI-виджетов без `x-csrf-token` (403 от proxy — виджеты мертвы), часть без Authorization (401) | Единый `getSessionAuthHeaders()` в 8 файлах |
| S9 | Гонка двойной компенсации резерва в payouts/request (админ reject в окне гонки → двойное начисление) | CAS `status='pending'→'rejected'` перед компенсацией; refund только у победителя |
| S10 | `mock_*` id провайдера принимались в production → подделка refund поверх IP-allowlist | production: fail-closed 401/ok:false |
| S11 | Идемпотентность миграций: migrator молча пропускал ошибки SQL (`ON_ERROR_STOP=0` + `\|\| true`) | `01-apply-migrations.sh`: ledger `schema_migrations`, каждый файл ровно один раз, fail-fast |

### P2 — исправлены

- Фабрикация данных карточки товара: выдуманный `prepTime` («1 день/2–5 дней» из флага is_featured), 3 фейковых отзыва с pravatar-аватарами, захардкоженное распределение оценок 78/15/5/2%, синтетические бейджи isHit/isPopular — удалены, показываются только реальные данные БД и честное пустое состояние.
- `images[0]` без проверки на пустой массив → placeholder (product-card, product-page).
- Дубль PWA-манифеста (manifest.json vs .webmanifest с разными темами; sw.js прекэшировал «чужой» файл) — остался один.
- `/api/health` теперь отдаёт версию образа (`APP_VERSION` = GIT_SHA) — база для мониторинга раскатки.
- CI: убраны 5× `npx prisma generate` (пакет удалён — `npx` качал бы его из интернета), `npm ci` → `bun install --frozen-lockfile`, секрет-сканы сохранены.

## 2. Остаточные риски (приняты, документированы)

| Риск | Severity | Обоснование/план |
|---|---|---|
| `scripts/smoke-test-db.ts` — legacy на Prisma-API, не работает | P2 | Не вызывается из CI/кода. Переписать на supabase-js или удалить |
| admin 2FA на complete выплат — не требуется | P1 | Компенсировано: админ-роуты закрыты ролью, CAS-переходами, аудитом. TOTP на админ-действия — в roadmap |
| Сплит колонок 2FA (`tfa_*`/`two_factor_*`) сохранён | P2 | Код читает обе; слияние миграцией — в roadmap (PAY-3) |
| LLM-вызовы без явного таймаута (8 AI-роутов) | P2 | SDK z-ai не гарантирует поддержку AbortSignal — риск зависания ограничен serverless-таймаутами платформы |
| Rate-limit на ai-assistant/chat и ai-dialogue/respond — публичный лимит есть, authed — общий | P2 | Добавить в PAY-3 |
| deploy.yml: appleboy/ssh-action не верифицирует host key (ограничение action) | P1 | Для строгой верификации — self-hosted runner или manual SSH. Задокументировано в DEPLOYMENT.md |
| Ветка pay2-wip: ledger-миграция 0038 (ЖУРНАЛ всех движений баланса) не влита | P2 | Additive и совместима, но 12 коммитов позади + нет валидатора. Перенос — отдельным PAY-2 раундом после rebase и прогона verifier |
| Легаси POST /api/admin/payouts создаёт заявки без связи с балансом | P2 | Деньги не двигаются (гвард reject). Удаление/переписка — в cleanup |
| Кумулятивный верхний предел возвратов в RPC `apply_yookassa_refund` не проверяется (одиночный возврат ≤ суммы платежа проверяется в вебхуке:416) | P3 | Переплата физически требует двух РАЗНЫХ refund_id от YooKassa на сумму > платежа — инвариант провайдера; возвраты через /api/payment/refund дополнительно резервируются `reserve_refund` (0035). Хардендинг-проверка в RPC — в cleanup |

## 3. Что НЕ проверено из песочницы

- Живой прогон миграций 0039 на реальном Supabase. Статус проверки: SQL-ревью +
  рантайм-валидация на изолированной PGlite (verify-release-0039-pglite.ts,
  21/21 PASS: RLS, RPC-семантика 2FA/refund, дедуп, идемпотентность). Остаток —
  копия production-БД по docs/PRODUCTION_MIGRATION_PLAN.md.
- VPS-деплой целиком (нужны SSH/registry секреты) — workflow переработан, но реальный прогон возможен только владельцем.
- Боевой контур YooKassa (только тестовые реквизиты/mock).
- Docker-сборка web-образа после фикса 2026-09-30 (удалён мёртвый COPY
  xdg-basedir) — рантайм-проверка возможна только в CI/на машине с Docker;
  локально Docker в песочнице недоступен.
