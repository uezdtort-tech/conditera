# RELEASE-GATE v4.8 — REPORT (подготовка к контролируемой публикации)

> Дата: 2026-10-18 (UTC); сессия поверх v4.7 (полный аудит не повторялся).
> Роль: Senior Software Engineer / AppSec / Release Engineer.
> Принцип: только фактически выполненные проверки; уровень доказательства указан для каждого статуса. Публикация (push/PR/merge/deploy/branch-protection) НЕ выполнялась.

---

## 0. Фактическое состояние: старт и финиш

| Параметр | Старт v4.8 | Финиш |
|---|---|---|
| HEAD (main) | `c0ef63fbb0f3d45d66c5c7f2450a37d540b7bd32` | см. §10 |
| origin/main (ls-remote) | `8454b3ae249801effb6a699abb6633db164a219b` (не менялся) | без изменений |
| ahead/behind | 94 / 0 | +3 коммита (§10) |
| Дерево | **чистое** | чистое |

- **Прерванная сессия v4.7 восстановлена**: UUID-автокоммит `c0ef63f` (авто-снапшоттер среды) захватил ровно результаты v4.7 — ci.yml (merge-SHA echo), `RELEASE-GATE-v4.7-REPORT.md` (217 строк), 13 evidence-файлов `v47-*` — и ничего кроме них (`git diff fc29a7f..c0ef63f --stat` = 14 файлов, 2051 вставка). Содержимое сверено с планом v4.7 §8.
- **Работа v4.7, потерянная при сбое инструментов**: запись worklog `v4.7-owner-gate` не была дописана (3 попытки упали с 403) — дописана в этой сессии задним числом (§10-3), текст честно помечает ретроактивность.
- Эквивалентность исполняемого кода: `git diff 8db8a4d..fc29a7f -- src/` = пусто (v4.7 §0); v4.8 не меняла runtime-код (только тест/ci/docs — см. §10), live-доказательства v4.6 остаются валидными.

## 1. ЭТАП 1: checkpoint и сохранность — **PASS (после 1 находки hygiene)**

