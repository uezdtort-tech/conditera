# E2E TALLY — AGGREGATED PER-SPEC CANONICAL TALLY (не единый прогон)

Статус документа: **агрегированный по-спековый канонический tally**. Каждый спек
гоняется ОТДЕЛЬНО в своём designed-mode (см. «Режимы»), суммы складываются по
каноническим прогонам. Это НЕ единый монолитный прогон всех спеков одним
вызовом — единый prod-прогон даёт иную (тоже честную) цифру, см. историю ниже.

- Сессия снятия исходной девятки: release-gate-verify, HEAD `89b6708` (2026-10-14/15).
- Независимая авто-верификация тех же артефактов: HEAD `7a8d878`
  (docs/evidence/release-gate/e2e-tally-verify-7a8d878.txt).
- Пост-фиксовые прогоны integration-auth-flow (DEV-05, детерминизм фикстур):
  HEAD `f28b090` (run1) и `d2f192b` (run2; впоследствии `d2f192b` amended в
  `d82d5f6` параллельным агентом — см. «Provenance SHA исходников», п. 3),
  2026-10-15.
- Машиночитаемый контракт: `tally-contract-<HEADshort>.json` в этом каталоге,
  генерируется и проверяется командой:

```bash
node scripts/verify/e2e-tally-contract.mjs   # exit 0 = контракт выполнен
```

## Per-spec runtime contract (канонические прогоны)

| Спек | Режим | Команда | SHA | DB | Артефакт | Exit | Passed | Failed | Flaky | Skipped | Skip-причина |
|---|---|---|---|---|---|---|---|---|---|---|---|
| api-v2 | prod | e2e-one.sh api-v2 | 89b6708 | pg-54329* | api-v2.prod.json | 0 | 37 | 0 | 0 | 0 | — |
| auth-flow | prod | e2e-one.sh auth-flow | 89b6708 | pg-54329* | auth-flow.prod.json | 0 | 14 | 0 | 0 | 0 | — |
| full-flow | prod | e2e-one.sh full-flow | 89b6708 | pg-54329* | full-flow.prod.json | 0 | 36 | 0 | 0 | 0 | — |
| integration-auth-flow | dev | E2E_SERVER_MODE=dev e2e-one.sh integration-auth-flow | f28b090 | pg-54329* | integration-auth-flow.dev.f28b090-run2.json | 0 | 17 | 0 | 0 | 0 | — |
| onboarding-flow | prod | e2e-one.sh onboarding-flow | 89b6708 | pg-54329* | onboarding-flow.prod.json | 0 | 1 | 0 | 0 | 1 | E2E_FULL_STACK≠1: Требуется полный Supabase-стек |
| payment-webhook-idempotency | dev | E2E_SERVER_MODE=dev e2e-one.sh payment-webhook-idempotency | 89b6708 | pg-54329* | payment-webhook-idempotency.dev.json | 0 | 12 | 0 | 0 | 0 | — |
| recipe-purchase-flow | prod | e2e-one.sh recipe-purchase-flow | 89b6708 | pg-54329* | recipe-purchase-flow.prod.json | 0 | 7 | 0 | 0 | 0 | — |
| regional-pricing | prod | e2e-one.sh regional-pricing | 89b6708 | pg-54329* | regional-pricing.prod.json | 0 | 13 | 0 | 0 | 0 | — |
| smoke | prod | e2e-one.sh smoke | 89b6708 | pg-54329* | smoke.prod.json | 0 | 11 | 0 | 0 | 0 | — |
| **ИТОГО** | | | | | | | **148** | **0** | **0** | **1** | |

Слотов всего: **149 = 148 passed + 0 failed + 0 flaky + 1 skipped (by design)**.
Проверка суммы: 37+14+36+17+(1+1)+12+7+13+11 = 149. ✓

\* Режим БД не фиксируется ВНУТРИ артефакта (JSON-репортер Playwright не пишет
env прогона); столбец отражает зафиксированный стек сессии снятия: embedded
PostgreSQL :54329 (`node scripts/db/runtime.mjs start`), один и тот же для всех
прогонов. Exit-код также не хранится в артефакте — колонка из журнала
исполнения раннера (у e2e-one.sh exit = exit-код playwright).

## Идентичность, дубликаты и правила исключения (проверяются верификатором)

Идентичность прогона = **(spec, recorded-mode, projectNames, startTime из
stats)** — никогда не «угадывание по имени файла». Правила исключения из
канонических сумм (R1–R3), каждое применимо по метаданным, не «по вкусу»:

- **R1-oom-evidence**: `full-flow.dev-chunk1-OOM-evidence.json` — частичный
  прерванный dev-прогон (8 passed / 2 failed), сохранён как СВИДЕТЕЛЬСТВО OOM
  песочницы (dmesg SIGKILL next-server, anon-rss ~3.0GB при лимите 4GB).
  В суммы не входит.
