# PRODUCTION MIGRATION PLAN — безопасное применение миграций 0034–0039

> **Статус документа:** план подготовлен и выверен по коду и PGlite-валидаторам.
> **Применять на production БЕЗ отдельного подтверждения владельца запрещено**
> (правило раунда; деплой и миграции — ручные операции владельца).
>
> Вычитка: агент-аудитор, коммит ветки `release/readiness-fixes` (см. worklog
> `Task ID: release-audit2`). Все команды проверены на изолированной БД (PGlite)
> валидаторами `scripts/verify-ops-0034-0037-pglite.ts`,
> `verify-payout-0036-pglite.ts`, `verify-payout-0037-pglite.ts`,
> `verify-release-0039-pglite.ts` (последний — новый, 21/21 PASS).

---

## 1. Точная последовательность миграций

Порядок ЖЁСТКО фиксирован (см. `scripts/ops-apply-money-path.ts:32-40`):

| # | Файл | Что делает | Блокировки/риски |
|---|------|-----------|------------------|
| 1 | `0034_money_path_identity.sql` | Колонки orders: `payment_status`, `escrow_released_at`, `payout_transferred_at`, `tariff_snapshot`, `commission_rate_snapshot`; чексуммы | ADD COLUMN (без NOT NULL) — короткие блокировки ACCESS EXCLUSIVE на каталог таблицы orders; на production-объёме мгновенно |
| 2 | `0035_payment_integrity.sql` | RPC `reserve_refund` (атомарный резерв остатка возврата); гранты service_role; COMMENT единиц | CREATE OR REPLACE — без блокировок данных |
| 3 | `0036_payout_integrity.sql` | `orders.payout_reserved_at` + partial index; RPC `add_confectioner_balance` (amount>0); гранты 4 money/bonus RPC → только service_role; RLS без INSPECTOR | INDEX CREATE (non-concurrent — ок для аддитивного индекса на малой выборке `payout_reserved_at IS NOT NULL`); RLS-включение меняет видимость для anon/authenticated |
| 4 | `0037_payout_linkage.sql` | `orders.payout_request_id` + partial index; CHECK `payout_requests_status_check` (**NOT VALID** — легаси-строки живут); RPC `consume_tfa_backup_code`, `release_escrow_order` | NOT VALID CHECK валидирует только НОВЫЕ строки — без долгой полной свип-валидации |
| 5 | `0039_release_readiness.sql` | RLS `confectioner_transactions` (закрыт anon-доступ из 0011:314); RPC `consume_tfa_backup_code_v2` (live 2FA); таблица `yookassa_refund_events` + RPC `apply_yookassa_refund` (идемпотентный refund-вебхук) | RLS на финансовом журнале: после применения anon/authenticated видят ТОЛЬКО свои строки (это ЦЕЛЬ; но если какой-то клиент читал чужие — он сломается, что и требовалось) |

**0038 ОТСУТСТВУЕТ СПЕЦИАЛЬНО** — ledger-миграция (`pay2-wip`) осознанно не
влита (нет валидатора, нет перевода вызовов на оверлоады). См.
`docs/KNOWN_LIMITATIONS.md` п.1. Никакой миграции «0038» искать и применять
**не нужно** — пропуск документирован, 0039 от 0038 не зависит.

### Механизм применения

- **Рекомендуемый:** migrator-контейнер / `scripts/apply-migrations.ts`
  (журнал `public.schema_migrations`, каждый файл в отдельной транзакции
  с `ON_ERROR_STOP=1`, повторный запуск пропускает применённое).
- **Ручной (равнозначный):** `psql -v ON_ERROR_STOP=1 -f <файл>` строго
  по порядку + рукописная запись в `schema_migrations` после успеха каждого.

## 2. Предварительные проверки схемы (до применения)

```sql
-- 2.1. Версия PG (ожидается 15+)
SELECT version();

-- 2.2. Состояние журнала миграций
SELECT filename, applied_at FROM public.schema_migrations
 ORDER BY applied_at DESC LIMIT 10;
-- ОЖИДАНИЕ: применены 0001..0033 (или baseline-список из docs/DEPLOYMENT.md),
-- ОТСУТСТВУЮТ 0034..0039.

-- 2.3. Не применены ли уже целевые миграции (идемпотентность защищает, но
-- лучше знать стартовое состояние)
SELECT count(*) AS already_0034 FROM public.schema_migrations WHERE filename LIKE '0034%';
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name IN
 ('payment_status','escrow_released_at','payout_transferred_at','payout_reserved_at','payout_request_id');

-- 2.4. Активные соединения и долгие транзакции (окно применения должно быть чистым)
SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle';
SELECT pid, now()-xact_start AS xact_age, query FROM pg_stat_activity
 WHERE xact_start IS NOT NULL AND now()-xact_start > interval '5 minutes';

-- 2.5. Объём orders (оценка длительности)
SELECT count(*) FROM public.orders;
```

