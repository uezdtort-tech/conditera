# Release Gate v4.2 — ФИНАЛЬНАЯ СВЕРКА БЛОКЕРОВ

Дата: 2026-10-16 (UTC). Сессия: «v4.2 final blocker reconciliation» (worklog Task G-1).
Публикация/push/PR/deployment: **НЕ выполнялись**.

---

## 1. Финальный SHA и доказательства

| Параметр | Значение |
|---|---|
| Ветка | `main` (локальный unpublished candidate) |
| HEAD на старте сессии | `299afb4ece4e2029f02c7af3aee8709f0cd0298b` |
| Коммит сверки U-06 (эта сессия) | `050e128` — тесты + seed-шаблон + evidence, 6 файлов, +1022 |
| `origin/main` (независимо, `git ls-remote` в этой сессии) | `8454b3ae249801effb6a699abb6633db164a219b` |
| Ahead / behind | **70 / 0** |
| Дерево на старте | чистое (drift-инцидентов не зафиксировано) |

**Коммит `22fbb8c`** (v4.1 close-out): 15 файлов, +3076/−0 — только `RELEASE-GATE-v4.1-REPORT.md`, `docs/evidence/**` (tally-контракт, smoke-JSON, 11 логов гейтов) и `worklog.md`. Исполняемого кода: 0.

**Коммит `299afb4`** (hygiene follow-up): 3 файла, +4/−2 — `RELEASE-GATE-v4.1-REPORT.md` (1 строка §5.12), `v41-final-vitest-12c8815.log:218` (редакция литерал-плейсхолдера `postgres://user:pass@host` → `[REDACTED BY F-1 HYGIENE]`), `worklog.md` (1 строка). Исполняемого кода: 0.

**Привязка production build к кандидату.** Последний полный `bun run build` выполнен на `12c8815` (exit 0, compile 53 s, ~330 маршрутов; `v41-final-build-12c8815.log`). Доказательство неизменности исполняемого кода после него: `git diff --name-only 12c8815..050e128` вне docs/evidence/worklog = ровно 3 файла — `route.test.ts` (vitest, в бандл не входит), `product-page.slice-photos.test.tsx` (vitest), `seed_slices.template.sql` (шаблон, не включён в scripts/db/setup.mjs и init-db.sh, билдом не исполняется). **App-исходников: 0** → build-артефакт остаётся действительным для HEAD.

**Upload-маршруты** (проверено в этой сессии): оба существуют, отслеживаются, тесты сохранены, tree-status чист:
`src/app/api/upload/route.ts` (88 строк) + `route.test.ts` (190), `src/app/api/services/upload/route.ts` (87) + `route.test.ts` (195); blob-хэши совпадают с HEAD.

**Secret-scan по финальным evidence и логам**: `node scripts/scan-evidence.mjs` → **exit 0, real findings 0, 301 синтетик-маркер** (включая все логи этой сессии). Значения секретов в отчёте отсутствуют.

### Наблюдение о канале наблюдения (важно для интерпретации «drift»)

При трассировке U-06 зафиксированы противоречивые показания чтения одного файла (`[media, images, title]` vs `edia, images, title]`). Решающий count-тест (`grep -cF`, цифры не подвержены искажениям) + `od -c` + успешный SWC-парс показали: **working tree и git object store содержат корректные байты**; искажение возникало в канале вывода инструментов (глоталось `[m`). Все PASS-вердикты этой сессии получены count-методами или подтверждены прохождением компиляторов. Прежние «drift»-инциденты (удаление upload-роутов) согласуются с этим классом средовых аномалий; git-кандидат целостен.

## 2. U-06 — реальные фотографии разреза

