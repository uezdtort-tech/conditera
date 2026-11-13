# FINAL PRODUCTION BUILD & RUNTIME SMOKE REPORT — Conditera

**Дата:** 2026-11-13 (UTC). **Задание:** Z-v33 continuation — exact Release Candidate `2cfa76b0ed7b536a41458a0de939cdc84626b4f2`, production build + runtime smoke F1–F6. Без изменения кода, без push, без deploy.

## Вердикт: **BLOCKED** — INSUFFICIENT RESOURCES (+ commit отсутствует в origin)

Production build не выполнялся: среда снова ~3.9 GiB RAM без swap (правило задания §3: «Если среда снова имеет около 4 GB RAM без swap, не запускай production build. Укажи BLOCKED: INSUFFICIENT RESOURCES»). Все не зависящие от сборки обязательные проверки выполнены непосредственно командами — кодовая база на точном коммите валидна, дефектов не обнаружено.

---

## A. Exact source

| Параметр | Факт (проверено командами) |
|---|---|
| Repository | `origin → https://github.com/uezdtort-tech/conditera.git` (`git remote -v`) |
| Branch | `main` |
| Exact commit (итоговый HEAD) | **`2cfa76b0ed7b536a41458a0de939cdc84626b4f2`** — `git rev-parse HEAD` |
| origin/main (после `git fetch origin`, exit 0) | `8a31081f40a752f9cef785f67616af6659bcf7e1` |
| Commit в origin? | **НЕТ** — `2cfa76b` локальный (283 коммита впереди origin/main, 0 позади; fast-forward подтверждён `merge-base --is-ancestor`). Это ожидаемое состояние: push по всем предыдущим заданиям заморожен до решения владельца. Следствие: клонирование требуемого коммита в CI-workspace невозможно до push. Верификация выполнена в существующей рабочей копии (разрешено заданием: «Не используй существующую рабочую директорию, если её состояние вызывает сомнения» — состояние проверено полностью, сомнений нет). Подмена на origin/main или более новый HEAD НЕ производилась |
| Snapshotter-джанк-коммит | На старте сессии HEAD был `ce0d4525ffc31d775d48c2c2aecb769a2bec10bc` (автор `z@container`, UUID-сообщение, 21:36:15 UTC) — авто-коммит песочницы, содержащий ровно один файл: незакоммиченный отчёт предыдущего гейта (228 insertions, `docs/release/FINAL_PRODUCTION_BUILD_AND_SMOKE_REPORT.md`). Код НЕ затронут. Удалён точечно: `git reset --soft 2cfa76b…` + `git restore --staged <отчёт>` (без `--hard`, без изменения контента; SHA `ce0d452` восстановим из reflog). После очистки HEAD == требуемый коммит байт-в-байт |
| Protected files (4 upload) | ПРИСУТСТВУЮТ на диске и в HEAD; `git ls-files -v` → `H H H H` (без skip-worktree); blobs == HEAD |
| Hooks/guards | `core.hooksPath=scripts/hooks`; `scripts/hooks/pre-commit` отслеживается, blob совпадает с HEAD, исполнение → exit 0; redline-тест `src/lib/redline-paths.test.ts` — 9/9 PASS (vitest, предыдущий прогон этого же дерева 21:29 UTC) |
| Дерево до начала тестов | Чистое (`git status --short` пуст; `git diff --exit-code` пуст) |

## B. Environment

```text
free -h:  Mem: 3.9Gi total / 2.0Gi avail (dev-сервер+PG активны)   Swap: 0B
df -h:    9.9G total / 6.2G avail
nproc:    2          kernel: 5.10.134-013.15.kangaroo.al8.x86_64
node:     v24.22.2   bun: 1.3.14 (package manager проекта — bun, scripts в package.json)
sudo:     недоступен (пароль) → создать swap/нарастить память невозможно
```

| Ресурс | Факт | Минимум задания | Статус |
|---|---|---|---|
| RAM | 3.9 GiB, swap 0 | 8 GB | **НЕ СООТВЕТСТВУЕТ** |
| CPU | 2 | 2 | OK |
| Свободный диск | 6.2 GB | 15 GB | **НЕ СООТВЕТСТВУЕТ** |
| Прецедент | `bun run build` в этой среде OOM-kill (exit 137) на фазе TypeScript (Z-v26, Z-v32) | — | задокументирован |

## C. Dependencies

- Команда: `bun install --frozen-lockfile` → **exit 0**, «Checked 1124 installs across 1245 packages (no changes)».
- После установки: `git status --short` → только untracked-отчёт; `git diff --exit-code` и `git diff --cached --exit-code` — пустые. **Lockfile, package.json и конфигурация не изменены.** PASS.

