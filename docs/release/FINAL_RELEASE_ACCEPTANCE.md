# FINAL_RELEASE_ACCEPTANCE — итоговая приёмка Z-v21

**Дата:** 2026-11-10 (Europe/Moscow) · Ветка `main` · HEAD: см. §A.

## A. Итоговый статус

# `READY FOR STAGING`

Обоснование: все доступные локально проверки пройдены фактически (см. §C); фактический staging-деплой, GitHub Actions и живые интеграции требуют разрешений/credentials владельца (OWNER_ACTIONS_REQUIRED.md) — выше подниматься по критериям §19.2/19.3 ТЗ нельзя.

## B. Git и сохранность изменений

| Параметр | Факт |
|---|---|
| Ветка | `main` |
| HEAD | `01886c1` (+ docs-коммит Z-v21, см. git log) — вырос с baseline `1505c0b` на 4 коммита Z-v21 |
| Рабочее дерево | чистое (после автосрабатывания pre-commit guard) |
| Ahead / behind | ~229 ahead / 0 behind (origin не обновлялся) |
| Push/merge/deploy/миграции внешние | **НЕ выполнялись** (запрещены) |
| Защищённые файлы | все 4 на диске и в index; содержимое не читалось; в коммиты изменения не попали; skip-worktree флаги не менялись |
| Guard | pre-commit `protected-paths.sh` активен и **доказанно сработал** в этой сессии (заблокировал drift-удаление, восстановил блобы) |
| Коммиты Z-v21 | `7e59353` baseline · `c4a7a9f` RLS spot-check · `01886c1` fixes · docs Z-v21 |

## C. Проверки

| Направление | Статус | Фактическое доказательство | Остаточный риск |
|---|---|---|---|
| CI (GitHub) | NOT RUN | workflows валидны (YAML-парс); нужен push | build-гейт не гонялся нигде |
| Build | NOT VERIFIED | OOM песочницы (dmesg); tsc/eslint PASS | первый прогон — в CI |
| TypeScript | PASS | `tsc --noEmit` exit 0 | — |
| Lint | PASS | eslint exit 0 | — |
| Unit/Integration | **PASS 109 файлов / 1571 теста** | `vitest run --no-file-parallelism` (включая redline 9/9 и 2 защищённых route-теста) | — |
| E2E (полный Playwright) | NOT VERIFIED | RAM-лимит сессии; ключевые пути — agent-browser | полный прогон на staging |
| Order lifecycle | **PASS 81/81** | `order-lifecycle-verify.mjs` (escrow→…→delivered, гонки, at-risk, capacity) | — |
| Checkout идемпотентность | PASS 15/15 | `checkout-idempotency-verify.mjs` | — |
| Inventory (параллельные списания) | PASS 8/8 | `inventory-concurrency-verify.mjs` | — |
| Diagnostics/health | PASS 16/16 | `diagnostics-verify.mjs` | — |
| Ops-center | PASS 37/37 | `ops-center-verify.mjs` | — |
| Migrations PG18 | PASS | 79 миграций на чистой PG 18.4; идемпотентно; 248 таблиц; RPC на месте | — |
| RLS/security | PASS (spot) | rls-spot-check: owner/conf видят, посторонний и anon — нет; чужой UPDATE = 0 строк | полный RLS-аудит — отдельная задача |
| OAuth Yandex | BLOCKED (креды) | цепочка реализована; 501 fail-closed без кредов; env-шаблоны дополнены | живой логин |
| VK ID | исключён (владелец решает) | 501 честный; integrations-status=false; тост в UI | — |
| n8n | NOT VERIFIED | stub-receiver получает события; движок не запущен (N8N_ACCEPTANCE) | выполнение workflows |
| Payments | код PASS; sandbox BLOCKED | unit/E2E вебхука; fail-closed прод-гейты; refund RPC | живой sandbox-цикл |
| Storage | PASS (ключевое) | product/order media ACL, Range/ETag; cms/media закрыт (01886c1); upload-роуты живы (403 без auth) | avatar MIME-снифф в backlog |
| Business scenarios | PASS | §C выше + живой UI-путь login→cart | полная матрица — staging |
| UX/UI | PASS (ключевое) | home/catalog/cart 1440+390, без overflow; консоль чистая | полная матрица — staging |
| Mobile | PASS (390px) | скриншот catalog-390 | 360/768/1024 — staging |
| Performance | PARTIAL | страницы отвечают <1.5s локально; бандлы не анализировались (build OOM) | Lighthouse на staging |
| SEO | PASS | title/desc/canonical/robots/sitemap/404/dashboard-redirect | robots-meta cosmetics (/checkout) |
| Backup/restore | **PASSED** | backup-verify-restore: 15 таблиц источник↔backup↔restore; disposable удалена | offsite-хранение — владелец |
| Staging | NOT DEPLOYED | RUNBOOK + SMOKE готов; ожидает разрешений | — |

## D. Исправленные дефекты (Z-v21)

1. **CMS media upload: нет role-gate и MIME-валидации** (любой authenticated мог грузить 50 МБ произвольных файлов).
   Причина: маршрут создан без guard'а. Файл: `src/app/api/cms/media/route.ts`. Фикс: `requireAnyRole(ADMIN/SUPER_ADMIN/COPYWRITER)` + magic-byte `sniffMime` (общий движок product-media), 415 fail-closed, безопасное расширение. Regression: `src/app/api/cms/media/route.test.ts` 3/3. Коммит `01886c1`.
2. **integrations-status показывал VK «настроен» при заведомо неработающем провайдере**. Фикс: честный `vk:false` до реализации. Тест добавлен (5/5). Коммит `01886c1`.
3. **`YANDEX_CLIENT_SECRET` отсутствовал в env-шаблонах** (код его читает). Фикс: добавлен в `.env.local.example` и `.env.production.example` (+ пометка о нереализованном VK). Коммит `01886c1`.
4. **Drift защищённых upload-файлов** (4 файла отсутствовали на диске → redline 4 failed). Причина: повторяющийся класс инцидентов #8–#17 (среда удаляет файлы). Решение: **pre-commit guard сработал автоматически** при коммите и восстановил блобы (штатный механизм, ручного восстановления не было). Итог: файлы на диске, suite зелёный. Рекомендация: `protected-paths.sh skip-on` в ensure-dev.

## E. Блокеры (реальные, нерешённые)

1. **Push/CI**: 229 коммитов не опубликованы; build-гейт не выполнен нигде (песочница OOM). → A-1.
2. **Staging**: нет разрешения/инфраструктуры. → A-2.
3. **YooKassa sandbox, Yandex OAuth, n8n движок**: без credentials/инстансов приёмка невозможна. → A-4/A-6/A-7.
4. **VK ID**: продуктовое решение владельца. → A-5.

## F. Owner Actions

См. `OWNER_ACTIONS_REQUIRED.md` (A-1…A-9, по приоритету).

## G. Известные ограничения

См. `KNOWN_LIMITATIONS.md` (среда, интеграции, продуктовые).

## H. Следующий шаг (единственный, максимально приближающий к релизу)

**Выдать разрешение A-1 (push в main) и дождаться зелёного GitHub Actions на опубликованном SHA** — это закрывает невыполнимый в песочнице build-гейт и открывает всё дальнейшее (staging по A-2).