**Трассировка модели данных (БД → карточка):**
1. `products.fillings` (jsonb, миграция 0043) — массив `{name, priceModifier}`; гейт секции: `product.fillings.length > 0` (`product-page.tsx:1142`).
2. `product_slices` (миграция 0017): `{id, productId → products.id, fillingName, image, config, caption, sortOrder}` — **сущность фото разреза**, связывается с продуктом через `productId`, с начинкой — строгим матчем `fillingName === fillings[].name` (`cake-slice-visualizer.tsx:823`).
3. API карточки `/api/products/[id]`: `PRODUCT_CARD_COLUMNS` содержит `fillings` (фикс `8e67d3b`), срезы — отдельный запрос (route.ts:163-167) → ответ `{product{images,fillings,media,…}, slices, reviews}`.
4. API срезов `/api/products/[id]/slices`: GET публичный; POST — роль CONFECTIONER + ownership (route.ts:95-127).
5. UI: `ProductSliceGallery` (реальный, `cake-slice-visualizer.tsx:786`) фетчит `/slices` и рендерит `<img src={slice.image} alt={fillingName}>` (:893-894); главное фото — реальная `ProductMediaGallery` из `product.images`.

**Новые регрессионные тесты (коммит `050e128`, непустые данные):**
- API: `route.test.ts` «непустые fillings + slices» — фактический ответ: главное фото (РЕАЛЬНЫЙ ассет репо `/uploads/products/svadebnyy-tort-yagodnyy-barhat.png`, используемый реальным продуктом …0001) доезжает до `product.images`; `fillings` байт-в-байт; `slices[0]` сцеплен с продуктом и начинкой, `image` = явно обозначенный fixture-URL.
- UI: НОВЫЙ `product-page.slice-photos.test.tsx` (2 теста) — **реальная** `ProductMediaGallery` (не заглушка): `<img src=главное-фото>` в DOM; фото разреза `<img alt="Шоколад-ганаш" src=fixture>` в DOM; начинка без среза → фото не рендерится (нет чужих URL); `/slices` запрошен у реального эндпоинта.
- Прогон: полная витрина **50 файлов / 1014 тестов exit 0** (было 49/1011), typecheck 0, lint 0.

**Seed-механика и контент от владельца:** `supabase/seed_slices.template.sql` (НОВЫЙ) — шаблон с плейсхолдерами `__FILLING_N__/__SLICE_PHOTO_N__/__CAPTION_N__` для 3 флагманов; **не включён** в автоприменение (setup.mjs / init-db.sh не ссылаются); чек-лист контента внутри. Альтернативные каналы наполнения уже существуют в коде: дашборд кондитера → вкладка «Срезы» (`confectioner-slice-editor-tab.tsx`, проводен в `confectioner-dashboard.tsx:1135` — уточнение к неточному утверждению v4.1 handoff «админ-UI не имеет редактора») и POST `/api/products/<id>/slices` (загрузка фото через `/api/upload`).

### Матрица U-06 (раздельно, как требуется)

| Компонент | Статус | Обоснование |
|---|---|---|
| Техническая передача данных (БД → API → карточка) | **PASS** | Цепочка live-проверена; API-регрессия на непустых данных (050e128); зафикс живой пробы API v4.1 close-out (`fillings` в ответе карточки) |
| Корректность UI (гейт, главное фото, фото среза, fallback) | **PASS** | Реальная галерея рендерит главное фото + фото разреза (новые UI-тесты); негатив/фолбэк покрыты (`fillings-gate.test.tsx`, SVG-fallback при несовпадении); скриншоты живого UI в evidence 8e67d3b |
| Наличие реального контента | **ОТСУТСТВУЕТ (FAIL)** | SQL-факт: 0 продуктов с `products.fillings`, `product_slices` = 0 строк (проверено в этой сессии); реальных фотографий разреза не существует |
| Возможность production-приёмки | **BLOCKED** | Ждёт контент владельца по чек-листу (`seed_slices.template.sql`); после наполнения — повторить позитивный сценарий на живых данных |

**Итог по U-06: НЕ PASS** (в соответствии с прямым требованием v4.2). Механика передачи и UI доказаны; блокер — отсутствие реального контента, владелец уведомлён конкретным чек-листом.

## 3. Production auth