## D. Build environment (классификация переменных)

По `next.config.ts` (прочитан полностью) и `docs/release/PRODUCTION_ENVIRONMENT_REQUIREMENTS.md` §1:

| Класс | Переменные | Требуется для BUILD? |
|---|---|---|
| Build-time | `NEXT_PUBLIC_APP_URL` (опц., fallback `conditera.ru`), `SENTRY_DSN` (опц.), `SUPABASE_STORAGE_HOSTNAME`/`_PROTOCOL` (опц., расширение image-whitelist) | Нет обязательных; сборка не требует ни одного секрета |
| Runtime | `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `TFA_ENCRYPTION_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Только runtime (`bun run start`) |
| Production-only secrets | `YOOKASSA_SHOP_ID/SECRET_KEY`, OAuth (`YANDEX_*`, `VK_*`, `GOOGLE_*`), `MAILGUN_*`/SMTP, `TELEGRAM_*` | Только после включения функций владельцем |
| Optional integrations | `N8N_*`, `BOT_SECRET`, `OLLAMA_*`, `VAPID_*`, `SMTP_*` | Опционально |

`.env.local` из dev-среды НЕ копировался в build-контекст; production secrets не использовались и не подменялись. Косвенное подтверждение: предыдущие сборки в этой песочнице (Z-v26/Z-v32) проходили конфиг- и compile-фазы без production-секретов и падали только на ресурсов (TypeScript, OOM).

## E. Production build — **NOT RUN / BLOCKED: INSUFFICIENT RESOURCES**

`bun run build` не запускался по прямому правилу задания (§3): среда 3.9 GiB RAM без swap < минимума 8 GB; обход через отключение проверок/манипуляции параллелизмом запрещён и не применялся. Подмена сборки tsc/eslint/vitest не проводилась. Точная команда, log и артефакты — отсутствуют по причине BLOCKED, не по ошибке кода.

## F. Production server start — **NOT RUN** (строго зависит от E)

`bun run start` не запускался; dev-сервер песочницы не использовался как замена production smoke.

## G. Isolated database verification

- **Изоляция подтверждена:** приложение и все проверки указывают на `@127.0.0.1:54329/` (embedded PostgreSQL 18.4, тестовая БД `conditera`); production DB не существует в этой среде, миграции на неё не применялись. Полный fresh-apply 85/85 миграций с пустым filename-diff выполнен на этом же кластере предыдущим gate-прогоном (2026-11-13 21:31 UTC) и подтверждён сейчас: `SELECT count(*) FROM schema_migrations` → **85** = 85 файлов в `supabase/migrations` (без повторного аудита, как разрешено заданием).
- **Тестовые данные:** seed/demo-аккаунты (`customer@demo.ru`, `confectioner@demo.ru`, `admin@demo.ru` и др.) — только в локальной тестовой БД; в реальных пользовательских системах тестовых записей нет.
- **`order_items.price_version_id IS NULL` — происхождение УСТАНОВЛЕНО (resolved, не дефект рантайма):** единственная строка с NULL — позиция демо-заказа `DEMO-1048` (id `c4feed42-9169-4c8a-956e-315e09165258`, `metadata {"test":"demo","fixture":"ops-center"}`, created_at 2026-11-13T21:31:59 — момент `db:setup`). Создаётся сидом `scripts/db/seed-ops-center.mjs` **напрямую SQL-INSERT'ами** (строки 154 и 173: `INSERT INTO public.orders VALUES ('DEMO-1048',…)` и `INSERT INTO public.order_items … WHERE o.number='DEMO-1048'`), минуя checkout-API — поэтому цена-версия не привязывается. Историческая seed-запись не изменялась.
- **`price_version_id` для нового заказа:** на production-рантайме НЕ проверено (нет production-сервера) — **NOT RUN**. Механизм подтверждён коммиченными тестами коммита `2cfa76b` (checkout `price-version-bind.test.ts`, checkout-idempotency-набор 15/15 на живом PG — доказательства Z-v33, `RELEASE_CANDIDATE.md` §2 строки 8/13) и FK `order_items_price_version_id_fkey → product_price_history` (проверено SQL на тестовой БД).

## H. Runtime smoke F1–F6 — **NOT RUN (полностью)**

Зависимы от Stage E/F. По каждому пункту:

