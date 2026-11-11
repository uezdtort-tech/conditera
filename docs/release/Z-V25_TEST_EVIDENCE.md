# Z-v25 — TEST EVIDENCE

Дата: 2026-11-11 (UTC) · Среда: /home/z/my-project · PostgreSQL 18.4 (embedded, 127.0.0.1:54329) · Node v24.22.2 · bun 1.3.14 · HEAD `3c10708`, ветка `main`

Каждая строка: команда → результат → exit code. Логи в `agent-ctx/zv25/` (если применимо).

---

## 1. Ground Truth (Этап 1)

| Проверка | Команда | Результат | Exit |
|---|---|---|---|
| HEAD/ветка | `git rev-parse HEAD`, `git branch --show-current` | 3c10708, main | 0 |
| Дерево/индекс | `git status --porcelain=v1` | 0 записей (до аудита) | 0 |
| Stash | `git stash list` | пуст | 0 |
| Ahead/behind | `git rev-list --left-right --count origin/main...HEAD` | 0 behind / 236 ahead | 0 |
| Незавершённые ops | проверка .git/MERGE_HEAD, rebase-* | отсутствуют | — |
| UUID-коммиты пустые? | `git show --stat b126f6a/1ceaa4b/2f52a55` | 0 файлов — ПОДТВЕРЖДЕНО | 0 |
| Snapshotter | `ps aux | grep -Ei 'snapshot\|autocommit\|watcher'` | процессов нет | — |
| Защищённые файлы | `git ls-files -v` + `git hash-object` vs `git ls-files -s` | 4/4 существуют, clean, блобы MATCH, флаг H (skip-worktree off — режим hook-guard) | — |
| Guard | `core.hooksPath=scripts/hooks`; scripts/hooks/pre-commit → scripts/protected-paths.sh hook-guard | на месте | — |

## 2. Миграции и runners (Этап 2.1–2.2)

| Проверка | Метод | Результат |
|---|---|---|
| Дубликаты migration ID | `ls supabase/migrations | sed 's/_.*//' | sort | uniq -d` | пусто (79 файлов) |
| Зомби 0062 в дереве | `ls supabase/migrations/0062*` | только 0062_cart_sync_custom.sql |
| Ссылки на metadata в cart-коде | `rg "metadata" src/lib/cart-merge.ts src/app/api/cart/ src/lib/validations/` | 0 |
| Импорты удалённого validations/cart.ts | `rg "validations/cart" src/ scripts/` | 0 |
| 0080 порядок DROP→rescue | чтение файла + B2-order (UPDATE при живом CHECK → 23514) | подтверждено |
| setup.mjs fail-fast | Сценарий C1 | exit 1, леджер чист, откат, сиды пропущены намеренно |
| setup.mjs дубликаты ДО SQL | Сценарий C3 (probe 0063) | exit 1, ledger=0, «ДУБЛИКАТ MIGRATION ID 0063» |
| setup.mjs повторный запуск | Сценарий C2 + B1-rerun | exit 0 |
| Legacy apply-migrations.ts fake-success | Сценарий C4 (обособленный cwd) | «1 ok, 1 failed» → «✅ success» exit 0 — ДЕФЕКТ ПОДТВЕРЖДЁН (F2) |
| init-db.sh / CI 01-apply-migrations.sh | код-аудит | ON_ERROR_STOP=1, леджер, dup-check, exit 1 |
| CI ci.yml migrations-pg18 | код-аудит | использует 01-apply-migrations.sh (ledger) |

## 3. Сценарий A — чистая установка (Этап 2.3)

- Создание: `conditera_zv25_a_clean` (embedded PG 18.4).
- Штатный прогон: `DATABASE_URL=…conditera_zv25_a_clean bun scripts/db/setup.mjs` → **exit 0**, ledger 79/79 (agent-ctx/zv25/scenario-a-setup.log).
- Верификация каталога: `node agent-ctx/zv25/scenario-a-verify.mjs conditera_zv25_a_clean` → **18/18 PASS, exit 0**.
  - Примечание честности: A5 изначально FAIL из-за regex моего скрипта (pg_get_constraintdef добавляет скобки); после нормализации — PASS. Дефект скрипта, не схемы.
  - Схема: 248 таблиц, 356 функций, 67 триггеров; cart_items: custom_config+client_ref, БЕЗ metadata, kind_check корректен, product_id nullable, uq_cart_user_client_ref + idx_cart_user_updated, RLS on + 4 owner-политики.

