# RELEASE-GATE v4.7 — REPORT (финальный owner gate перед публикацией)

> Дата: 2026-10-18 (UTC); сессия поверх закрытого v4.6 (§12 отчёта v4.6).
> Роль: Senior Software Engineer / AppSec / Release Engineer.
> Принцип: только фактически выполненные проверки; уровень доказательства указан для каждого статуса (static / unit / local-live / production-topology).
> Публикация (push/PR/merge/deploy/branch protection) НЕ выполнялась — запрещена без отдельного разрешения владельца.

---

## 0. Фактическое состояние: старт и финиш

| Параметр | Старт v4.7 | Финиш |
|---|---|---|
| HEAD (main) | `fc29a7f4200efbd1aa0e2bba8c3e9300686809db` | см. §8 (после 3 коммитов) |
| origin/main (ls-remote) | `8454b3ae249801effb6a699abb6633db164a219b` (не менялся) | без изменений |
| ahead/behind | 93 / 0 | +3 коммита (§8) |
| Дерево на старте | dirty: **4 unstaged-удаления upload-маршрутов (drift #12)** | чистое |

- Все три базовых коммита v4.6 на месте: `2882103` (anti-fraud ingress trust), `4551b8e` (evidence), `0c92b59` (hygiene/redaction).
- `RELEASE-GATE-v4.6-REPORT.md` (253 строки), `RELEASE-ROLLBACK-CHECKLIST.md` (97), `worklog.md` — существуют и закоммичены.
- **Эквивалентность исполняемого кода 8db8a4d→HEAD**: `git diff 8db8a4d..HEAD -- src/` пуст; diff всех build-входов (src/, public/, package.json, bun.lock, next.config.ts, tsconfig.json, Dockerfile×3, scripts/, mini-services/, db/, supabase/) = **0 строк**. Изменения между 8db8a4d и fc29a7f — только docs/evidence/worklog (§12 v4.6) — live-evidence v4.6 переносима на текущее дерево.

## 1. ЭТАП 1: checkpoint и сохранность — **PASS**

- Контрольная точка: rev-parse/status/diff (staged=пуст, untracked=пуст), ahead/behind, ls-remote origin/main.
- **Drift #12** (тот же класс, что #8/#10/#11): 4 unstaged-удаления — `src/app/api/upload/route.ts` (+test), `src/app/api/services/upload/route.ts` (+test), 560 строк.
- Протокол соблюдён: patch сохранён ДО восстановления → `/tmp/conditera-v47-drift-fc29a7f.patch` (584 строки, sha256 `416c03d1cf93857ae9afbf0f76468b69afc825101335177942908cd10d7851cc`), копия в evidence `v47-drift12-upload-deletions-fc29a7f.patch` → точечное `git restore -- <4 пути>` (без reset/clean/переписывания) → **SHA-256 blob'ов бит-в-бит = HEAD (4/4: MATCH по `git hash-object`)**.
- Индекс и untracked на старте пустые; примечание: в среде sandbox действует авто-снапшоттер, ранее создавший UUID-коммит `b3c0b83` с тем же классом дрейфа — финальный checkpoint (§9) обязателен.
- Upload-маршруты и тесты: на месте (88/190/87/195 строк), включены в полный прогон §7.

## 2. ЭТАП 2: fail-open — анализ выполнен, политика НЕ менялась

### 2.1 Полный путь `checkFraudLimit` и ошибки → пропуск

| Точка отказа | Поведение | Следствие |
|---|---|---|
| INSERT попытки (`logErr`): сеть/таймаут/5xx/4xx PostgREST, отказ соединения | `allowed: true` (fail-open), warn в лог `[anti-fraud] log insert failed` | попытка не посчитана, не лимитируется |
| COUNT часового окна (`error`) | `allowed: true` | окно не проверено |
| COUNT дневного окна (`dayErr`; достижим только после прохождения часового) | `allowed: true` | дневное окно не проверено |
| `detectSuspiciousActivity` error | `suspicious:false` | только детект-флаг, не гейт |
| Синхронное исключение (например, отсутствие env → `createClient` throw на импорте) | exception покидает `checkFraudLimit` → внешний catch роута → **500 (fail-closed по построению)** | регистрации не происходит |
| Если окна посчитаны успешно — strict: insert-first, `>` 3/час и `>` 10/24ч → 429 | fail-open НЕ применяется | см. §4 |

Тест-покрытие fail-open (unit, `anti-fraud.test.ts`): ошибка вставки → allow; ошибка часового подсчёта → allow; ошибка дневного подсчёта → allow. Live-подтверждение: v4.6 §12.3 (shutdown эмулятора → 400, не 429 — лимитер пропустил).

### 2.2 Сценарий «БД недоступна, регистрационный провайдер доступен»

Ключевой архитектурный факт: счётчик пишет в PostgREST (`order_fraud_logs` через supabaseAdmin), регистрация — в GoTrue (`auth.admin.createUser`). Это **разные сервисы**: GoTrue имеет собственный пул к Postgres и может оставаться работоспособным при деградации PostgREST.

Трасса register-route при PostgREST-down / GoTrue-up:
1. Лимитер: insert падает → fail-open → попытка проходит (не посчитана).
2. Шаги 3–5 (уникальность email/phone, blacklist): **ошибки проглатываются** — код проверяет только `data` (`const { data: existingUser } = …`), при ошибке запрос трактуется как «не найдено» → чеки молча пропущены (вторичная fail-open-поверхность ВНЕ лимитера).
3. Шаг 7: GoTrue createUser **успешен** → пользователь создаётся в auth.users.
4. Шаг 8: profiles.upsert падает (PostgREST) → 500 + компенсация `auth.admin.deleteUser`.
5. Нюанс: компенсация deleteUser идёт через GoTrue (работает) — сирот не остаётся; при **частичной** деградации (delete флапает) возможны осиротевшие auth.users-записи.

### 2.3 Влияние (без вывода «неэксплуатируемо» — оценка честная)

| Вектор | Оценка |
|---|---|
| Массовая регистрация | **Узкое реальное окно обхода**: PostgREST-деградация при живом GoTrue+Postgres снимает лимит полностью (п.2.2 шаги 1–2), и при кратком восстановлении PostgREST на шаге 8 профиль создаётся → аккаунт без лимита. Атакующий может сам вызывать деградацию нагрузкой (insert-first пишет строку на каждую попытку). PostgREST/GoTrue разделяют Postgres — полная деградация БД гасит и регистрацию, но частичная деградация PostgREST/пула — правдоподобна. |
| Расход ресурсов | БД доступна: каждая попытка = 1 INSERT + 1–2 COUNT; strict пишет и отказы → флуд генерирует флуд строк (ретеншн 30 дней, `cleanupOldFraudLogs(30)` в cron — примечание: заголовок anti-fraud.ts устарел, «24ч», расхождение косметическое, не менялось). БД недоступна: fail-open — попытки бьют в GoTrue (bcrypt/JWT) → ресурсный вектор на GoTrue. |
| Автоматизированное злоупотребление | Спуфинг бакета исключён ingress-схемой (§3); ротация IP даёт независимые бакеты (по-design; IPv6-пул — ограничение per-IP модели, edge-WAF как компенсация — вариант A ниже). |
| Ложные блокировки добросовестных | Fail-open защищает доступность: сбой БД не даёт ложных 429; strict-режим + общий NAT (офис/мобильный оператор) — 10 регистраций/24ч на IP достижимо для крупного офиса (принятый trade-off, решение владельца 2026-10-17). |

### 2.4 Альтернативы для владельца (решение НЕ принималось самостоятельно)

**A. Сохранить fail-open + компенсационные контроли.**
- Отказоустойчивость: максимальная — сбои БД не блокируют пользователей; сохраняется текущее поведение и все 1056 тестов.
- Доступность: без изменений (нулевой риск регрессии).
- Необходимые тесты: существующие unit (3 fail-open кейса) + live (v4.6 §12.3) — уже есть; ДОБАВИТЬ: мониторинг-алерт на частоту `[anti-fraud] log insert failed`/`count failed` (сигнал деградации = сигнал окна обхода); edge-rate-limit вне приложения (Cloudflare WAF rate-limiting rule на /api/auth/register — не зависит от БД приложения; закрывает окно обхода на уровне периметра); периодическая сверка order_fraud_logs vs фактических регистраций (аномалия insert-fail).
- Риск обхода: остаётся (узкое окно PostgREST-деградации; edge-WAF снижает, но не устраняет полностью, если туннель/периметр скомпрометирован).

**B. Fail-closed на регистрации при недоступном счётчике.**
- Отказоустойчивость: окно обхода закрывается — insert/count error на register → 503 (или 429 с Retry-After; семантику выбирает владелец).
- Доступность: деградация PostgREST = остановка регистраций (и только их: login/orders могут остаться fail-open по отдельному флагу на action); новый вектор «DoS регистраций через деградацию БД» — риск переезжает с обхода на отказ.
- Необходимые тесты: инверсия 3 unit-кейсов для register (fail-closed) с сохранением fail-open для login/order_create (если так решит владелец); live-проба «эмулятор shutdown → 503»; health-интеграция; e2e-приёмка AUTH.md (регистрация при штатной БД).
- Риск обхода: через лимитер — устранён; остаточный — только компрометация ingress (§3) или полный обход приложения.
- Объём изменений: малый (политический флаг в `checkFraudLimit` + тесты), но **не выполнялся** — требует решения владельца (см. §10, OWNER DECISION AF-1).

**Проверка ЭТАП 2.5 соблюдена**: вывод «неэксплуатируемо» из одного ожидаемого кода ответа не делался; указано конкретное окно обхода (частичная деградация PostgREST при живом GoTrue) и вторичные поверхности (проглатывание ошибок uniqueness/blacklist, сироты auth.users при частичном отказе компенсации).

## 3. ЭТАП 3: доверенная IP-топология

### 3.1 Цепочка и проверка блоков (static + regression, evidence `v47-caddyfile-static-fc29a7f.txt`)

```
Internet → [A: Caddy :80/:443 | B: CF edge → cloudflared (outbound-only) → localhost:80 → Caddy]
         → web:3000 / chat:3030 / n8n:5678 → extractIp/getClientIP → checkFraudLimit
```

- **12 reverse_proxy блоков**: 11 HTTP-цепочки — **0 без перезаписи X-Real-IP**; 5 веток `@loopback_peer` → `header_up X-Real-IP {header.CF-Connecting-IP}`; 6 прямых веток → `X-Real-IP {remote_host}` + **`-CF-Connecting-IP`** (покрыты /api/*, socket.io/*, /n8n/*, catch-all, @api_auth (auth/payment/profile/admin), localhost-dev). Блок smp-server:5223 — вне HTTP-цепочки доверия (TCP-протокол SimpleX, без anti-fraud).
- **Подмена X-Real-IP извне — невозможна по построению**: (а) прямой клиент попадает в ветку A по матчеру `remote_ip 127.0.0.1 ::1` (не матчится) → его X-Real-IP перезаписывается `{remote_host}`, CF-Connecting-IP удаляется; (б) клиентский `X-Real-IP` через туннель также перезаписывается (header_up с значением заменяет поле целиком); (в) ветка B достижима только с loopback-пира — т.е. через cloudflared, принимающий только outbound-соединения туннеля; произвольный выбор бакета внешним запросом исключён при обеих документированных топологиях. Приложение проверяет `x-real-ip` первым; fallback XFF с `TRUSTED_PROXY_HOPS` в production недостижим (X-Real-IP всегда установлен).
- **Loopback-туннель и `{remote_host}`**: если фактическая серверная топология — туннель на localhost:80, голый `{remote_host}` схлопнул бы всех клиентов в бакет 127.0.0.1 — поэтому ветка B использует CF-Connecting-IP. **Фактический способ соединения cloudflared→Caddy на production-хосте из sandbox недоступен** — см. BLOCKED 3.3.
- Прямой внешний доступ к web:3000 / PgBouncer 6432 / Meili 7700 / Mailu 8081 исключён привязками `127.0.0.1:*` в docker-compose.yml (регрессия: `ingress-trust.test.ts`, bare-публикация разрешена только 80/443/5223/25/465/587/993). `docker-compose.supabase.yml` (Kong 8000, Studio 8100 на всех интерфейсах) — отдельный dev-стек, в production-топологии docker-compose.yml не участвует; если владелец ко-деплоит его на сервер — привязки закрыть (§10).
- Уровни: static structure + unit regression (57/57 §4) — PASS; `caddy validate` локально невозможен (исполнение бинаря запрещено песочницей) → CI job `validate-caddyfile`; live Caddy-проба — BLOCKED (нет Docker/cloudflared в sandbox).

### 3.2 Live тест подмены — уровень доказательства

В sandbox Caddy в цепочке не исполняется; прод-проба подмены заголовков (отправка `X-Real-IP`/`CF-Connecting-IP` снаружи через реальный ingress и проверка бакета в `order_fraud_logs`) — **BLOCKED** до доступа к production/стейджингу. Статическое доказательство (3.1) покрывает конструкцию, но не заменяет live-подтверждение.

### 3.3 BLOCKED — точный чеклист владельцу (production-хост)

1. `cat ~/.cloudflared/config.yml` (или `systemctl cat cloudflared` + конфиг-флаг): ingress service для conditera.ru/www = `http://localhost:80` (НЕ `http://localhost:3000`, НЕ `web:3000`).
2. `sudo ss -tlnp | grep -E ':(80|443|3000|6432|7700|8081)\b'`: 3000/6432/7700/8081 слушают ТОЛЬКО 127.0.0.1; 80/443 — 0.0.0.0 (Caddy).
3. `docker ps --format '{{.Names}} {{.Ports}}'`: сверить с compose-привязками; убедиться, что cloudflared НЕ публикует входящий порт наружу.
4. Из внешней машины: `curl -s -H 'X-Real-IP: 1.2.3.4' -H 'CF-Connecting-IP: 5.6.7.8' https://conditera.ru/api/health` → затем на сервере проверить, что в access-логах/`order_fraud_logs` бакет = реальному IP клиента, а не 1.2.3.4/5.6.7.8 (подтверждение перезаписи live).
5. При топологии «только Caddy без туннеля» — подтвердить отсутствие cloudflared как входной точки.
6. Если на хосте поднимается supabase-стек (docker-compose.supabase.yml) — перепривязать 8000/8100 на 127.0.0.1.

**Изменять ingress-конфигурацию из неподтверждённой топологии запрещено — не менялось.**

## 4. ЭТАП 4: anti-fraud в стабильной среде

### 4.1 Сохранённые live-пробы v4.6 (build `Q2N7dMttmH8O8Zvz4YtxP` @ `8db8a4d3`)

Эквивалентность исполняемых исходников `8db8a4d` ↔ текущий HEAD доказана (§0) → результаты переносимы (правило «старый build валиден при неизменных исходниках» соблюдено). Плюс **свежий production build на текущем дереве** (§7).

| Сценарий (live, production-build route handler + изолированный эмулятор) | Результат | Evidence |
|---|---|---|
| hourly: попытки 1-3 | 400 (лимитер пропустил, валидация тела) | v46r-live-probe-raw-8db8a4d3.json |
| hourly: 4-я | **429 + Retry-After: 3600**, «3/час» | там же |
| hourly: независимый IP | 400 (чужой бакет не затронут) | там же |
| daily: сид 9 попыток в предыдущие 24ч (шаг 2ч → hourly short-circuit исключён) + попытка 10 | **400** (прошла: 10≤10) | там же |
| daily: попытка 11 | **429 + Retry-After: 86400**, «суточный лимит» | там же |
| concurrency: 6 параллельных × 2 СВЕЖИХ бакета | IP1: 0 прошло / IP2: 1 прошло (≤3 контракт; insert-first пере-блокирование — задокументированный trade-off) | там же |
| различимость статусов | строго {400 после лимитера = валидация тела; 429 = отказ лимитера} | там же |
| изоляция/очистка | дамп эмулятора: только синтетические IP пробы; DELETE по ip_hash удалено 28/28, остаток 0; эмулятор kill | там же |
| fail-open live | shutdown эмулятора → 400 (не 429) | там же |
| health | 503 degraded — честный fail-closed | там же |

### 4.2 Текущее дерево (fc29a7f+): прицельные и полные прогоны

- `ingress-trust` + `anti-fraud` + `anti-fraud.concurrency`: **57/57** (evidence `v47-antifraud-tests-fc29a7f.log`); полный Vitest **1056/1056** (§7).
- Разные IP — только через доверенную ingress-схему: unit-независимость бакетов + Caddyfile-перезапись (§3); production-подтверждение — чеклист 3.3.
- Лимиты/защита НЕ менялись для прохождения тестов (register 3/час, 10/24ч — решение владельца 2026-10-17, без изменений).
- **End-to-end security gate НЕ объявлен закрытым**: отсутствует live-проба через реальный Caddy/tunnel (3.2) и серверная топология не подтверждена (3.3).

## 5. ЭТАП 5: CI/Docker

| Пункт | Статус | Детали |
|---|---|---|
| Триггеры PR на docker-build | PASS (static) | `pull_request: [main, develop]`; job `docker-build` `needs: build` |
| evidence-hygiene = scanner + verifier + env-template | PASS (static + локальное исполнение §7) | `scan-evidence.mjs` + `scan-evidence-rules-verify.mjs` + `production-env-template.mjs` |
| Compose validation в docker job | PASS (static) | `docker compose config -q` с 6 dummy-переменными (не секреты) |
| 3 образа (web/chat/simplex-bridge) | PASS (static) | `load: true`, теги по `CANDIDATE_SHA`, `GIT_SHA` build-arg у web |
| PR-head SHA ≠ merge SHA | **PASS (исправлено в v4.7)** | `CANDIDATE_SHA = github.event.pull_request.head.sha || github.sha`; checkout `ref: CANDIDATE_SHA`; шаг Verify логирует `git rev-parse HEAD`, tag SHA **и теперь явно `github.sha` (merge-SHA на PR — не исходник образов)** — коммит §8-1 |
| Образ существует до inspect/history | PASS (static) | `docker image inspect` ДО сканов; load:true обязан положить образ, иначе FAIL |
| Secret-gate по экспортированным слоям | PASS (static) | `docker create` + `docker export` + grep — контент-скан ФС (history/inspect не видят содержимое; удалённые-в-верхних-слоях файлы нижних слоёв покрыты) |
| Docker Engine локально | **BLOCKED** | CLI/engine недоступны на текущем SHA (evidence `v47-docker-engine-check-fc29a7f.txt`); не устанавливался, права не менялись. Гейт закрывается реальным CI-прогоном на опубликованном кандидате |
| CI-исполнение на кандидате | **BLOCKED** | push/PR запрещены без владельца; «CI PASS» здесь = статическая корректность workflow, не выполнение |

YAML: ci.yml 7 jobs + e2e.yml 3 jobs — js-yaml OK (evidence `v47-yaml-fc29a7f.log`).

## 6. ЭТАП 6: owner checklist (решения по продукту и auth)

| # | Пункт | Статус | Что требуется от владельца |
|---|---|---|---|
| OC-1 | **U-06 фото разрезов** | BLOCKED | Реальный контент отсутствует (v4.3 живая проверка: product_slices/fillings/slice_image пусты). Чек-лист необходимых фото/подписей — `seed_slices.template.sql`. Приёмка на СОХРАНЁННЫХ данных: загрузить реальные фото → трёх-состояниевая проверка (21/21 механика в v4.3) на сохранённых записях. Шаблонный seed в production не применять. |
| OC-2 | **Production auth** | OWNER DECISION | Выбор провайдера (топология не утверждена). Обязательные переменные (без значений): GOTRUE URL, SERVICE_ROLE_KEY, GOTRUE_PROBE_TIMEOUT_MS — `docs/AUTH.md`. Приёмка: register→login→refresh-восстановление, истёкшие токены → null, CSRF 403, fail-closed при недоступном провайдере (health 503 + register 500 — подтверждено live v4.6). Dev-stub аутентификации в production не используется; не подменять. |
| OC-3 | **Форма возврата** | НЕ ВКЛЮЧАТЬ В ПИЛОТ | Форма существует только в неиспользуемом `customer-dashboard.tsx` (legacy, не импортируется); фактический UI v2 без возвратного UI → онлайн-заявку покупателю НЕ обещать. Реальный контакт поддержки — в футере сайта (проверить актуальность перед запуском). Восстановление формы (UI + E2E на реальном рендере) — отдельная продуктовая задача вне цикла. |
| OC-4 | **Backup/rollback/monitoring** | OWNER INPUT REQUIRED | Review `RELEASE-ROLLBACK-CHECKLIST.md`: выполнить п.1.1/1.2 (pg_dump перед deploy + обязательный test-restore) — из sandbox недоступно. Заполнить OWNER-поля: частота/ретеншн/место backup, алертинг-стек, контакты, перечень образов на сервере. Мониторинг-сигналы в чеклисте: 5xx-rate, health-деградация, `[anti-fraud] *failed` в логах (окно обхода §2), рост order_fraud_logs. |
| OC-5 | **Branch protection** | РЕКОМЕНДАЦИЯ (не менять удалённо) | После первого зелёного PR-CI: required checks = `Lint & Type-check`, `Unit tests (Vitest)`, `Build Next.js`, `Build Docker images`, `Security checks`, `Validate Caddyfile`, `Evidence hygiene (secret scanner)`; запрет прямого push в main; ≥1 review. Настройки удалённого репозитория НЕ изменялись. |
| OC-6 | **AF-1 fail-open vs fail-closed** | OWNER DECISION | Выбрать вариант A или B из §2.4 (или гибрид: fail-closed только на register). Без выбора — остаётся fail-open с мониторинг-компенсацией (вариант A п.«Необходимые тесты» минимален и не требует кода). |
| OC-7 | **AF-2 вторичные fail-open поверхности** | OWNER DECISION (низкий приоритет) | Шаги 3–5 register проглатывают ошибки БД (uniqueness/blacklist как «чисто») и компенсация deleteUser может оставить сироту auth.users при частичном отказе. Исправление — отдельно согласованный код (не входило в v4.7). |

Не придумывать пользовательский контент (OC-1) и не подменять auth dev-stub (OC-2) — соблюдено.

## 7. ЭТАП 7: финальные проверки на текущем дереве

Все команды выполнены на `fc29a7f` + правка ci.yml (не исполняемый код приложения), evidence в `docs/evidence/release-gate/v47-*`:

| Гейт | Результат | Evidence |
|---|---|---|
| TypeScript (`tsc --noEmit`) | **0 ошибок, exit 0** | v47-typecheck-fc29a7f.log |
| ESLint | **0 ошибок, exit 0** | v47-lint-fc29a7f.log |
| Vitest полный | **1056/1056, 54 файла, exit 0** (upload-тесты в прогоне) | v47-full-vitest-fc29a7f.log |
| Прицельные anti-fraud/ingress | 57/57 | v47-antifraud-tests-fc29a7f.log |
| hygiene scan | **real 0 / synthetic 407, exit 0** | v47-hygiene-scan-fc29a7f.log |
| adversarial verifier | **14/14, exit 0** | v47-verifier-fc29a7f.log |
| env-template контракт | **OK, exit 0** (6 required / 63 ключа) | v47-envtemplate-fc29a7f.log |
| YAML/workflow | ci.yml 7 jobs + e2e.yml 3 jobs, OK | v47-yaml-fc29a7f.log |
| Caddyfile static | 12 блоков / 11 HTTP-цепочка / 0 без X-Real-IP / петля-ветки согласованы | v47-caddyfile-static-fc29a7f.txt |
| **Production build** | **exit 0, BUILD_ID `SwEJYJkKAL1_5xtfjSwd-` на текущем дереве**; standalone-запуск: GET / → 200, /api/health → честный degraded (auth/db недоступны в sandbox — fail-closed контракт) | v47-prod-build-fc29a7f.log |
| Docker Engine | NOT usable → Docker-гейт BLOCKED | v47-docker-engine-check-fc29a7f.txt |
| E2E (Playwright с auth-сессиями) | BLOCKED локально (нет production auth-provider) — CI e2e.yml (nightly/ручной) на опубликованном кандидате | — |

- Build привязан к точному SHA: свежий build на текущем дереве (не переиспользование старого); параллельно доказана эквивалентность 8db8a4d↔HEAD (§0), что делает валидными и live-evidence v4.6.
- OOM/прерываний не было; результат не переписывался.

## 8. Коммиты (логические группы, точные пути, без `git add -A`)

| # | Содержание | Файлы |
|---|---|---|
| 1 | ci.yml: фиксация merge-SHA в логе Verify (v4.7 §5) | `.github/workflows/ci.yml` |
| 2 | evidence: 12 файлов v47-* (проверки §7) + drift-патч #12 | `docs/evidence/release-gate/v47-*` |
| 3 | отчёт v4.7 + worklog | `RELEASE-GATE-v4.7-REPORT.md`, `worklog.md` |

Протокол каждого коммита: точный список путей → `git add` → **scan-evidence после стейджинга** (сканер видит индекс; находка → правка маркерами, правила не ослабляются) → коммит → проверка чистоты дерева. Итоговые SHA — в §9/финальном checkpoint.

## 9. Вердикт

- **READY FOR OWNER REVIEW** — локальная работа завершена: drift #12 сохранён/восстановлен, fail-open проанализирован (политика не менялась, 2 альтернативы), ingress-схема статически+регрессионно доказана с честным BLOCKED на live-топологию, live-доказательства anti-fraud сохранены и эквивалентны текущему дереву, CI-структура проверена и дополнена фиксацией merge-SHA, все локальные гейты зелёные на свежем production build. Оставшиеся пункты требуют владельца/внешней среды и явно перечислены (§3.3, §6, §10).
- **PRODUCTION-READY: NO** — не закрыты: CI-исполнение на опубликованном кандидате (включая Docker image-secret scan), подтверждение production-топологии ingress (§3.3), backup test-restore, production-auth решение, U-06 контент. Ни один из них не закрывается из sandbox.

## 10. Следующие действия владельца (порядок исполнения)

1. Опубликовать кандидата (ветка → PR) → реальный CI на CANDIDATE_SHA: lint/typecheck/test/build/docker-build (compose + 3 образа + inspect/history/**exported-FS scan**) + validate-caddyfile + evidence-hygiene.
2. §3.3 чеклист ingress-топологии (6 пунктов) на production-хосте.
3. OC-6: решение fail-open/fail-closed (§2.4) — до или сразу после публикации.
4. OC-4: backup + test-restore до deploy; заполнить OWNER-поля rollback-чеклиста.
5. OC-2: production auth — решение + приёмка AUTH.md.
6. OC-1: контент разрезов U-06 → приёмка на сохранённых данных.
7. OC-5: branch protection после первого зелёного PR-CI.
8. Мониторинг после deploy: 5xx-rate, health, `[anti-fraud] insert/count failed` (индикатор окна обхода §2.3), суточный свод order_fraud_logs vs регистраций.

*Все статусы соответствуют фактически выполненным проверкам с указанным уровнем доказательства. Публикация не выполнялась; секреты в отчёте отсутствуют.*