- **R2-duplicate-copy**: `integration-auth-flow.early-prod.json` и
  `integration-auth-flow.prod.json` — побайтно идентичны (одинаковый sha256,
  одинаковый startTime `2026-10-14T23:19:17.589Z`) → это ОДИН логический
  прогон, сохранённый под двумя именами; учитывается один раз. Правило
  включения/исключения — по timestamp внутри артефакта (stats.startTime),
  не по имени.
- **R3-non-canonical-mode-diagnostic**:
  - `payment-webhook-idempotency.prod.json` (3 passed / 1 failed / 8 skipped):
    диагностический prod-прогон — в prod `verifyWebhook` (src/lib/yookassa.ts,
    P0/PAY-1) отвергает не-ЮKassa IP (127.0.0.1) → 401 ДО валидации payload.
    Это КОРРЕКТНЫЙ прод-гейт, задокументированный в «Режимах»; designed-mode
    спека — dev.
  - `integration-auth-flow.prod.json` (+ его побайтный дубликат
    `.early-prod.json`): recorded-mode «prod», но артефакт НЕ подтверждает
    прод-контракт (см. «Provenance: recorded-mode vs поведение» ниже);
    designed-mode спека — dev, прогон диагностический.

## Provenance SHA исходников

В самих артефактах SHA исходников **отсутствует** (JSON-репортер Playwright не
встраивает hash исходников; верификатор помечает каждый артефакт
`sha-absent-in-artifact`). Происхождение фиксируется из независимых источников:

1. Артефакты исходной девятки (startTime 2026-10-14T23:xx): сессия
   release-gate-verify при HEAD `89b6708` (заголовок этого документа);
   независимо пере-верифицированы на `7a8d878`
   (docs/evidence/release-gate/e2e-tally-verify-7a8d878.txt, тот же итог
   148/0/0/1/149).
2. Артефакты конвенции `<spec>.<mode>.<HEADshort>-run<N>.json` (DEV-05):
   короткий SHA HEAD закодирован в ИМЕНИ файла — `…f28b090-run1.json` /
   `…f28b090-run2.json` (run2 — после переименования, см. п. 3).
3. run2-артефакт изначально сохранён как `…d2f192b-run2.json`; коммит
   `d2f192b` был amended в `d82d5f6` во время параллельного DEV-17 fold-back
   (содержимое свидетельства не затронуто — spec-код между прогонами идентичен);
   переименован в резолвящегося родителя `f28b090` (commit d2f192b не достижим
   ни от одного ref'а и не резолвится в свежем клоне; `f28b090` — новейший
   коммит, существовавший на момент прогона run2 и присутствующий в истории).
   Фактический HEAD прогона run2 = `d2f192b` зафиксирован здесь и в таблице
   «Детерминизм фикстур» ниже.

### Provenance: recorded-mode vs поведение (честная фиксация расхождения)

`integration-auth-flow.prod.json` записан как «prod» (по имени), но содержит
17/17 passed ВКЛЮЧАЯ «Register → 201», тогда как прод-контракт регистрации в
локальном рантайме — fail-closed 500 (заглушка GoTrue `/auth/v1/*` отвечает
501, см. src/app/auth/v1/[...path]/route.ts; при NODE_ENV≠development регистр
отвечает 500). Следовательно записанный режим этого артефакта подтверждён быть
не может (метаданные репортера NODE_ENV/env не сохраняют). Артефакт оставлен в
репозитории как диагностический (R3), в суммы не входит; канонический режим
спека — dev, где dev-фоллбэк создаёт auth.users напрямую. ПОВЕДЕНЧЕСКИЙ
инвариант прод-режима регистрация не проверялся повторно в этой сессии
(требуется `bun run build` + prod-прогон) — помечено как открытая точка
верификации, не влияющая на канонические суммы.

## Детерминизм фикстур integration-auth-flow (TZ §8.2, DEV-05)

Дефект: телефон фикстуры был ФИКСИРОВАННЫМ (+79990000000) — пользователь от
успешного прогона блокировал следующий (409 «Телефон уже зарегистрирован»), а
409 ошибочно классифицировался как «email занят» → `test.skip()` → каскадные
skip шагов 2–4. Исправлено в tests/e2e/integration-auth-flow.spec.ts:

1. **Per-run уникальные фикстуры**: email `e2e-<runid>@e2e.test` (домен .test —
   RFC 2606, явно синтетический), телефон `+7999XXXXXXX` (7 случайных цифр из
   UUID на прогон). Константы экспортированы для переиспользования.
2. **409 классифицируется по телу ответа**, не догадкой: маршрут
   (src/app/api/auth/register/route.ts, шаги 3–4) возвращает
   `{error:"Email уже зарегистрирован"}` или
   `{error:"Телефон уже зарегистрирован"}` → тест помечает PHONE_TAKEN /
   EMAIL_TAKEN / CONFLICT_UNKNOWN_REASON и ПАДАЕТ (skip запрещён). 429
   (anti-fraud) и 500 тоже падают с точной диагностикой (error + retryAfter).