## 4. Сценарий B — легаси-обновление (Этап 2.3)

`node agent-ctx/zv25/scenario-b-verify.mjs` → **24/24 PASS, exit 0**.
- B1 (реалистичный): леджер до-0080 + зомби-CHECK + metadata + данные → custom-вставка 23514 (зомби-CHECK) → **штатный setup.mjs upgrade exit 0** → зомби удалён, kind_check сохранён, metadata сохранена (держит данные), обе строки целы (qty 1 и 2, gift_wrap:true), custom-вставка после фикса OK, недопустимый вид отклонён kind_check, rerun exit 0.
- B2 (rescue-путь): UPDATE-спасение при живом зомби-CHECK → 23514 (порядок критичен — доказано); после 0080: metadata→custom_config ПОЛНОСТЬЮ (2/2 строки, title/price/custom), NULL-строки не тронуты, колонка удалена, канонический kind_check принят спасёнными строками.
- B3 (no-op): двойное применение 0080 на чистой схеме — без ошибок, metadata не воскресла.

## 5. Сценарий C — сбои (Этап 2.3)

`bash agent-ctx/zv25/scenario-c-runner-tests.sh` → **6/6 PASS, exit 0** (probe-файлы созданы/удалены в рамках теста; дерево чистое до и после).

## 6. HTTP и бизнес-сценарии корзины (Этап 2.4)

- `node agent-ctx/zv25/http-cart-scenarios.mjs` → **28/31 PASS** (3 FAIL — каскад F1: checkout 422 acceptance-gate; полный лог в ответе команды).
  - Покрыто: пустая корзина; product inserted; custom inserted (регресс P1 Z-v24: было 500/SQLSTATE 23514); 2-й custom; dedup merged MAX; повторный POST updated; PATCH qty; смена custom-конфига; некорректный productType 422; неизвестная начинка 422; qty=0 400; несуществующий товар 400; 401 без токена; 403 CSRF fail-closed; изоляция чужой корзины (404/404, строка A цела); 8 параллельных POST без дублей (23505-обработка); PUT merge; register rate-limit честно заблокирован.
- `node agent-ctx/zv25/checkout-scenarios.mjs` → **9/10 PASS** + 1 ложный FAIL скрипта (custom-снимок хранится плоско в selected_attributes — подтверждено прямым SQL-запросом) ⇒ **фактически 10/10**.
  - Заказ UK-2026-275910: total 22940 = 18500 (серверная цена товара) + 2220×2 (серверный расчёт конструктора); Idempotency-Key → один и тот же orderId в двух запросах; в БД ровно 1 запись; payment/create stub → 200 isStub.
- WELCOME10: custom-only checkout (гейт не применяется по контракту) → 200 {discount:222, subtotal:2220, total:2298} — серверная скидка 10%; повторное использование → **422 «Этот промокод уже был использован»** (first-order restriction подтверждена).
- Промежуточные обратимые изменения данных для K2–K10: inventory «Ягоды» 1000 г (supplier=ZV25-synthetic) + production_time_hours=6 у aaaaaaaa-…-0001 — **восстановлены** (DELETE rowCount=1, UPDATE→NULL rowCount=1).
- Synthetic-артефакты в рабочей БД: пользователи zv25-http-a-* (2), заказы ZV25 (UK-2026-275910 + идемпотент + WELCOME10) — оставлены (удаление нарушило бы финансовый леджер), помечены синтетикой.

## 7. Сборка/типы/линт/тесты (Этап 7)

