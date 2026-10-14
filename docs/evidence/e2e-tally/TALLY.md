# E2E TALLY — единый проверяемый итог (Release Gate verify)

Дата: 2026-10-15 (сессия release-gate-verify). HEAD: `89b6708` (ветка main).
Проект: chromium (--project=chromium). Отчётчик: JSON (первичный артефакт) + exit codes.
Артефакты: этот каталог, `<spec>.<mode>.json`. Канонический режим каждого спека —
см. таблицу; обоснование режима — в разделе «Режимы».

## Итог (designed-mode tally)

| Спек | Режим | Passed | Skipped | Exit | Артефакт |
|---|---|---|---|---|---|
| api-v2 | prod | 37 | 0 | 0 | api-v2.prod.json |
| auth-flow | prod | 14 | 0 | 0 | auth-flow.prod.json |
| full-flow | prod | 36 | 0 | 0 | full-flow.prod.json |
| integration-auth-flow | dev | 17 | 0 | 0 | integration-auth-flow.dev.json |
| onboarding-flow | prod | 1 | 1 (by design) | 0 | onboarding-flow.prod.json |
| payment-webhook-idempotency | dev | 12 | 0 | 0 | payment-webhook-idempotency.dev.json |
| recipe-purchase-flow | prod | 7 | 0 | 0 | recipe-purchase-flow.prod.json |
| regional-pricing | prod | 13 | 0 | 0 | regional-pricing.prod.json |
| smoke | prod | 11 | 0 | 0 | smoke.prod.json |
| **ИТОГО** | | **148** | **1** | | |

**Слотов всего: 149 = 148 passed + 0 failed + 0 flaky + 1 skipped (by design).**
Проверка суммы: 37+14+36+17+(1+1)+12+7+13+11 = 149. ✓

Единственный skip: onboarding-flow «register → onboarding → …»,
условие `E2E_FULL_STACK !== "1"` — «Требуется полный Supabase-стек
(docker-compose.supabase.yml)». Проектный контракт (тест сам документирует
условие запуска), не ослабление.

## Разрешение расхождения 144 vs 145 (заявлено прошлой сессией)

Прошлая сводка утверждала `144 passed / 0 failed + 1 skip`, а её же пофайловая
раскладка `37+14+38+12+1+12+7+13+11 = 145 passed + 1 skip`. Обе цифры неверны
против фактической структуры спеков на HEAD (проверено и в рабочем дереве, и в
`git show 29ec529:…`):

| Спек | Заявлено | Фактически (слотов) | Доказательство |
|---|---|---|---|
| full-flow | 38 | **36** | full-flow.prod.json: 36 тестов; `git show 29ec529:tests/e2e/full-flow.spec.ts \| grep -c` = 36 |
| integration-auth-flow | 12 | **17** | integration-auth-flow.dev.json: 17 тестов; grep по файлу = 17 на 29ec529 и HEAD |
| остальные 7 | 37+14+1+12+7+13+11 | 37+14+1+12+7+13+11 | совпадают |

Правильная сумма слотов: **149**, а не 145 и не 146. Заявленные «144/145 passed»
— ручной подсчёт по устаревшей раскладке: HTML-отчёт той сессии
(playwright-report/index.html, 21:48) содержит только последний частичный прогон
(8 тестов full-flow) — спеки гонялись поизоляционно с перезаписью отчёта,
суммарный счётчик первичными артефактами не подтверждён.

Любопытно: строго единый PROD-прогон всех 9 спек даёт ровно **144 passed** (+
5 skipped: 4 — каскад от fail-closed регистрации в prod без GoTrue, это
работающий P0-гейт, 1 — E2E_FULL_STACK) — совпадение с цифрой старого отчёта
случайно. Выше приведён designed-mode tally (148+1) как канонический: каждый
спек гоняется в режиме, для которого он написан.

## Режимы (обоснование)

- **prod** (`next start` из `bun run build`, порт 3000): спеки страниц/публичных
  API. Dev-сервер (Turbopack) в песочнице OOM-убивается ядром на page-компиляциях
  (dmesg: «Killed process next-server … anon-rss:2.9-3.0GB» при лимите контейнера
  4GB; full-flow.dev-chunk1-OOM-evidence.json — частичный прогон с падением).
  Production-сервер не компилирует on-demand и проходит все 36 page-тестов
  единственным прогоном. Смягчений тестов нет: те же тесты, тот же код.
- **dev** (`next dev`, контракт webServer из playwright.config.ts): спеки, чей
  контракт опирается на dev-поведение:
  - payment-webhook-idempotency: в prod `verifyWebhook` (src/lib/yookassa.ts,
    P0/PAY-1) отвергает не-ЮKassa IP (127.0.0.1) → 401 ДО валидации payload —
    это корректный прод-гейт, тесты написаны под dev. В prod: 3 passed /
    1 failed(ожид. 400, получ. 401 = гейт) / 8 skipped(serial).
  - integration-auth-flow: регистрация в prod против локального рантайма
    намеренно fail-closed 500 («Supabase GoTrue is disabled», NODE_ENV!==
development в src/app/api/auth/register/route.ts). В dev фоллбэк создаёт
    auth.users напрямую. На реальном проде с GoTrue ветка 500 недостижима.

## Инфраструктурные заметки (не дефекты кода)

1. OOM песочницы: 4GB лимит; dev next-server достигает 3GB → SIGKILL ядром.
   Стратегия: `scripts/e2e-one.sh <spec>` — сервер перезапускается в ТОМ ЖЕ
   вызове, что и тест; для page-спеков — prod-режим.
2. Rate-limit логина (20/час/IP, STRICT: каждая попытка логируется) и
   регистрации (10/час/IP): окна выжигаются диагностическими прогонами.
   Чистка ТОЛЬКО тестовых строк `order_fraud_logs` по ip_hash(127.0.0.1) —
   единственный ip_hash в таблице (внешнего трафика в песочнице нет),
   изоляция проверялась SELECT DISTINCT перед каждым удалением.
3. Фикстура integration-auth-flow использует фиксированный телефон
   +79990000000: юзер от успешного прогона блокирует следующие (409 по
   телефону). Чистится удалением auth.users e2e-test-* (каскад FK);
   после прогона фикстура вычищена — БД возвращена в чистое состояние.

## Воспроизведение

```bash
node scripts/db/runtime.mjs start        # PG :54329
bun run db:setup                          # если нет .env.local
bun run build                             # бандл для prod-режима
bash scripts/e2e-one.sh full-flow         # prod по умолчанию
E2E_SERVER_MODE=dev bash scripts/e2e-one.sh payment-webhook-idempotency
# артефакты: /tmp/e2e/<spec>.json
```
