# Z-V22_POST_ACCEPTANCE_CHECK — независимый пост-приёмочный прогон

**Дата:** 2026-11-11 (Europe/Moscow) · Ветка `main` · Вопрос владельца: «всё из плана выполнил?»
Метод: **фактические прогоны в этой сессии** (не перенос заявлений из доков). Коммиты не пушатся.

## 1. Вердикт

# `VERIFIED WITH LIMITATIONS`

Все локально доступные проверки из плана верификации **воспроизведены фактически в этой сессии**
(см. §3, exit-коды приложены). Найден и исправлен 1 дефект тест-обвязки (§4, D-1).
Ограничения — только внешние, известные и задокументированные (§5): push/CI, staging,
живые интеграции и запуск n8n-движка требуют действий владельца.

## 2. Git Ground Truth

| Параметр | Факт |
|---|---|
| Ветка | `main` |
| HEAD | `89eaf2a` (Z-v22 fix) → `de15be0` (Z-v21 docs) → `01886c1` → `c4a7a9f` → `7e59353` → `1505c0b` (Z-v20) |
| Рабочее дерево | чистое (0 изменений после коммита) |
| Ahead / behind | **230 ahead / 0 behind** — push НЕ выполнялся (запрет соблюдён) |
| Guard | `core.hooksPath=scripts/hooks`; pre-commit → `protected-paths.sh hook-guard` — на месте, не менялся |
| Защищённые файлы (4) | на диске: upload route 3158B, upload test 8479B, services upload route 3175B, services upload test 8367B; флаги нормальные (`H`); содержимое не читалось |
| Push/merge/deploy/внешние миграции | **НЕ выполнялись** |

## 3. Фактические прогоны (эта сессия, всё exit 0)

| Проверка | Результат | Примечание |
|---|---|---|
| `tsc --noEmit` | PASS | exit 0 |
| `eslint .` | PASS | exit 0 |
| `vitest run --no-file-parallelism` | **PASS 109 файлов / 1571 теста** | совпадает с заявлением Z-v21 |
| `route-error-coverage.mjs` | **PASS 47/48** | периметр вырос с 47 до 48 маршрутов |
| `order-lifecycle-verify.mjs` | **PASS 81/81** | escrow→…→delivered, гонки, at-risk, capacity |
| `diagnostics-verify.mjs` | **PASS 16/16** | включая retention-cleanup (20 событий + incidents) |
| `checkout-idempotency-verify.mjs` | **PASS 15/0** | очистка подтверждена |
| `inventory-concurrency-verify.mjs` | **PASS 8/8** | без отрицательных остатков/lost updates |
| `ops-center-verify.mjs` | **PASS 37/37 ×2** | после фикса D-1 (§4); повтор — доказательство стабильности |
| `backup-verify-restore.mjs` (bun) | **PASSED** | 15 таблиц src=backup=restore; disposable создана/удалена; рабочая БД не тронута |
| `/api/upload` POST без auth | **403** | живая проверка |
| `/api/admin/diagnostics/metrics` без auth | **401** | живая проверка |
| 5 workflow YAML (`ci/deploy/e2e/staging-deploy/maintenance`) | все парсятся | GitHub Actions по-прежнему NOT RUN (нет push) |
| cart-sync замена | `cart-merge.test.ts` + `cart-sync-adoption.test.ts` | оба зелёные в составе 1571 |

## 4. Дефекты и разбор причин

### D-1. ops-center-verify: 35/37 после полуночи — ИСПРАВЛЕН (коммит `89eaf2a`)
- **Симптом:** «DEMO-1048 в "Заказах сегодня"» и «revenueToday включает DEMO-1048» провалились при повторном прогоне, хотя Z-v21 задокументировал 37/37.
- **Первопричина:** тест опирался на демо-фикстуру `DEMO-1048` с фиксированной `delivery_date = 2026-11-10`. API (`confectioner-today`, строка 148) корректно фильтрует `delivery_date = CURRENT_DATE`, а revenueToday — `paid_at::date = CURRENT_DATE`. Прогон Z-v21 (23:51 UTC 10.11) шёл «в тот же день» и был честным; после смены календарного дня фиксстура закономерно ушла из «сегодня» → **ложнопровал при корректном продукте**.
- **Класс дефекта:** календарная хрупкость тест-обвязки (зависимость от даты создания демо-данных), не дефект продукта.
- **Фикс:** скрипт создаёт собственный заказ `OPSVERIFY-TODAY-*` с `delivery_date = CURRENT_DATE`, `paid_at = now()`, total 37000, в cleanup. Прогон: 37/37 дважды.

### D-2. backup-verify-restore под plain `node` падает (несущественно, задокументировано)
- **Причина:** `scripts/ops/run-backup.mjs` использует алиас `@/lib`, который plain Node не резолвит; документированная команда `bun scripts/ops/backup-verify-restore.mjs` (BACKUP_RECOVERY_READINESS.md, строка 5) работает — подтверждено прогоном.
- **Рекомендация (низкий приоритет):** runtime-гвард в скрипте: если запущено через `node` — внятное сообщение «запускайте через bun/tsx» вместо сырого ERR_MODULE_NOT_FOUND.

### D-3. Историческая «46/47» route-coverage — закрыта ранее (Z-v19, `f79ed46`), причина установлена
1. Маршрут `orders/[id]/capacity` отсутствовал в периметре (5xx не регистрировался) — добавлен.
2. Гвард проверял **упоминание** `handleRouteError` (`source.includes`), а не **вызов** — импортная строка давала false positive (найдено на `src/app/api/orders/route.ts`). Усилено: вырезание комментариев + regex синтаксиса вызова.

## 5. Ограничения (внешние, без изменений — OWNER_ACTIONS_REQUIRED)

1. **Push/CI:** 230 коммитов не опубликованы; build-гейт не выполнялся нигде (песочница OOM) → A-1.
2. **Staging:** не развёрнут (нет разрешения/инфраструктуры) → A-2.
3. **YooKassa sandbox / Yandex OAuth / n8n движок:** приёмка невозможна без credentials/инстансов → A-4/A-6/A-7.
4. **VK ID:** продуктовое решение владельца → A-5.
5. **n8n:** движок не запущен; приложение→stub-receiver (:5678) подтверждено живыми событиями; идемпотентность доставки (eventId) и события escalation/critical error — задокументированные пробелы (N8N_ACCEPTANCE §3, §5).

## 6. Следующий шаг

Не изменился: **A-1 (push в main) → зелёный GitHub Actions на опубликованном SHA** → staging по A-2.