| Проверка | Команда | Результат | Exit |
|---|---|---|---|
| TypeScript | `bun run typecheck` (tsc --noEmit) | 0 ошибок | **0** |
| ESLint | `bun run lint` (eslint .) | 0 ошибок | **0** |
| Vitest полный | `bun run test` | **109 файлов / 1571 тест — все PASS** (110.7s) | **0** |
| order-lifecycle | `node scripts/verify/order-lifecycle-verify.mjs` | **81/81** | **0** |
| inventory-concurrency | `node scripts/verify/inventory-concurrency-verify.mjs` | **8/8** (atomic, без lost update, журнал ровно 5) | **0** |
| checkout-idempotency | `node scripts/verify/checkout-idempotency-verify.mjs` | **15/15** | **0** |
| diagnostics | `node scripts/verify/diagnostics-verify.mjs` | **16/16** | **0** |
| ops-center | `node scripts/verify/ops-center-verify.mjs` | **37/37** | **0** |
| route-error-coverage | `node scripts/verify/route-error-coverage.mjs` | **47/48** (базлайн Z-v22) | **0** |
| cart-schema-verify | `node scripts/verify/cart-schema-verify.mjs` | **PASS** (disposable БД удалена) | **0** |
| upload-oversize | `node scripts/verify/upload-oversize-verify.mjs` | **8/8** | **0** |
| scan-evidence-rules | `node scripts/verify/scan-evidence-rules-verify.mjs` | **14/14** | **0** |
| p11-hardening | `node scripts/verify/p11-hardening-verify.mjs` | **12/17** (5 FAIL — каскад F1: checkout товаров заблокирован гейтом на демо-данных; прочие 12 PASS: webhook-копейки, amount_mismatch, идемпотентность webhook, events/notifications dedup, orders idempotency 23505, wishlist toggle) | 1 |
| backup→restore | `bun scripts/ops/backup-verify-restore.mjs` | **RESTORE-VERIFY: PASSED** (disposable conditera_restore_verify_* удалена) | **0** |
| **Production build** | попытка 1: `bun run build` | компиляция OK (65s), SIGKILL на фазе TypeScript; dmesg: OOM killed next-build, anon-rss 2295928kB | **137** |
| **Production build** | попытка 2: `NODE_OPTIONS=--max-old-space-size=2048 bun run build` | **PASS**: Compiled successfully 71s, 248 статических страниц, BUILD_ID=yVkv6xLZEqu7TdupyFIv8; dev-сервер после сборки healthy (200) | **0** |
| CI workflows | парсинг 5 YAML + permissions | все валидны; деплой-триггеры gated (workflow_dispatch/workflow_run+secrets-gate); находка F3 | — |
| meili-smoke | — | **NOT RUN**: Meilisearch не запущен в среде (порта 7700 нет) | — |
| osv-audit | — | **NOT RUN**: внешний сетевой запрос к OSV-DB вне локального периметра аудита | — |

## 8. Безопасность (Этап 3)

| Проверка | Метод | Результат |
|---|---|---|
| RLS-каталог | `agent-ctx/zv25/rls-catalog.mjs` (pg_catalog, read-only) | 89/248 без RLS; 28 голых true-политик (разбор — F7); financial_ledger — отдельная схема |
| Auth практический | register/login/logout/refresh-cookie/session API | register 200+token; login 200+token+cd_refresh; logout 200 (с CSRF); session по cd_session → user; 2FA-модуль присутствует |
| OAuth fail-closed | GET /api/auth/oauth/yandex, /vk | 501 оба (credentials отсутствуют — имена env проверены) |
| CSRF | POST без токена | 403 fail-closed (двойной submit cookie) |
| SQLi | поисковые пробы `' ; DROP TABLE products;--`, `OR 1=1--` | 200, таблица цела (12 товаров), параметризованные запросы |
| XSS | `<script>alert(1)</script>` в search | JSON без рефлексии скрипта |
| Secrets scan | паттерны sk-/AKIA/PRIVATE KEY/ghp_/xoxb/eyJ/sk_live по tracked-файлам + 300 коммитов истории | реальные секреты НЕ найдены; eyJ — плейсхолдеры examples; sk_live — детектор-паттерны; .env* в .gitignore (кроме .example) |
| Anti-fraud | практическое исчерпание лимитов | register 3/час+10/день, login 20/час — сработали честно (fail-closed), retryAfter корректен |
| Role gate | /api/ops/summary c CUSTOMER-токеном | 403 «Требуется одна из ролей: ADMIN, SUPER_ADMIN» |