| Секция | Статус | Причина |
|---|---|---|
| F1 Public storefront | **NOT RUN** | нет production build/server |
| F2 Authentication | **NOT RUN** | нет production build/server; реальный OAuth (Yandex/VK) — NOT RUN независимо: credentials и callback URLs владельцем не предоставлены; кнопки не считаются доказательством |
| F3 Buyer workflow | **NOT RUN** | нет production build/server; платёжный сценарий — NOT RUN: production YooKassa credentials отсутствуют, stub не выдаётся за реальный платёж |
| F4 Confectioner workflow | **NOT RUN** | нет production build/server (включая повторный accept/checkout предложения — покрыты юнит/роут-тестами коммита, не живым production-прогоном) |
| F5 Admin workflow | **NOT RUN** | нет production build/server |
| F6 Security/error handling | **NOT RUN** | нет production build/server; контрактные гарантии (401/403/409/410/422/429, blocked-session, role-guard, ownership) — в 1922 зелёных тестах коммита, не живые пробы |

## I. Findings

- **Critical:** нет.
- **High:** нет.
- **Medium:** нет (в рамках выполненного объёма проверок).
- **Low:** snapshotter песочницы создаёт джанк-коммиты (UUID-сообщения) поверх HEAD — среда, не код; у проекта есть протокол защиты (`protected-paths.sh`, pre-commit hook-guard), в этой сессии сработало удаление soft-reset'ом.
- **Resolved (бывший unresolved-кандидат):** `price_version_id IS NULL` в seed-данных — происхождение установлено (см. §G), НЕ дефект.
- **Unresolved:** нет.
- **NOT RUN (обязательные):** production build; production server; smoke F1–F6 полностью; price_version_id для нового заказа на production-рантайме; живые OAuth/payment пробы. Причина единственная — среда (RAM/swap/диск) и отсутствие требуемого коммита в origin для CI-workspace пути.

## J. Git integrity

| Проверка | Факт |
|---|---|
| Исходный HEAD (старт сессии) | `ce0d4525…` (snapshotter-джанк поверх `2cfa76b`; удалён soft-reset, SHA в reflog) |
| Итоговый HEAD | **`2cfa76b0ed7b536a41458a0de939cdc84626b4f2`** |
| `git status --short` | только `?? docs/release/FINAL_PRODUCTION_BUILD_AND_SMOKE_REPORT.md` (итоговый отчёт, по заданию) |
| `git diff --check` / `--exit-code` / `--cached --exit-code` | чисто / пусто / пусто |
| Lockfile / package.json | не изменены (frozen-install «no changes») |
| Protected routes / hooks / guards / redline | не изменены (§A) |
| Commit / push / merge / deploy | НЕ выполнялись |
| Новые файлы | только итоговый отчёт; build-артефакты не создавались (сборка BLOCKED); `.next/dev` — gitignored dev-кэш работающего dev-сервера, к исходникам не относится |

## K. Final verdict

**BLOCKED** — этапы E–H невозможны из-за среды: RAM 3.9 GiB без swap (< 8 GB минимума), диск 6.2 GB (< 15 GB), без sudo; и требуемый коммит `2cfa76b` отсутствует в origin (origin/main = `8a31081`; push заморожен до решения владельца), что блокирует CI-workspace путь. Обязательные проверки, не зависящие от сборки, — пройдены с доказательствами (§A, §C, §G, §J). Подтверждённых технических ошибок/регрессий/security-дефектов кода на коммите `2cfa76b` не обнаружено.

### Что конкретно остаётся сделать владельцу

1. **Предоставить среду** ≥ 8 GB RAM (рек. 12–16), ≥ 15 GB диска, 2+ CPU, желателен swap 4–8 GB — CI runner или машина с доступом к коммиту.
2. **Обеспечить доступ к коммиту `2cfa76b`** в этой среде: либо approve `git push origin main` (283 коммита, fast-forward, без force), либо перенос репозитория на машину гейта иным способом — по выбору владельца.
3. На среде выполнить: `bun install --frozen-lockfile` → `bun run build` (критерий PASS ⇔ exit 0 + `.next` артефакты) → `bun run start` с `DATABASE_URL` на изолированную тестовую БД → smoke F1–F6 (чек-лист — §H задания; stub-платежи не считать YooKassa).
4. Заполнить production env по `docs/release/PRODUCTION_ENVIRONMENT_REQUIREMENTS.md` §1/§5 — только runtime-фаза, на сборку не влияет.
5. После PASS: push/deploy — отдельные решения владельца; настоящий отчёт разрешения на публикацию не даёт.

*Push/deploy не выполнялись. Отчёт не коммитился. Ожидаю решения владельца.*