**Разделение средовой конфигурации и дефекта приложения:**
- Регистрация/вход/сессия на ЖИВОМ сервере с действующим (dev) auth-провайдером: E2E `integration-auth-flow` — **17/0/0/0, EXIT=0** на текущем дереве (`v42-e2e-auth-299afb4.log` + JSON-артефакт). Приложение работает корректно: пользователь создаётся, сессия выдаётся, защищённые маршруты доступны.
- Smoke «health 200 + `degraded` + `auth:unreachable`» — **ожидаемая документированная форма** песочницы: prod-режим без реального GoTrue; контракт `8cbf9c6`: configured + unreachable → `degraded` (семантика required-зависимости), HTTP-гейт не тронут. Это НЕ дефект приложения — это fail-closed-поведение, зафиксированное регрессиями (`register/route.test.ts`: prod+authErr → 500 до любых записей; fail-closed не ослаблялся, 0 diff).
- В dev/стабе `unreachable`+`ok` — анти-false-positive контракт (без деградации), тоже под тестом.

**OWNER DECISION (топология реального провайдера):** подтвердить в среде владельца:
- параметры: реальные `SUPABASE_URL` (+ Kong-маршрутизация `/auth/v1/*`), сервисный ключ в `.env.production` (не в репо), опционально `GOTRUE_PROBE_TIMEOUT_MS` (дефолт 3 s) — осознанно, если латентность провайдера > 3 s;
- проверяемые сценарии: (1) `GET {SUPABASE_URL}/auth/v1/health` с apikey → 2xx ≤ таймаута; (2) `/api/health` в проде → `auth:"ok"`, `status:"ok"`; (3) реальная регистрация одного пользователя через развёрнутый прод (201, запись в `auth.users`, профиль/роли); (4) вход + сессия + доступ к защищённому маршруту.

## 4. Удалённый CI и защита main

**Проверено независимо (только чтение):** `git ls-remote origin main` → `8454b3a…` — кандидат не опубликован; никакой CI-прогон не относится к кандидату; последний красный E2E (503 `/api/health`) — старый `origin/main` без коммитов `8cbf9c6`/`47ba4d4`.

**E2E workflow на кандидате** (проверено по файлу в этой сессии):
- матрица **chromium-only**: `e2e.yml:138` `browser: ["chromium"]` (variant B, решение владельца в шапке файла);
- безопасная передача grep: `e2e.yml:209` `E2E_GREP: ${{ github.event.inputs.grep }}` через env; `:196-198` — расширение внутри bash-массива, никаких текстовых `${{ }}`-подстановок dispatch-инпутов в команду;
- реальная инициализация БД: `e2e.yml:154` `bun run db:setup` до тестов; readiness-ожидание — в раннере `scripts/e2e-one.sh` (health-поллинг до старта Playwright).

**Точный следующий шаг публикации (выполняет ВЛАДЕЛЕЦ, руками):**
1. Из локального кандидата: `git branch release-candidate-v42 <SHA из §6>` и `git push -u origin release-candidate-v42` (или PR из этой ветки в `main` — не прямой push 70 коммитов).
2. CI (`ci.yml`) запустится на head-SHA ветки/PR = точный SHA кандидата; зафиксировать run-URL рядом с этим отчётом.
3. Ночной `e2e.yml` (chromium, prod-режим) ожидаемо зелёный с `47ba4d4` (coherence-инвариант readiness; в песочничной форме `degraded` валиден, инкогерентные тела — красные).
4. Влить только после зелёного CI на точном SHA и явного решения владельца.

**Branch protection (рекомендуемые настройки, применяет владелец):** Settings → Branches → `main`: Require pull request (0 прямых push), ≥1 approval, Require status checks: `lint-and-typecheck`, `vitest`, `build` (jobs `ci.yml`), опционально `e2e` как non-required до стабилизации; Require linear history — по решению владельца. Текущий статус `protected: false` (наблюдение владельца) повторно из песочницы не проверить — GitHub API rate-limit неаутентифицированных запросов; вынесено как открытый пункт.

## 5. Docker

