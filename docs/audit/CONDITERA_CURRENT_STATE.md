# CONDITERA — Текущее состояние (Pre-Change Gate)

**Дата аудита:** 2026-11-02 (Европа/Москва)
**Аудитор:** Z (ведущий инженер Conditera)
**Контрольные SHA:** до работы `48e4331` → после работы см. раздел «Коммиты»
**Репозиторий:** github.com/uezdtort-tech/conditera, ветка `main` (локальная, ahead 165 от origin/main — не публиковалась, push запрещён без разрешения владельца)

---

## 1. Git-состояние до начала работы

| Параметр | Значение | Доказательство |
|---|---|---|
| Рабочая директория | `/home/z/my-project` = клон `uezdtort-tech/conditera` | `git remote -v` |
| Ветка | `main` @ `48e4331` | `git branch --show-current`, `git log` |
| Worktree/staging | **Чистые** (0 незакоммиченных, 0 untracked) | `git status --porcelain \| wc -l` → `0` |
| Stash | пуст | `git stash list` |
| Относительно origin | `ahead 165`, позади 0 | `git rev-list --count origin/main..main` |
| Внешний worktree | `/home/z/gate20` (prunable, не тронут) | `git worktree list` |
| Защищённые upload-файлы | 4 файла, все присутствуют, флаг `S` (skip-worktree) | `git ls-files -v \| rg "^S "` |
| Pre-commit guard | `core.hooksPath=scripts/hooks`, `pre-commit → scripts/protected-paths.sh hook-guard` | чтение файлов |
| `.env.local` | присутствует (1278 байт) — секреты не раскрывались | `ls -la` |

## 2. Верификация отчёта 0644854 (не доверять отчётам без кода)

Каждое заявление отчёта проверено **по фактическому коду и живому воспроизведению**:

| Заявление отчёта | Фактическое состояние | Коммит-доказательство | Живая проверка 2026-11-02 |
|---|---|---|---|
| Курьеру не хватает серверных mutation | **Исправлено**: PATCH `/api/courier/deliveries/[id]` `{action:"pickup"}` (CAS `.eq(status,'assigned')`); завершение через существующий PATCH `/api/orders/[id]` `{status:"DELIVERED"}` + fail-safe синхронизация строки `deliveries` | `22eff00` | PASS: pickup 200→`picked_up`+`pickup_at`; повтор →409; завершение →`delivered`+`delivered_at`+`courier_earnings=350` (проверено в БД) |
| `/api/admin/dashboard` в dev отдаёт stub не-администратору | **Исправлено**: 401/403 в любом окружении, 503 при недоступности БД, `stub:false`, реальные RPC `revenue_today/revenue_month` | `d71b96f` | PASS: аноним →401, CUSTOMER →403, ADMIN →200 со счётчиками реальной БД (20 юзеров/2 заказа) |
| `user_holidays.user_id does not exist` в dev.log | **Исправлено**: `/api/holidays` переведён с фантомной схемы legacy `user_holidays` на реальную `holiday_reminders` (0010: `user_id UUID FK`, `date DATE`, `is_recurring`); cron читает реальные колонки | `d71b96f` | PASS: GET 200 (system+user), POST 201 + строка в БД (`date=2027-03-08`, клэмп 29.02→28.02), DELETE свой 200, чужой 404, аноним POST 403 |

Дополнительно подтверждены коммиты `8c3b5c6` (кабинеты покупателя/поставщика/курьера на app-JWT) и `0a8de5d` (кабинет кондитера) — наследие 8-го поколения реально в истории, не только в отчётах.

## 3. Проверено живьём 2026-11-02 (dev-сервер localhost:3000 + embedded PG 54329 + agent-browser)

| Сценарий | Результат | Доказательство конечного состояния |
|---|---|---|
| Логин customer@demo.ru (UI) | PASS | cookie `cd_session` + приветствие «Вы вошли как Демо Покупатель» |
| Chat: отправка до reload (UI) | PASS | сообщение в треде + превью комнаты |
| Chat: **reload** → переоткрытие → история | PASS | 2 сообщения в треде без дублей (персист + дедуп), скриншот `/tmp/chat-after-reload.png` |
| Chat: отправка после reload | PASS | 3-е сообщение доставлено |
| Chat: идемпотентный повтор POST | PASS | `duplicate:true`, одна строка в `chat_messages` |
| Chat: изоляция — чужой GET/POST | PASS | 403 «Нет доступа к комнате»; аноним 401 |
| Chat: персистенция в БД | PASS | 3 строки `chat_messages.channel_id=1788b17c…` |
| Курьер: аноним pickup | PASS | 403 CSRF |
| Курьер: CUSTOMER pickup | PASS | 403 «Требуется роль: COURIER» |
| Курьер: повторный pickup | PASS | 409 CAS «Недопустимый переход» |
| Курьер: полный цикл assigned→picked_up→delivered | PASS | `deliveries.status=delivered`, `pickup_at`, `delivered_at`, `courier_earnings=350`, `order_status_history` (`changed_by`=курьер) |
| Номер заказа в кабинете курьера | PASS | «Заказ DEMO-2001», не UUID |
| Admin: аноним/не-админ/админ | PASS | 401 / 403 / 200 `stub:false` |
| Holidays: полный CRUD + ownership | PASS | см. раздел 2 |
| Rate-limit логина | PASS (живой) | 22 попытки/час → 429 с `Retry-After` (зафиксирован в network-логе браузера) |
| **Смена аккаунта customer→курьер** | **FAIL → исправлено** | см. `CONDITERA_DEFECT_REGISTER.md` D-01 |

## 4. Чего НЕ проверено (честные границы)

- Production build (`bun run build`) — **запрещён** ограничением среды (дважды приводил к OOM-kill next-server; в dmesg зафиксированы 2 kill за сессию). Сборка не выполнялась.
- OAuth (Яндекс/VK) callback-и — не воспроизводились (нужны внешние провайдеры).
- PAY-2 webhook внешнего провайдера — покрыт 15 unit-тестами (`payment/webhook/route.test.ts`), живой вызов провайдера не выполнялся (демо-среда).
- Реальный socket.io-прод сценарий под нагрузкой — проверено подключение и «онлайн (real-time)» индикатор; дропы/реконнект-буферизация покрыты unit-тестами, но не хаос-инжинирингом.

## 5. Инфраструктура

- dev-сервер: Next.js 16.3.5 (Turbopack), порт 3000, supervisor-перезапуск; известная системная проблема — OOM-kill next-server при RSS ~2.5 ГБ (дважды за сессию; митигируется перезапуском, `bun run build` запрещён).
- chat-server: mini-service на порту 3030 (`bun --hot index.ts`) — жив весь сеанс.
- Embedded PostgreSQL: 127.0.0.1:54329, миграции 0001–0063 (63 файла, 0062 cart-sync, 0063 financial ledger — PAY-2 подтверждён).
- Drift-защита: skip-worktree на 4 защищённых upload-файлах + pre-commit guard — **активны**, инцидентов за сеанс не было.
