# RELEASE-GATE v4.6 — REPORT

> Дата завершения: 2026-10-17 (UTC); resume-сессия (закрытие live-пробелов + drift #11) — см. §12
> Роль: Senior Software Engineer / AppSec / Release Engineer
> Принцип отчёта: только реально выполненные проверки. Статический анализ ≠ unit-тест ≠ локальная интеграция ≠ удалённый CI. Уровень доказательства указан для каждого статуса.
> Публикация (push/PR/merge/deploy) НЕ выполнялась — запрещена без разрешения владельца.

---

## 0. Фактическое состояние: старт и финиш

| Параметр | Старт сессии (после прерывания) | Финиш |
|---|---|---|
| HEAD | `0c970002c4af12ecd5a8d0eda13bbc9ed29d771f` (main) | см. §5 |
| origin/main (ls-remote) | `8454b3ae249801effb6a699abb6633db164a219b` | без изменений |
| ahead/behind | 85 / 0 | +3 коммита (см. §5) |
| Дерево | dirty: **4 unstaged-удаления upload-маршрутов (drift #10)** | чистое |

- HEAD на момент начала v4.6 (`8e66f17`) изменился ещё до этой сессии: автоснимок прошлой (прерванной) сессии закоммичен в `9f20f60` + `0c97000` — промежуточные изменения v4.6 (anti-fraud daily limit, Caddyfile header_up, compose loopback-bindings, DNS_SETUP, ci.yml CANDIDATE_SHA) **сохранились в истории**, не были потеряны. Проверено ревизией содержимого обоих коммитов.
- Патч-снимок прерванной сессии: `docs/evidence/release-gate/v46/v46-autosnapshot-full-patch-9f20f60.diff` (25,464 байт, закоммичен в `0c97000`).
- Незаконченный checkpoint-файл прошлой сессии (`v46-interruption-checkpoint.md`) не обнаружен — его роль выполняет autosnapshot-патч + данный отчёт.

## 1. DEV-00: восстановление репозитория — **PASS**

- Контрольная точка снята (git rev-parse/status/porcelain/log/diff --stat/name-status/cached/remote/ls-remote).
- **Drift #10**: `src/app/api/upload/route.ts`, `src/app/api/upload/route.test.ts`, `src/app/api/services/upload/route.ts`, `src/app/api/services/upload/route.test.ts` — unstaged-удаления, файлы присутствуют в HEAD (blob'ы получены). Тот же класс drift, что #8 в v4.4.
- Порядок восстановления (по протоколу): patch сохранён ДО изменений → `/tmp/conditera-v46-preflight-0c97000.patch` (24,561 B, sha256 `416c03d1…`) + копия `docs/evidence/release-gate/v46/v46-drift-4upload-deletions-pre-restore-0c97000.diff` → точечное `git checkout HEAD -- <4 пути>` (без общего reset/clean) → **SHA-256 восстановленных файлов бит-в-бит совпадают с blob'ами HEAD (4/4)** → маршруты и тесты на месте (см. §7).
- Индекс был пуст (`git diff --cached` пуст), untracked — только новые evidence-файлы этой сессии.

## 2. DEV-01: доверенная IP-схема — **PASS (repo-side)** + OWNER-условие

### 2.1 Фактическая цепочка (проверено по коду, не по предположениям)

```
Internet → [A: Caddy :80/:443 | B: CF edge → cloudflared (outbound-only) → localhost:80 → Caddy]
         → web:3000 / chat-service:3030 → extractIp (anti-fraud.ts) / getClientIP (rate-limit.ts) → checkFraudLimit
```

- Оба экстрактора: `x-real-ip` → `cf-connecting-ip` (только rate-limit.ts) → хвост `X-Forwarded-For` c `TRUSTED_PROXY_HOPS` (default 1) → fallback `0.0.0.0` / `unknown`.
- **Топология A (прямой клиент)**: Caddy перезаписывает `X-Real-IP := {remote_host}` (реальный TCP-пир) и **удаляет** клиентский `CF-Connecting-IP` (`header_up -CF-Connecting-IP`) → подделка исключена по построению: приложение проверяет `x-real-ip` первым, а его ставит только Caddy.
- **Топология B (Cloudflare Tunnel)**: CF edge выставляет `CF-Connecting-IP` (клиентские подделки перезаписываются edge'ом), cloudflared принимает только из туннеля (outbound), пир Caddy = loopback → матчер `@loopback_peer { remote_ip 127.0.0.1 ::1 }` → `header_up X-Real-IP {header.CF-Connecting-IP}`. Голый `{remote_host}` в туннельной топологии запрещён: все клиенты схлопнулись бы в один бакет 127.0.0.1.
- Прямой обход web:3000 исключён привязкой `127.0.0.1:3000:3000` в docker-compose (v4.6). Аналогично PgBouncer `127.0.0.1:6432`, Meili `127.0.0.1:7700`, Mailu webmail `127.0.0.1:8081`. Caddy :80/:443, SMP :5223 (TCP-протокол SimpleX, вне HTTP-цепочки доверия), SMTP/IMAP — единственные публичные публикации (по назначению). chat/n8n/db/redis наружу не публикуются. Закреплено регрессионно: `src/lib/ingress-trust.test.ts` (запрет голых `порт:порт` вне allow-набора).
- **Исправление в этой сессии**: блок n8n (`handle /n8n/*`) был единственным HTTP-прокси без перезаписи X-Real-IP — переведён на ту же двухветвевую схему (логи/execution data n8n больше не принимают клиентские подделки заголовка). Коммит §5-1.
- `getClientIP`/`extractIp` TRUSTED_PROXY_HOPS: тесты hops=1/2/overflow — `ingress-trust.test.ts`.

### 2.2 Уровни доказательства

| Проверка | Уровень | Статус |
|---|---|---|
| Статическая структура Caddyfile (32 блока, 10 reverse_proxy, все web/chat с header_up X-Real-IP; парность -CF-Connecting-IP) | static + regression-test | PASS |
| Loopback-bindings compose | static + regression-test | PASS |
| Реальная `caddy validate` локально | НЕВОЗМОЖНО: бинарь /usr/bin/caddy есть, исполнение запрещено песочницей | → CI job `validate-caddyfile` (caddy:2.8-alpine) |
| Live-проба через реальный Caddy/туннель | НЕВОЗМОЖНО в sandbox (нет Docker Engine, нет cloudflared) | → BLOCKED (см. §4) |
| Live-проба приложения (extractIp → 429) | local integration, production build | PASS (§6) |

### 2.3 OWNER-условие (не блокирует локальные гарантии, обязательно до deploy)

- **OWNER INPUT REQUIRED**: подтвердить на сервере, что cloudflared ingress указывает на `http://localhost:80` (Caddy), а НЕ на web:3000 напрямую, и что туннель — единственный внешний путь (рекомендованный config.yml — в хвосте Caddyfile; фактический server-side конфиг из sandbox недоступен).
- Если владелец использует только топологию A (без туннеля) — схема тоже корректна (ветка A).

**Gate 2 вывод**: спуфинг обхода лимитера через заголовки исключён в обеих документированных топологиях; прямой доступ к :3000 закрыт привязкой. Финальное подтверждение сетевой схемы — за владельцем (см. §9).

## 3. DEV-02: hourly/daily anti-fraud — **PASS (unit + local-live hourly/daily/конкурентность)** — daily live закрыт resume-сессией (§12)

Контракт (не менялся, решение владельца 2026-10-17): register **3/час и 10/24ч**, считается каждая попытка (включая невалидные), strict-режим (отказы занимают окно), rolling windows (60м/24ч), отклонённая попытка → 429 + `Retry-After` (все 3 callers: register/orders/login).

- **Enforcement**: дневной лимит реально в исполняемом пути (v4.6: оба окна проверяются; дневной select — только после прохождения часового). До v4.6 `maxPerDay` был объявлен, но не проверялся — атака «ровно maxPerHour каждый час» давала до 24×maxPerHour/сутки.
- **Атомарность**: strict-порядок `insert → count` (попытка пишется ДО подсчёта) — гонка размывания счётчика устранена; полный одновременный всплеск N > лимита консервативно отклоняет все N (пере-блокирование вместо обхода — осознанный выбор, задокументирован в коде и тестах).
- **Границы (unit, макет с реальным подсчётом)**: попытки 1-3 allowed / 4-я отказ (3/час); ровно 10/24ч allowed / 11-я отказ; 3 записей возрастом 60м01с выпадают из часового окна; атака 5/ч×5ч=25>20 закрыта дневным окном.
- **Конкурентность (unit)**: 6 параллельных → ≤3 допущено; разные IP параллельно — независимые бакеты; mixed (разогретый + свежие IP).
- **Конкурентность (live, resume §12.3)**: 6 параллельных × 2 независимых СВЕЖИХ бакета → пропущено 0/6 и 1/6 (контракт «≤3» выполнен; консервативное пере-блокирование insert-first — задокументированный trade-off); статусы строго {400,429} — 400-после-лимитера отличим от 429-отказa.
- **Fail-open при ошибке БД** — явное решение, документировано в тестах: insert/count/day-count error → allowed:true. Оценка риска: НЕ создаёт эксплуатируемого обхода — регистрация/логин/заказ сами требуют БД, при её отказе операция отклоняется уже на следующем шаге (нагрузка на лимитер без БД бессмысленна). Если владелец считает иначе — OWNER DECISION (изменение на fail-closed тривиально, но ослабит устойчивость к сбоям БД).
- **Live-проба (production build, supabase REST-emulator)**: см. §6 — hourly 3→4-я 429+Retry-After:3600; параллельный burst 6→все 429; независимые IP; каталог 200; health честный 503 fail-closed.
- **Daily live** — ~~не воспроизводим за разумное время~~ **ЗАКРЫТО resume-сессией (§12.2)**: изолированный эмулятор + синтетический сид 9 попыток в предыдущие 24ч с шагом 2ч (часовой short-circuit исключён по построению) → 10-я попытка 400 (прошла), 11-я → 429 + Retry-After 86400 с причиной «суточный лимит». Точная граница 10/11 доказана живым route handler'ом.
- `Retry-After` есть во всех 429-ответах (проверено unit + live). `review` объявлен в LIMITS, но не используется маршрутами (мёртвый конфиг, безвреден).

**Gate 3**: hourly и daily enforced, конкурентность не обходит, корректный пользователь не блокируется произвольно (429 только при реальном превышении, валидация тела происходит после fraud-check).

## 4. DEV-03/DEV-04: CI + Docker — **CI: PASS (static) / выполнения: BLOCKED**; **Docker: BLOCKED**

### 4.1 ci.yml (статическая проверка, YAML валидирован js-yaml — 7 jobs)

- Триггеры push/PR на `[main, develop]` — Docker-гейт выполняется НА PR (не только после merge).
- **CANDIDATE_SHA** (v4.6): `github.event.pull_request.head.sha || github.sha`; checkout `ref: CANDIDATE_SHA`; шаг **Verify checked-out source SHA == image tag SHA** (git rev-parse в build job vs тег; mismatch → exit 1). Разделение candidate/merge-SHA закрыто: на PR образы тегируются и строятся из head-SHA, github.sha (merge) фиксируется в логе отдельно.
- Compose validation (`docker compose config -q`) — на кандидатном коде, 6 dummy-обязательных переменных (не секреты).
- Три образа (web/chat/simplex-bridge) с `load: true` + `GIT_SHA` build-arg у web.
- **Image-secret gate усилен в v4.6**: (1) существование каждого образа — `docker image inspect` ДО скана; (2) `docker history --no-trunc` grep секретов; (3) **НОВОЕ: контент-скан экспортированной ФС** (`docker create` + `docker export` + grep) — history/inspect не видят содержимое файлов, теперь видят (включая удалённые в верхних слоях файлы нижних слоёв).
- evidence-hygiene job: scan-evidence + adversarial-верификатор 14/14 + env-template контракт — все три локально выполнены на этом дереве: **exit 0 ×3** (real 0 / synthetic 325; verifier 14/14 pass; 6 required-переменных compose присутствуют в шаблоне, 63 ключа).
- Отрицательные сценарии сканера: verifier покрывает real-форматы (утечка всегда блокирует) и легитимный presence-only инвентарь (без ложного срабатывания); чрезмерно широких downgrade-правил нет (сужение v4.4 сохранено).

### 4.2 Реальный запуск CI — BLOCKED

- Нет опубликованного кандидата: push/PR запрещены без владельца → ни один job ещё не выполнялся на CI-раннере. Статус «CI PASS» здесь — только **статическая корректность workflow**, НЕ доказательство выполнения.

### 4.3 Docker gate — BLOCKED

- Docker Engine/CLI/socket отсутствуют на текущем SHA (evidence: `v46-docker-engine-check-0c97000.txt`; движок не устанавливался, права не менялись — по протоколу).
- Локально выполнима только `compose config -q`-эквивалент невозможен без CLI; compose-структура проверена статически (порты/привязки/healthchecks — §2).
- Image-secret scan (§4.1-п.3) выполнится в CI docker-build job при публикации.

## 5. Коммиты (логические группы, малые, с pre-commit проверками)

| # | SHA | Назначение | Файлы |
|---|---|---|---|
| старт | `0c97000` | (прошлая сессия) autosnapshot v4.6 + CANDIDATE_SHA | — |
| 1 | `2882103` | anti-fraud ingress trust: n8n-rewrite + структурные/конкурентные тесты | Caddyfile, 2 новых тест-файла (+376/-2) |
| 2 | `4551b8e` | evidence: restore/hygiene/build/live-probe | 15 файлов evidence |
| 3 | hygiene-коммит (см. git log) | redaction синтетических dummy-значений в evidence + штатные маркеры `[REDACTED BY V46 HYGIENE]`; урок видимости: сканер сканирует только tracked-файлы — pre-commit скан перед коммитом 2 не видел ещё не добавленные evidence-файлы, находки (все — синтетика автора сессии, не реальные секреты) surfaced сразу после коммита | 3 evidence-файла |
| 4 | см. `git log` | отчёт + rollback-checklist + worklog | 3 файла |

Pre-commit протокол каждого коммита: точный список путей (без `git add -A`), `node scripts/scan-evidence.mjs` → exit 0, релевантные тесты (коммит 1: vitest 57/57), сверка чистоты дерева после коммита.

## 6. DEV-05: интеграционная live-проба anti-fraud — **PASS (local integration)**

Среда: **production build текущего SHA** (`bun run build` exit 0, BUILD_ID `LMvG5s5ZS4FnMlYx83mgs`, standalone-режим `node .next/standalone/server.js`) + Supabase REST-emulator (только order_fraud_logs insert/count; auth → 400 → честный fail-closed). Не dev/Turbopack. Process hygiene: заклинивший dev-сервер (95% CPU, 1.78GB RSS, 20 мин без ответа) остановлен точечно по PID, без широких kill; после проб dev-сервер восстановлен штатным `scripts/dev-watchdog.sh`.

| Сценарий | Результат |
|---|---|
| GET /api/health | 503 degraded (auth недоступен) — fail-closed контракт подтверждён live |
| register ×4, один IP | 1-3 → 400 (валидация тела, НЕ лимит), 4-я → **429 + Retry-After: 3600** «Превышен лимит register (3/час…)» |
| register с другого IP | 400 (чужой исчерпанный бакет не влияет) |
| register с подделанным x-real-ip прямым запросом :3000 | 400 — свежий бакет: приложение доверяет x-real-ip (контракт); в production прямой доступ закрыт 127.0.0.1-binding + перезапись Caddy (§2) |
| parallel burst 6× один IP | **все 6 → 429** — insert-first: пере-блокирование, обход невозможен (совпало с unit-прогнозом) |
| GET /catalog | 200 |

Evidence: `docs/evidence/release-gate/v46-live-antifraud-probe-0c97000.txt`, `v46-live-probe-raw-0c97000.json`, harness/scripts — `v46-live-probe-harness.txt`, `v46-live-probe-script.txt`, `v46-live-probe-runner.sh`. Синтетические пользователи не создавались (все попытки отвергнуты до записи пользователя; записаны только anti-fraud попытки в эмуляторе, одноразовом процессе).

**Границы доказательства**: Caddy в цепочке пробы не участвовал (нет Docker/Caddy в sandbox) — proxy-перезапись доказана статически+тестами (§2); полные Playwright E2E с auth-сессиями — CI e2e.yml (nightly/ручной), локально невоспроизводимы без production auth-provider (OWNER DECISION §8).

## 7. DEV-06: гейты на финальном SHA — **PASS**

| Гейт | Результат | Evidence |
|---|---|---|
| Vitest полный | **1056/1056** (54 файла; было 1035 + 21 новых) exit 0 | v46-full-vitest-0c97000.log |
| TypeScript (tsc --noEmit) | 0 ошибок, exit 0 | v46-typecheck-0c97000.log |
| ESLint | 0 ошибок, exit 0 | v46-lint-0c97000.log |
| Production build | exit 0; BUILD_ID LMvG5s5ZS4FnMlYx83mgs; standalone-запуск и live-проба успешны | v46-prod-build-0c97000.log |
| scan-evidence (hygiene) | pre-commit (tracked): exit 0, real 0/325; после коммита evidence surfaced 6 real-класс находок (все — синтетические dummy новых evidence-файлов) → redaction + штатные маркеры (§5-3); финальный скан: exit 0, real 0 / synthetic 366 | v46-hygiene-scan-0c97000.log + hygiene-коммит §5-3 |
| scan-evidence adversarial verifier | 14/14 pass | v46-hygiene-verifier-0c97000.log |
| env-template контракт | exit 0 (6 required compose-переменных в шаблоне; 63 ключа) | v46-envtemplate-0c97000.log |
| YAML/workflow | js-yaml: 7 jobs, триггеры корректны | §4.1 |
| Caddyfile | static structural check PASS; `caddy validate` локально запрещён песочницей | v46-caddyfile-static-check-0c97000.txt + CI job |
| chat-server strict TS | не запускался отдельно — входит в общий typecheck (tsc по всему проекту) | — |

- Build относится к текущему SHA: исходники исполняемого кода после build не менялись (изменения только в evidence/документах — см. §5 коммиты 2-4); перед финалом полный vitest будет повторён на финальном SHA.
- Upload-маршруты: оба на месте, бит-идентичны HEAD (§1), их тесты в полном прогоне (1056) зелёные.

## 8. DEV-07: продуктовые ограничения пилота — честные статусы

| Пункт | Статус | Обоснование |
|---|---|---|
| U-06 фото разрезов | **BLOCKED** | Реального контента нет (product_slices/fillings/slice_image пусты — v4.3 живая проверка). Перечень необходимых фото/подписей для владельца: `seed_slices.template.sql` (чек-лист). Не создавать фиктивные production-URL, шаблонный seed к production не применять. Механика (редактор, путь загрузки, API/UI) доказана тремя состояниями 21/21 в v4.3. |
| Production auth | **OWNER DECISION** | Топология провайдера не утверждена. Обязательные параметры (без значений) в docs/AUTH.md: GOTRUE URL, SERVICE_ROLE_KEY, GOTRUE_PROBE_TIMEOUT_MS (опц.); проверки при приёмке: register→login→refresh-восстановление, истёкшие токены → null, CSRF 403, fail-closed при недоступном провайдере (подтверждено live: health 503 + регистрация 500). |
| UI формы возврата | **НЕ ГОТОВО (исключено из пилота)** | Форма существует только в неиспользуемом legacy-компоненте; фактический рендер v2 без возвратного UI. Покупателю НЕ обещать онлайн-заявку на возврат; поддерживаемый путь — контакты поддержки в футере. Backend-route ≠ готовая форма. Восстановление UI + E2E — отдельная продуктовая задача вне текущего цикла. |
| PAY-1a webhook dead code | без изменений | Мёртвая ветка задокументирована в v4.5; чистка платёжного кода только по отдельному согласованию владельца. |

## 9. DEV-08: backup/rollback/monitoring — checklist создан

`RELEASE-ROLLBACK-CHECKLIST.md`: полномочия, pg_dump-шаблон перед deploy, обязательный test-restore, откат образов по SHA-тегам, совместимость миграций (0060 последняя) при откате, остановка релиза при 5xx/health-деградации, таблица мониторинг-сигналов (включая anti-fraud fail-open в логах). Инфраструктурные параметры, недоступные из sandbox (частота/ретеншн backup, алертинг-стек, контакты, список образов на сервере) — помечены **OWNER INPUT REQUIRED**, не выдумывались. Реальный backup/restore production DB НЕ выполнялся (нет разрешения).

## 10. Оставшиеся риски и ближайшие действия владельца

**Для PRODUCTION-READY: YES (в порядке исполнения):**
1. Опубликовать кандидата (ветка → PR) → реальный CI на точном CANDIDATE_SHA: lint/typecheck/test/build/docker-build (compose + 3 образа + inspect/history/**exported-FS secret scan**) + validate-caddyfile + evidence-hygiene.
2. Подтвердить серверную ingress-топологию (cloudflared → Caddy :80; туннель = единственный внешний путь) — §2.3.
3. Docker-гейт закроется п.1 (локального движка нет).
4. Backup: выполнить п.1.1/1.2 checklist (backup + test-restore) до deploy; заполнить OWNER INPUT REQUIRED.
5. Production auth: OWNER DECISION по топологии провайдера (§8) → приёмка AUTH.md.
6. U-06: контент разрезов (чек-лист в seed_slices.template.sql) → повторная трёх-состояниевая проверка.
7. Защита ветки main + required checks (ci.yml jobs) после первого зелёного PR-CI.

**Риски (принятые/контролируемые):**
- ~~Daily anti-fraud live не доказан (unit-only)~~ — **ЗАКРЫТО §12.2**: live-проба с сид-данными доказала границу 10/11 и Retry-After 86400 живым роутом. Остается суточный мониторинг после deploy как дополнительная проверка на реальном трафике.
- Fail-open антифрода при отказе БД — осознанное решение (§3);OWNER может потребовать fail-closed.
- Параллельный всплеск отклоняет консервативно (все N при N>лимита) — принятый trade-off против обхода.
- E2E-прогон с production-сессиями — только в CI e2e.yml; локальные smoke ограничены отсутствием auth-provider.

## 11. Вердикт

- **READY FOR OWNER REVIEW** — все локально выполнимые проверки пройдены на текущем SHA с доказательствами; оставшиеся пункты требуют публикации (реальный CI/Docker), серверной инфраструктуры и решений владельца. **Resume-сессия (§12): drift #11 восстановлен, daily-live и свежие-бакеты-конкурентность закрыты live-доказательствами, все гейты повторены на `8db8a4d3` (build `Q2N7dMttmH8O8Zvz4YtxP`).**
- **PRODUCTION-READY: NO** — не выполнены: CI на опубликованном кандидате, Docker-гейт с image-secret scan, test-restore backup, OWNER-подтверждение топологии, production-auth решение. Ни один из этих пунктов нельзя закрыть из sandbox.

*Все статусы этого отчёта соответствуют фактически выполненным проверкам; уровни доказательства указаны явно. Не обещано ни одной отложенной работы: всё исполнимое исполнено, остальное честно помечено BLOCKED/OWNER.*

---

## 12. RESUME-сессия (2026-10-17, после прерывания): закрытие live-пробелов + drift #11

### 12.1 Восстановление: drift #11 (повтор того же класса, что #8/#10)

- Старт resume: HEAD = `b3c0b83` (main), дерево чистое, origin/main = `8454b3a` (не менялся). Все 3 коммита прошлой сессии (`2882103`/`4551b8e`/`0c92b59`) в истории, отчёт/checklist/worklog на месте.
- **Drift #11**: UUID-автокоммит `b3c0b83` (сообщение `716db127-…`) зафиксировал повторное удаление тех же 4 красных файлов (upload-маршруты + тесты). Патч удаления сохранён ДО восстановления: `docs/evidence/release-gate/drift11-upload-deletion-b3c0b83.patch` (590 строк, sha256 `c801fbaf…`), копия в evidence.
- Восстановление: точечный `git checkout b3c0b83^ -- <4 пути>` (без reset/clean), **блобы бит-в-бит совпадают с родителем (4/4**: `cb23e5dd766b`, `06b49c3c3f22`, `f6c52a424b0d`, `ec9f8efcb663`). Тесты маршрутов: 15/15. Коммит `8db8a4d`.
- Эквивалентность исполняемого кода: `git diff 0c97000..HEAD -- src/` = только 2 новых тест-файла (ingress-trust, anti-fraud.concurrency), **0 runtime-файлов** — сборка эквивалентна прошлой по исполняемому коду (и пересобрана заново на текущем SHA, см. §12.4).

### 12.2 Daily limit — live-проверка (впервые, закрытие известного пробела)

Среда: production build СВОБОДНОГО дерева `8db8a4d3` (BUILD_ID `Q2N7dMttmH8O8Zvz4YtxP`, standalone `:3100`, dev на `:3000` не тронут) + изолированный in-memory Supabase REST-эмулятор (процесс-однодневка, только order_fraud_logs).

| Шаг | Результат |
|---|---|
| Сид 9 синтетических попыток, IP `203.0.113.20`, timestamps теперь-22ч…теперь-6ч, шаг 2ч | 201; в любом 60-минутном окне ≤1 сид-строки → часовой short-circuit исключён по построению |
| 10-я попытка (9 сид + запрос) | **400** — лимитер пропустил (hourly=1≤3, daily=10≤10) → нижняя граница доказана |
| 11-я попытка | **429 + Retry-After: 86400**, тело: «Превышен суточный лимит register (10/24ч с вашего IP)» → верхняя граница доказана, отказ именно ДНЕВНОЙ (не часовой) |
| Референс Retry-After | 86400 = now+24ч (код resetAt для дневного отказа) — консервативно (до полного окна от момента отказа), задокументировано |

Дополнительно проверено: **изоляция** (дамп эмулятора: 28 строк, 0 чужих — все 5 синтетических IP этой пробы; 28 register-попыток, арифметика 4+1+11+6+6 сходится), **узкая очистка** (DELETE по ip_hash: удалено [4,1,11,6,6]=28, остаток 0), затем kill эмулятора. Синтетические пользователи не создавались (тела без `phone` → 400 валидации после лимитера).

### 12.3 Конкурентность на СВЕЖИХ бакетах (замена недоказательного burst по исчерпанному)

6 параллельных POST (тела без phone) × 2 независимых свежих IP (`203.0.113.30/40`), пустые бакеты, одновременно:

| Бакет | Прошло (400) | Отклонено (429) |
|---|---|---|
| IP1 | 0 | 6 |
| IP2 | 1 | 5 |

- Контракт «не более 3 проходят» — выполнен на обоих (0≤3, 1≤3); разброс 0/1 — недетерминизм планировщика при insert-first (все 6 insert'ов могли уйти до первых count'ов) — консервативное пере-блокирование, обход НЕВОЗМОЖЕН, совпадает с unit-прогнозом.
- Различимость: все статусы строго {400, 429}; 400 = лимитер пропустил, упало на валидации тела; 429 = отказ лимитера (лимитер стоит ПЕРЕД валидацией — register/route.ts шаг 1→2).
- Отказ БД (shutdown эмулятора): попытка → **400 (не 429)** — fail-open live-подтверждён: при недоступной БД лимитер не даёт ложных отказов.
- Hourly-контракт перепроверен на текущем кандидате: 400×3 → 429+RA:3600 («3/час»), независимый IP → 400; health → 503 (честный fail-closed).

### 12.4 Финальные проверки на текущем дереве (все — до коммитов docs)

| Гейт | Результат | Evidence |
|---|---|---|
| typecheck | 0 ошибок, exit 0 | v46r-typecheck-8db8a4d3.log |
| lint | 0 ошибок, exit 0 | v46r-lint-8db8a4d3.log |
| Vitest полный | **1056/1056**, 54 файла (upload-тесты восстановлены и в прогоне), exit 0 | v46r-full-vitest-8db8a4d3.log |
| hygiene scan | real 0 / synthetic 407, exit 0 (после редакции 1 dummy-conn-string из fixture http-helpers — штатный маркер, правила НЕ ослаблены) | v46r-hygiene-scan-8db8a4d3.log |
| adversarial verifier | 14/14, exit 0 | v46r-verifier-8db8a4d3.log |
| env-template | OK, exit 0 | v46r-envtemplate-8db8a4d3.log |
| YAML | ci.yml 7 jobs + e2e.yml 3 jobs, js-yaml OK; branches `[main, develop]` — hexdump подтверждает целостность (артефакт отображения, не файла) | v46r-yaml-8db8a4d3.log |
| Caddyfile static | 11 header_up X-Real-IP (двухветвевая схема во ВСЕХ HTTP-блоках, включая n8n), 6× -CF-Connecting-IP, @loopback_peer, compose: 3000/6432/7700/8081 → 127.0.0.1 | v46r-caddyfile-static-8db8a4d3.txt |
| Docker Engine | **NOT FOUND** (CLI/socket/compose) → Docker-гейт BLOCKED, пере-подтверждено на 8db8a4d3 | v46r-docker-engine-check-8db8a4d3.txt |
| **Production build** | exit 0, **BUILD_ID `Q2N7dMttmH8O8Zvz4YtxP`** на SHA `8db8a4d3`; первый запуск убит OOM (разросшийся dev-сервер 1.56GB/71% CPU остановлен точечно по PID, watchdog остановлен) → повтор с освобождённой памятью успешен; после проб dev восстановлен штатным watchdog | v46r-prod-build-8db8a4d3.log |
| Live-проба | 6/6 PASS (health/hourly/daily/concurrency/cleanup/dbFailure) | v46r-live-probe-raw-8db8a4d3.json |

OOM-инцидент задокументирован честно: первый `bun run build` — Killed (exit 137-класс), результат НЕ переписывался в PASS; причина устранена (остановка разросшегося dev), повтор успешен.

### 12.5 Коммиты resume-сессии

| # | SHA | Назначение |
|---|---|---|
| 1 | `8db8a4d` | восстановление 4 upload-файлов после drift #11 + патч дрейфа в evidence |
| 2 | `e951177` | evidence: live-probe daily/concurrency/fail-open + все финальные логи (15 файлов) |
| 3 | HEAD (этот коммит) | отчёт (этот §12) + worklog; runnerlog добавлен сюда же |

Протокол каждого коммита: точный список путей (без `git add -A`) → `git add` → **scan-evidence после стейджинга** (урок прошлой сессии: сканер видит индекс) → коммит → проверка дерева. Коммит 2 был ЗАБЛОКИРОВАН сканером (1 real-класс находка: dummy `postgres://user:pass@host` из fixture теста http-helpers в vitest-логе) → редакция штатным маркером `[REDACTED BY V46 HYGIENE]` + плейсхолдер `<redacted-conn-string>` (тот же паттерн, что 0c92b59) → скан 0 → коммит.

### 12.6 Остаток после resume

Без изменений по существу (см. §4, §8, §9, §10): CI-выполнение на опубликованном кандидате, Docker-гейт, ingress-топология сервера (OWNER), production-auth (OWNER DECISION), U-06 контент, backup test-restore, защита ветки. Два известных live-пробела (daily, свежие-бакеты-конкурентность) — **закрыты** (§12.2, §12.3).