**Статус: BLOCKED.** Проверено в этой сессии (`v42-docker-engine-check-299afb4.txt`): docker CLI отсутствует (`command -v docker` — пусто), `/var/run/docker.sock` не существует → Compose config, три сборки и inspect выполнить негде. Статический просмотр не засчитывается.

Команды для среды владельца (на опубликованном SHA) — полный набор в `RELEASE-GATE-v4.1-REPORT.md` §6: `docker compose config --quiet`; `docker compose build web` + `build chat` + `--profile simplex build simplex-bridge`; `docker image inspect` ×3 + `docker history … | grep -Ei 'CHANGE_ME|SECRET=|PASSWORD='` (отсутствие секретов в слоях); smoke `up -d` + `curl /api/health`; чек-лист simplex non-root T1–T6 (`simplex-bridge-nonroot-impl-1a19c29.md` §5).

## 6. Сводка статусов v4.2

| Блокер v4.2 | Статус | Доказательство |
|---|---|---|
| §1 Финальный SHA + доказательства | **PASS** | §1 этого отчёта (count-проверки, diff-классификация, blob-сверка) |
| §2 U-06 | **ЧАСТИЧНО: техно/UI PASS, контент ОТСУТСТВУЕТ, приёмка BLOCKED** | §2 матрица; тесты 050e128; seed-шаблон + чек-лист владельца |
| §3 Production auth | **PASS (локально) / OWNER DECISION (реальный провайдер)** | IAF 17/0/0/0 на живом сервере; fail-closed не тронут; параметры и сценарии — §3 |
| §4 CI + защита main | **ГОТОВО К ПУБЛИКАЦИИ / BLOCKED (нужен владелец)** | Workflow проверен (chromium-only, безопасный grep, db:setup); точный шаг публикации — §4 |
| §5 Docker | **BLOCKED** | Нет Engine/CLI/socket (`v42-docker-engine-check-299afb4.txt`) |

**Гейты на текущем дереве (эта сессия):** vitest 50/1014 exit 0; typecheck 0; lint 0; IAF E2E 17/0/0/0; scan-evidence exit 0 (real 0 / 301 синтетик); build действителен для HEAD (0 app-исходников после 12c8815 — §1).

## 7. Открытые риски (реестр без изменений по существу — handoff §3b + v4.1 отчёт §9)

1. Keyless checkout (opt-in) — решение владельца. 2. Дубль тикета при повторном POST — решение владельца. 3. Контент fillings/slices отсутствует — чек-лист в `seed_slices.template.sql`. 4. U-06 позитив на реальном контенте — после п.3. 5. Checkout 200-vs-201 — решение владельца. 6. Simplex non-root runtime T1–T6 — Docker-гейт. 7. Firefox/WebKit E2E отключены (variant B) — будущее решение. 8. Реальный GoTrue-провайдер — OWNER DECISION (§3). 9. Branch protection `protected: false` — рекомендации §4, применяет владелец. 10. Удалённый CI на кандидате и Docker-гейт не выполнены — выполняются владельцем после публикации.

## 8. Коммиты этой сессии

| SHA | Содержимое |
|---|---|
| `050e128` | test(u06): непустая регрессия API+UI (главное фото + фото разреза), seed-шаблон контента, evidence (IAF-лог, docker-чек) — 6 файлов, +1022 |
| (финальный) | `RELEASE-GATE-v4.2-REPORT.md` + worklog-аппенд (docs-only) |

## 9. Заключение

**READY FOR OWNER REVIEW.**

Кандидат (`050e128` + финальный docs-коммит) локально проверен полностью; все PASS-вердикты привязаны к точным SHA и воспроизводимым командам; U-06 зафиксирован честно (механика доказана, контента нет — конкретный чек-лист у владельца); auth разделён на «работает в приложении» / «решение по топологии провайдера»; CI-путь и Docker-команды подготовлены до шага.

**PRODUCTION-READY не выставляется** — до публикации кандидата, зелёного CI на точном опубликованном SHA, реального Docker-гейта и подтверждения топологии auth-провайдера.