3. **Каскадные skip убраны**: `test.describe.serial` удалён (серийный режим
   Playwright сам скипает последующие тесты после падения — тот же каскад под
   другим именем); шаги 2–3 проверяют предпосылки expect'ами и честно падают;
   шаг 4 — независимый CSRF-негатив (предпосылка «есть access token» снята —
   она не нужна по смыслу теста). Единственный разрешённый skip во всём
   e2e-сьюте — E2E_FULL_STACK (onboarding-flow.spec.ts:60, условие проверяется
   независимо).

Скорректированные аудитом фикстуры прочих спеков (без изменений кода):

- `auth-flow.spec.ts:30` — фиксированные `test@example.com`/`+79999999999`
  в НЕГАТИВНОМ тесте валидации (пароль «123» → 400 ДО проверки уникальности,
  состояние в БД не создаёт; 429 принят как честный отказ strict-лимитера).
  Недостижим для 409 → детерминичен, оставлен как есть.
- `onboarding-flow.spec.ts:33` — уже per-run уникальные (`+7900<TS-7>`,
  email с TS); спек под E2E_FULL_STACK.

**Два подряд идущих прогона** исправленного спека (канонический раннер,
dev-режим, проект chromium — CI-политика chromium-only; mobile-chrome-проект
эти прогоны не затрагивал):

| Прогон | HEAD | Команда | Статистика | Exit | Артефакт |
|---|---|---|---|---|---|
| run1 | f28b090 | E2E_SERVER_MODE=dev e2e-one.sh integration-auth-flow | expected=17 unexpected=0 flaky=0 skipped=0 | 0 | integration-auth-flow.dev.f28b090-run1.json |
| run2 | d2f192b (amended → d82d5f6; артефакт переименован в …f28b090-run2.json — см. Provenance п. 3) | E2E_SERVER_MODE=dev e2e-one.sh integration-auth-flow | expected=17 unexpected=0 flaky=0 skipped=0 | 0 | integration-auth-flow.dev.f28b090-run2.json |

Оба прогона — одинаковые ожидаемые результаты, статистика идентична; run2 —
канонический (новейший), run1 и прежний `integration-auth-flow.dev.json`
(89b6708, старый код спека) — корроборация (правило «канон = новейший по
stats.startTime прогона того же (spec, mode)»; статистика корроборации обязана
совпадать с каноном — проверяется верификатором). Окно антифрода регистраций
(3/час) перед прогонами было чистым (0 строк action=register в
order_fraud_logs), логин-окно — 9/20; лимиты НЕ ослаблялись, строки БД вручную
не удалялись.

## Режимы (обоснование designed-mode)

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
   вызове, что и тест; для page-спеков — prod-режим. (При фикс-сессии DEV-05
   рестарт :3000 выполнял сам канонический раннер — это его воспроизводимый
   контракт; PG :54329 и chat :3030 не перезапускались.)
2. Rate-limit логина (20/час/IP, STRICT: каждая попытка логируется) и
   регистраций (3/час/IP, strict anti-fraud): окна выжигаются диагностическими
   прогонами. Чистка ТОЛЬКО тестовых строк `order_fraud_logs` по
   ip_hash(127.0.0.1) — единственный ip_hash в таблице (внешнего трафика в
   песочнице нет), изоляция проверялась SELECT DISTINCT перед каждым удалением.
   В фикс-сессии DEV-05 чисток НЕ требовалось (окно регистраций чистое).
3. Фикстура integration-auth-flow: РАНЬШЕ фиксированный телефон +79990000000
   блокировал повторные прогоны — ИСПРАВЛЕНО per-run уникальными фикстурами
   (раздел выше); пользователи `e2e-*@e2e.test` остаются в auth.users между
   прогонами — коллизий нет по построению, изоляция проверена двумя подряд
   прогонами.

## Воспроизведение

```bash
node scripts/db/runtime.mjs start        # PG :54329
bun run db:setup                          # если нет .env.local
bun run build                             # бандл для prod-режима
bash scripts/e2e-one.sh full-flow         # prod по умолчанию
E2E_SERVER_MODE=dev bash scripts/e2e-one.sh integration-auth-flow
# артефакты: /tmp/e2e/<spec>.json → копируются в этот каталог
node scripts/verify/e2e-tally-contract.mjs  # сверка tally-контракта (exit 0/1)
```

## История: разрешение расхождения 144 vs 145 (заявлено ранней сессией)

Прошлая сводка утверждала `144 passed / 0 failed + 1 skip`, а её же пофайловая
раскладка `37+14+38+12+1+12+7+13+11 = 145 passed + 1 skip`. Обе цифры неверны
против фактической структуры спеков (проверено по артефактам и
`git show 29ec529:…`): full-flow — 36 слотов (не 38), integration-auth-flow —
17 (не 12). Правильная сумма слотов: **149**. Строго единый PROD-прогон всех 9
спек даёт 144 passed (+5 skipped: 4 — каскад от fail-closed регистрации в prod
без GoTrue, 1 — E2E_FULL_STACK) — совпадение со старой цифрой случайно.
Канонический tally — агрегированный per-spec (148+1), каждый спек в своём
designed-mode.