## 9. Бизнес-ядро (Этап 4)

- Заказы: lifecycle 81/81 (включая переходы статусов, права участников, аудит).
- Инвентарь: 8/8 (атомарность, журнал движений, отсутствие отрицательных остатков).
- Платежи: YooKassa не сконфигурирован → stub-поток (create 200 isStub, webhook IP-allowlist IPv4+IPv6 в коде, refund-сверка в коде). Sandbox НЕ проверен — нужны credentials владельца.
- Чаты (realtime): E2E через gateway (`/?XTransformPort=3030`) — handshake с JWT PASS; невалидный JWT отвергнут; room:join r1 PASS; **message:send → message:receive доставлено подписчику**; senderId взято из JWT (клиентский подделан не был); message:sent ack; typing PASS (в финальном прогоне); комнатный доступ verifyRoomAccess через Next API (fail-closed).
  - Инфраструктурное примечание: chat-server перезапущен в рамках аудита (env-drift F6); персистентный экземпляр должен быть поднят супервизором среды (F5) — для прод-деплоя это решается стандартным процессом деплоя.
- Курьерский контур: покрыт lifecycle-набором (81) — переходы передача курьеру/доставка.
- Промокоды: WELCOME10 — серверный расчёт и first-order restriction подтверждены HTTP-тестами.

## 10. UI/UX (Этап 6, agent-browser)

| Страница/сценарий | Результат | Ошибки консоли |
|---|---|---|
| / (desktop) | рендер, hero, поиск, шапка | нет |
| /catalog | 12 товаров от 5 кондитеров, категории, фильтры, поиск | нет |
| /product?id=…0002 (Наполеон) | карточка, рейтинг 5.0, цена 2400 ₽, «В корзину» | нет |
| Добавление в корзину | toast «Добавлено в корзину — Домашний «Наполеон» × 1», бейдж 1 | нет |
| /cart | товар, промо-поле (WELCOME10 и др.), суммы 2400+300=2700, «Оформить заказ» | нет |
| Модалка входа (из шапки) | tabs Вход/Регистрация, Email/Пароль, submit → POST /api/auth/login (429 — тестовый лимит) | нет |
| /dashboard (сессия) | «Здравствуйте, ZV25!», меню кабинета (Обзор/Мои заказы/Лояльность/…) | нет |
| /checkout | визард 1-2-3, Доставка/Самовывоз, поля формы | 1× Failed to fetch (429 моего теста — F9) |
| / (mobile, iPhone 14) | hero, чипы, CTA, бейдж корзины, аватар; **горизонтального скролла нет** | нет |
| /login (прямой URL) | 200, но пустая страница (форма — в модалке) → F8 | — |

Скриншоты: agent-ctx/zv25/ui-home.png, ui-home-mobile2.png, ui-login-click.png.

## 11. Финальная целостность (Этап 13)

- `git status --porcelain` после аудита: только `?? agent-ctx/zv25-worklog.md`, `?? agent-ctx/zv25/` + новые docs/release/Z-V25_*.md.
- `git log -1` → 3c10708 (HEAD не изменился в ходе аудита, кроме финального коммита отчётов).
- Защищённые файлы после аудита: 4/4 существуют, clean, блобы MATCH (без чтения содержимого).
- Тестовые токены .tok1/.tok2 удалены.
- Disposable БД удалены сценарием B/A-прогонов остаются (conditera_zv25_a_clean, conditera_zv25_b_leg, conditera_zv25_b_rescue, conditera_zv25_b_noop, zv25_c_fail, zv25_c_dup, zv25_c_amts) — disposable, рабочая БД `conditera` не переинициализировалась.