**Проверка бэкапа (см. §3) — ДО любого применения.**

## 3. Резервная копия и проверка восстановления

```bash
# 3.1. Бэкап (custom format, сжатие)
pg_dump -Fc -U postgres -d postgres -f backup-pre-0034-0039-$(date +%F-%H%M).dump

# 3.2. ПРОВЕРКА восстановимости (обязательно, в чистый throwaway-контейнер):
docker run -d --name restore-check -e POSTGRES_PASSWORD=check postgres:15-alpine
cat backup-pre-0034-0039-*.dump | docker exec -i restore-check pg_restore -U postgres -d postgres --no-owner
# затем на restore-БД:
psql -U postgres -c "SELECT count(*) FROM public.orders;"   # выборки идут без ошибок
docker rm -f restore-check
```

Бэкап без проверенного восстановления считается отсутствующим. Критерий
допуска: `pg_restore --list` читается, тестовое восстановление прошло,
выборочные SELECT по крупным таблицам работают.

## 4. Совместимость версии кода и миграций

| Код | Требуемые миграции | Что сломается без них |
|-----|--------------------|------------------------|
| Текущий main (18651d4+) | 0034–0039 применить **ДО** деплоя кода | `payouts/request` без 0036/0037 → 500 на выборке eligible (нет `payout_reserved_at`/`payout_request_id`); refund-вебхук без 0039 → **fail-closed 500** (PGRST202 — это намеренно, YooKassa повторит доставку); 2FA backup-коды → 503 |

Правило: **сначала миграции, потом код**. Обратная последовательность
допустима по аварии: новый код на старой БД деградирует fail-closed
(деньги не теряются, выплаты/возвраты недоступны до применения миграций).
Старый код на новой БД совместим (все миграции аддитивные, сигнатуры RPC не
менялись).

## 5. SQL-проверки после применения (expect / stop)

```sql
-- 5.1. Журнал: все 5 файлов записаны
SELECT filename FROM public.schema_migrations
 WHERE filename IN ('0034_money_path_identity.sql','0035_payment_integrity.sql',
                    '0036_payout_integrity.sql','0037_payout_linkage.sql',
                    '0039_release_readiness.sql');
-- ОЖИДАНИЕ: ровно 5 строк. МЕНЬШЕ → см. §9.

-- 5.2. RPC на месте и с правильными грантами
SELECT proname, proacl::text FROM pg_proc
 WHERE proname IN ('reserve_refund','add_confectioner_balance',
                   'consume_tfa_backup_code','release_escrow_order',
                   'consume_tfa_backup_code_v2','apply_yookassa_refund');
-- ОЖИДАНИЕ: 6 строк; в proacl только service_role (нет anon/authenticated/PUBLIC).

-- 5.3. RLS закрыл журнал финопераций
SELECT relrowsecurity FROM pg_class
 WHERE relname='confectioner_transactions' AND relnamespace='public'::regnamespace;  -- true
SELECT count(*) FROM pg_policies
 WHERE tablename='confectioner_transactions'
   AND policyname='confectioner_transactions_owner_select';                          -- 1

-- 5.4. refund-события
SELECT to_regclass('public.yookassa_refund_events');                                  -- таблица
SELECT conname FROM pg_constraint
 WHERE conrelid='public.yookassa_refund_events'::regclass AND conname LIKE '%amount%';-- CHECK > 0

-- 5.5. CHECK статусов заявки (NOT VALID — валиден для новых строк)
SELECT convalidated, conname FROM pg_constraint
 WHERE conname='payout_requests_status_check';                                        -- false, NOT VALID — норма

-- 5.6. Функциональные пробы (НЕ на боевых данных):
SELECT consume_tfa_backup_code_v2('00000000-0000-0000-0000-000000000000'::uuid, 'probe');
-- ОЖИДАНИЕ: false (кода нет), НЕ ошибка.
SELECT already_processed, total_refunded_kopecks, fully_refunded
  FROM apply_yookassa_refund('00000000-0000-0000-0000-000000000000'::uuid,'probe',10000);
-- ОЖИДАНИЕ: EXCEPTION payment not found (fail-closed), НЕ частичное применение.
```

## 6. Ожидаемые изменения схемы (diff-контроль)