- Контрольная точка: HEAD/ветка/статус/remote refs; v4.7-отчёт, rollback-checklist, оба upload-маршрута+тесты — на месте и tracked (`git ls-files --error-unmatch` 4/4 OK).
- **Drift: НЕТ** (первая сессия без повторного класса #8/#10/#11/#12 — работает vigilance прошлых сессий; drift-guard §4 закрепляет это регрессионно).
- **Hygiene-находка (урок протокола)**: snapshotter коммитит БЕЗ pre-commit скана → на уже закоммиченном `v47-full-vitest-fc29a7f.log:233` surfaced `db-conn-with-credentials` — известный **synthetic-fixture** `postgres://user:pass@host` теста http-helpers (тот же класс, что v4.6 §12.5). Редакция штатным маркером `[REDACTED BY V47 HYGIENE] <redacted-conn-string>`, правила сканера НЕ ослаблены, re-scan real 0 → коммит `4db68da`. Ротация кредов не требуется (fixture-значение). Вывод для владельца: перед публикацией прогонять scanner на всей истории кандидата — CI evidence-hygiene job это делает на PR (§6).

## 2. ЭТАП 2: anti-fraud fail-open/fail-closed — OWNER DECISION подготовлен (policy НЕ менялась)

Полная трасса и оценка — v4.7 §2 (не повторяется). Суть для решения владельца:

| Вариант | Отказоустойчивость | Доступность регистрации | Тесты | Риск обхода |
|---|---|---|---|---|
| **A. Fail-open** (текущий) + компенсации | Максимальная: сбой БД не блокирует пользователей; окно обхода не создаёт ложных отказов | Без изменений | 3 unit fail-open кейса + live (v4.6 §12.3) — есть; ДОБАВИТЬ: алерт на `[anti-fraud] insert/count failed`, edge-WAF rate-limit на /api/auth/register, сверка order_fraud_logs vs регистраций | **Остаётся узкое окно**: частичная деградация PostgREST при живом GoTrue снимает лимит (PostgREST≠GoTrue — разные сервисы); атакующий может вызывать деградацию нагрузкой (insert-first пишет строку на каждую попытку) |
| **B. Fail-closed на register** при недоступном счётчике | Окно обхода закрывается: insert/count err → 503 (семантику выбирает владелец) | Деградация PostgREST = остановка регистраций; новый вектор «DoS регистраций через БД» | Инверсия 3 unit-кейсов для register (login/orders — отдельно по флагу владельца), live-проба «shutdown → 503», приёмка AUTH.md | Через лимитер — устранён; остаточный — только компрометация ingress (§3) |

- Вторичные поверхности (вне лимитера, фиксируются для владельца): register шаги 3–5 (uniqueness/blacklist) проглатывают ошибки БД (проверяется только `data`); компенсация `deleteUser` при частичном отказе может оставить сироту в `auth.users`. Исправление — отдельное согласование (AF-2).
- **Изменений политики в v4.8 НЕТ** (красная линия соблюдена); решение владельца — п.1 §12.

## 3. ЭТАП 3: ingress trust — статическая и production-части разделены

**Static + unit regression — PASS** (evidence `v47-caddyfile-static-fc29a7f.txt`, `v47-antifraud-tests-fc29a7f.log`, `ingress-trust.test.ts`):
- 12 reverse_proxy блоков Caddyfile; 11 HTTP-цепочки — 0 без перезаписи X-Real-IP; 5 loopback-веток → `{header.CF-Connecting-IP}`, 6 прямых → `{remote_host}` + `-CF-Connecting-IP`; smp:5223 — вне HTTP-цепочки (TCP SimpleX).
- Подмена X-Real-IP/CF-Connecting-IP извне исключена по построению: ветка выбирается TCP-пиром, `header_up` заменяет поле целиком, ветка B достижима только с loopback (cloudflared — outbound-only).
- compose: web 3000 / PgBouncer 6432 / Meili 7700 / Mailu 8081 → `127.0.0.1` (регрессия bare-публикаций).

**Production-проверка — BLOCKED (владелец, чеклист)** — из sandbox недоступно:
1. `cat ~/.cloudflared/config.yml` / `systemctl cat cloudflared` → ingress `service: http://localhost:80` (НЕ web:3000).
2. `sudo ss -tlnp` → 3000/6432/7700/8081 только 127.0.0.1; 80/443 — 0.0.0.0 (Caddy).
3. `docker ps` → сверка привязок; supabase-стек (Kong 8000/Studio 8100), если ко-деплоится, — перепривязать.
4. Live-проба подмены: `curl -H 'X-Real-IP: 1.2.3.4' -H 'CF-Connecting-IP: 5.6.7.8' https://conditera.ru/api/health` → бакет в `order_fraud_logs` = реальному IP, не подделке.
5. Подтвердить отсутствие второго входного пути (туннель = единственный внешний вход).
6. Результаты внести в OI-8/OI-9/OI-10 (rollback-checklist §7).

**End-to-end security gate НЕ закрыт** до выполнения production-части.

## 4. ЭТАП 4: drift guard (новое в v4.8) — **PASS (позитив + оба негатива)**

Класс drift #8/#10/#11/#12 (удаление upload-маршрутов) теперь закрыт двумя слоями:

| Слой | Артефакт | Проверка |
|---|---|---|
| Unit-регрессия | `src/lib/redline-paths.test.ts` (9 тестов) | **Позитив: 9/9**; **негатив-удаление: тест падает** с диагностикой «ОБЯЗАТЕЛЬНЫЙ ПУТЬ УДАЛЁН С ДИСКА»; **негатив-untrack (`git rm --cached`): падает** с «НЕ ОТСЛЕЖИВАЕТСЯ GIT»; индекс/дерево восстановлены после негативов, полный прогон 1065/1065 (§9) |
| CI-шаг | security-checks job → `Red-line drift guard (mandatory upload paths)` | `[ -f ]` + `git ls-files --error-unmatch` по 4 путям → exit 1; YAML валидирован (evidence `v48-ci-verify-c0ef63f.txt`) |

Тест коммитится с явным запретом ослабления (заголовок файла ссылается на протокол красной зоны).

## 5. ЭТАП 5: release diff (8454b3a..HEAD, 94→97 коммитов) — группировка и прицельные проверки

| Группа | Коммиты (примеры) | Прицельная проверка |
|---|---|---|
| Security/anti-fraud | `2882103` (n8n X-Real-IP + ingress tests), `c408a20` (register 3/час — owner decision), v4.6-интермедиаты `9f20f60`/`0c97000` (daily window, Caddyfile header_up, compose loopback, DNS_SETUP, CANDIDATE_SHA), hygiene-редакции `0c92b59`/`299afb4`/`97a32a6`/`9ec40f7`/`6e8753d`/`13a5947`/`a9a0672`/`4db68da` | anti-fraud.ts +45 строк: только daily-enforcement + strict-порядок + доки — **сверено с отчётами v4.6/v4.7, живые лимиты 3/час/10/24ч не менялись** |
| Auth | `8cbf9c6` (GoTrue preflight в readiness, fail-closed), `671f82a` (evidence), `f87e057` (env-контракт), `23b437f` (ротация секретов, lifecycle) | dev-stub аутентификации в production не используется (OWNER DECISION §7) |
| API | `87fe425` (checkout idempotency), `0bcb79a` (upload 422-контракт), `b8bdcbf` (postgrest embedded PK), `8e67d3b` (catalog fillings), `d82d5f6` (health readiness), courier/chat-server фиксы `a84040d`…`0fa95e4` | каждая — отдельный reviewed commit своих циклов; upload-маршруты не менялись (drift-guard §4) |
| Инфраструктура | `509c4e3` (docker gate на PR), `fa9c9b8` (registry hardening), `7bcf817` (simplex non-root), `142956e` (GIT_SHA build-arg), `29cee6c` (MEILI_URL), `49604e0` (CI bootstrap/docker fixes), `1debf74` (v4.8 drift guard) | Caddyfile +94, docker-compose.yml +31, ci.yml +143+v4.8 — построчно сверены в v4.6–v4.8 |
| Тесты | `8f9d970` (webhook-контракты, owner P0), `3d9a7f8` (exact-status e2e), `bdf2ec9`/`050e128` (U-06), `5ed027e` (U-01..U-16), `9e5d879` (inventory concurrency), tally-верификаторы | 1065/1065 на финальном дереве (§9) |
| Документация | отчёты v4.0–v4.8, worklog, evidence, UUID-снапшоты (`9f20f60`, `0c97000`, `b3c0b83`, `c0ef63f`, `89b6708`, `f648048`, `ed5404f` — содержимое каждого сверено со своими сессиями) | — |

**Webhook (особая проверка)**: `src/app/api/payment/webhook/route.ts` (+20) — единственное изменение финансовой зоны за 8454b3a..HEAD, из коммита `49604e0` **2026-10-14 (до всех release-gate циклов — часть исходной верифицированной базы кандидата)**: (а) PAY-1a skip provider-verification при ненастроенной YooKassa — сигнатурный гейт `verifyWebhook` (401) остаётся **безусловным первым гейтом** (route.ts:148), ветка мертва в production (YooKassa настроена), задокументирована в v4.5 §8 как dead-code + покрыта owner-P0 регрессией 157 строк; (б) non-UUID orderId → 404 вместо 500 (defensive, контракт E2E). Прочие финансовые пути (payment*/escrow/balance/payout/refund/bonus) — **нулевой diff**. Новых изменений webhook в циклах гейтов НЕТ.

## 6. ЭТАП 6: CI/Docker — **static PASS / выполнение BLOCKED**

(evidence `v48-ci-verify-c0ef63f.txt`; все пункты проверены разбором workflow на кандидате `1debf74`)

| Пункт | Статус |
|---|---|
| PR-триггеры docker-build `[main, develop]` | PASS (static) |
| `CANDIDATE_SHA = pull_request.head.sha || github.sha`, checkout `ref: CANDIDATE_SHA`, Verify-шаг логирует `git rev-parse HEAD` + tag + **`github.sha` (merge-SHA явно, v4.7)** | PASS (static) |
| Compose `config -q` (6 dummy-переменных) | PASS (static) |
| 3 образа `load: true` + GIT_SHA build-arg | PASS (static) |
| Secret-gate: `docker image inspect` ДО скана → history → **exported-FS (`docker create`+`export`+grep)** | PASS (static) |
| evidence-hygiene = scanner + adversarial verifier + env-template | PASS (static + локально §9) |
| **NEW v4.8**: red-line drift guard в security-checks | PASS (static + негативы §4) |
| validate-caddyfile (caddy:2.8-alpine) | PASS (static) |
| **Реальный CI-прогон на опубликованном кандидате** | **BLOCKED** — push/PR запрещены без владельца; Docker Engine локально недоступен (`v47-docker-engine-check-fc29a7f.txt`, не устанавливался) |

**PASS не проставляется до реального выполнения на опубликованном кандидате** — статусы выше не заменяют CI-прогон.

## 7. ЭТАП 7: product owner decisions (без изменений)

| Пункт | Статус | Действие владельца |
|---|---|---|
| U-06 фото разрезов | **BLOCKED** | Реальные фото разрезов/начинок/подписей (чек-лист `seed_slices.template.sql`) → приёмка на СОХРАНЁННЫХ данных (трёх-состояниевая механика 21/21 в v4.3). Шаблонный seed в production не применять. |
| Production auth | **OWNER DECISION** | Утвердить провайдера; обязательные переменные (без значений) — `docs/AUTH.md`; приёмка: register→login→refresh, истёкшие токены → null, CSRF 403, fail-closed. Dev-stub не подменять. |
| Форма возврата | **НЕ ВКЛЮЧАТЬ В ПИЛОТ** | Существует только в неиспользуемом legacy-компоненте (`customer-dashboard.tsx`), активный UI v2 без возвратного UI. Путь пилота — контакты поддержки в футере (актуальность — OI-11). Восстановление формы — отдельная задача (UI + E2E). |

## 8. ЭТАП 8: backup/rollback — checklist завершён (§7 OI-1..OI-12)

`RELEASE-ROLLBACK-CHECKLIST.md` дополнен **сводным перечнем данных инфраструктуры для владельца** (12 пунктов одной таблицей: полномочия, контейнер db, частота/хранилище/ретеншн backup, дата последнего test-restore, образы на сервере, алертинг, фактический ingress cloudflared, слушающие адреса, supabase-стек, контакты поддержки, auth-провайдер). Гейт: п.1.1 backup + п.1.2 test-restore + заполненная таблица OI — обязательны до deploy. В sandbox backup/test-restore production-БД НЕ выполнялись (нет доступа — честно BLOCKED).

## 9. Финальная верификация на кандидатном дереве (HEAD после §10-2 = `1debf74`)

| Гейт | Результат | Evidence |
|---|---|---|
| TypeScript | 0 ошибок, exit 0 | v48-typecheck-c0ef63f.log |
| ESLint | 0 ошибок, exit 0 | v48-lint-c0ef63f.log |
| Vitest полный | **1065/1065, 55 файлов** (вкл. redline-paths 9/9 и upload-тесты), exit 0 | v48-full-vitest-1debf74.log |
| hygiene scan | real 0 / synthetic 444, exit 0 (после редакции §1) | v48-hygiene-scan-1debf74.log |
| adversarial verifier | 14/14, exit 0 | v48-verifier-1debf74.log |
| env-template | OK, exit 0 | v48-envtemplate-1debf74.log |
| YAML (ci.yml+e2e.yml) | OK; security-checks содержит drift-guard шаг | v48-ci-verify-c0ef63f.txt |
| **Production build** | **exit 0, BUILD_ID `tvh32DrCzJqyBhoVfetNU`** на `1debf74`; standalone smoke: GET / → 200 | v48-prod-build-1debf74.log |
| Live anti-fraud (hourly 3/4, daily 10/11, свежие-бакеты, 400-vs-429, очистка) | унаследовано из v4.6 §12 на идентичном исполняемом коде (эквивалентность §0) | v46r-live-probe-raw-8db8a4d3.json |
| Docker Engine / E2E с production-auth | BLOCKED (внешняя среда) | §6 |

## 10. Коммиты сессии (точные пути, scan после стейджинга, без `git add -A`)

| # | SHA | Содержание |
|---|---|---|
| 1 | `4db68da` | ops(hygiene): редакция synthetic-fixture conn-string в v47 vitest-логе (находка в snapshot-коммите c0ef63f, протокол v4.6) |
| 2 | `1debf74` | test+ci(v4.8): red-line drift guard — `src/lib/redline-paths.test.ts` + шаг в security-checks |
| 3 | см. git log | docs(release): RELEASE-GATE-v4.8-REPORT.md + RELEASE-ROLLBACK-CHECKLIST.md (§7 OI) + worklog (ретро-запись v4.7 + запись v4.8) + evidence v48 |

## 11. Вердикт

- **READY FOR OWNER REVIEW** — локальная работа v4.8 завершена: checkpoint чист (без drift), прерванная фиксация v4.7 восстановлена и просканирована (1 находка → редакция), drift guard добавлен и доказан негативами, release diff сгруппирован с прицельной проверкой финансовых красных зон (единственный webhook-diff — исходная база `49604e0`, сигнатурный гейт безусловен), CI-структура проверена статически, все локальные гейты зелёные на свежем build `tvh32DrCzJqyBhoVfetNU`. Остаток — только владельческие/внешние пункты (§12).
- **PRODUCTION-READY: NO** — реальный CI/Docker на опубликованном кандидате, production-подтверждение ingress (§3), backup test-restore + OI-таблица (§8), production-auth решение, U-06 контент. Из sandbox не закрываются.

## 12. Действия владельца (порядок)

1. **AF-1**: выбрать A (fail-open + компенсации) или B (fail-closed на register) — §2. До выбора действует A (текущий код).
2. Опубликовать кандидата (ветка → PR) → реальный CI на CANDIDATE_SHA (все гейты §6, включая Docker image-secret scan и validate-caddyfile).
3. §3 production-чеклист ingress (6 пунктов) → OI-8/9/10.
4. §8: backup + test-restore, заполнить OI-1..OI-12.
5. §7: production-auth решение + приёмка AUTH.md; U-06 контент → приёмка.
6. После первого зелёного PR-CI: branch protection (required checks = 7 jobs ci.yml + e2e по решению владельца; запрет прямого push; ≥1 review) — настройки не менялись из sandbox.
7. Мониторинг с первого дня: `[anti-fraud] insert/count failed` (индикатор окна обхода §2), 429-spike, 5xx, health.

*Все статусы соответствуют фактически выполненным проверкам с указанным уровнем доказательства; секреты в отчёте отсутствуют; публикация не выполнялась.*