- `orders`: +5 колонок из 0034, +`payout_reserved_at` (0036), +`payout_request_id` (0037)
- `payout_requests`: CHECK `payout_requests_status_check` (NOT VALID)
- `confectioner_transactions`: RLS ON, политика owner_select, REVOKE у anon/authenticated, GRANT SELECT authenticated
- `yookassa_refund_events`: новая таблица (PK refund_id, CHECK amount_kopecks>0, REVOKE у anon/authenticated)
- 6 RPC (§5.2), 2 partial-индекса на orders
- **Никаких DROP/ALTER TYPE/переименований нет.** Данные не переписываются.

## 7. Условия немедленной ОСТАНОВКИ

Прерывать (Ctrl-C / аварийный откат) и НЕ продолжать, если:

1. `pg_restore --list` бэкапа падает или тестовое восстановление не прошло (§3);
2. любая миграция вернула ошибку (fail-fast сработал) — **не править SQL на лету**;
3. `schema_migrations` содержит 0034+, а проверка §2.3 показала незнакомые
   колонки/объекты (схема не та, что ожидалась);
4. длительность одного ALTER на orders превысила ~2 мин (аномалия объёма/блокировок);
5. в момент применения появились долгие транзакции (§2.4) после старта окна.

## 8. План восстановления (rollback)

Все миграции **аддитивные** — старый код работает на новой схеме. Поэтому:

- **Сценарий A (ошибка на середине, код не деплоился):** продолжать НЕ нужно.
  Оставить применённое как есть (безвредно), доделать в следующем окне.
  Полный откат: `pg_restore -U postgres -d postgres --clean --if-exists backup-pre-0034-0039-*.dump`
  (только при потере данных — операция тяжёлая, требует окна простоя).
- **Сценарий B (применено всё, деплой кода не удался):** откатить код на
  предыдущий образ (см. RELEASE_CHECKLIST §1), миграции оставить.
- **Сценарий C (после деплоя кода замечена деградация):** вернуть предыдущий
  образ web; refund-вебхук и выплаты старого кода на новой схеме работоспособны.

## 9. Частично применённый набор (что делать)

1. Зафиксировать фактическое состояние:
   `SELECT filename FROM schema_migrations ORDER BY applied_at;`
2. Прочитать хвост ошибки в логе migrator — файл записывается в журнал
   ТОЛЬКО после успеха, значит неполный файл НЕ оставил артефактов
   (транзакция откатилась целиком).
3. Устранить причину (обычно: соединение оборвалось / исчерпан statement timeout).
4. Повторно запустить migrator — он применит только недостающие файлы
   (повторное применение уже применённых пропускает по журналу; сами файлы
   дополнительно идемпотентны — проверено валидаторами двойным прогоном).
5. Завершить контролем §5 (все 5 файлов, 6 RPC, RLS).

**Запрещено:** отмечать файл в `schema_migrations` вручную, если его SQL
упал с ошибкой; «доприменять» руками фрагменты файла.

## 10. Критерии допуска к деплою кода

- [ ] Бэкап снят И проверен восстановлением (§3)
- [ ] §2 выполнен: журнал, схема, объёмы зафиксированы
- [ ] §5 пройден: 5 файлов в журнале, 6 RPC, RLS true, functional probes ок
- [ ] `scripts/verify-money-path.ts §7+§8` на production-БД: без FAIL
      (`DATABASE_URL=... npx tsx scripts/verify-money-path.ts`)
- [ ] В логах web нет `PGRST202`, `fail-closed`, `COMPENSATION FAILED`

## 11. План деплоя и post-deploy проверки

**T-30 (перед):** бэкап+восстановление §3; freeze деплоев; окно сообщено.
**T-0 (миграции):** §2 → миграции по порядку → §5 → verify-money-path.
**T+5 (сразу после деплоя кода):**

```bash
curl -s https://<домен>/api/health | jq   # status ok, version = sha-<commit>
curl -s -o /dev/null -w "%{http_code}\n" https://<домен>/robots.txt       # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<домен>/sitemap.xml      # 200
```
Главная и каталог открываются, карточка товара рендерится, корзина добавляет
товар (сумма совпадает), оформление создаёт заказ.
**T+15..30:** первый тестовый платёж (тестовый контур YooKassa) → escrow;
админ видит заявку на выплату; reject тестовой заявки возвращает средства
(двойной reject → корректный 409/отсутствие двойного возврата).
**T+24h:** ошибки 5xx < 0.5%; логи без `COMPENSATION FAILED`/`PGRST202`;
баланс тестового кондитера совпадает с суммой начислений (сверка §8
verify-money-path); webhook-логи без `refund_amount_mismatch`.

## 12. Smoke-чеклист покупателя (полный, 10 минут)

Главная → каталог (16 товаров) → карточка → корзина → checkout → заказ в
личном кабинете; повторный вход; логин с 2FA; backup-код одноразов (повтор →
401). Положительный и негативный проход фиксируются в чат-логе релиза.
