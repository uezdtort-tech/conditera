# Z21_BASELINE — Точка продолжения после Z-v20

**Создан:** Z-v21 (автоматическая фиксация фактического состояния)
**Дата:** 2026-11-10 (Europe/Moscow)
**Метод:** только фактические команды Git/системы; содержимое защищённых файлов не читалось.

---

## 1. Git Ground Truth (проверено фактически)

| Параметр | Факт | Совпадение с отчётом Z-v20 |
|---|---|---|
| Рабочая директория | `/home/z/my-project` | да |
| Remote origin | `https://github.com/uezdtort-tech/conditera.git` (без credential в URL) | да |
| Ветка | `main` | да |
| HEAD | `1505c0bad9ed806dff16100d2bc28d01086e511c` | **совпадает** (`1505c0b`) |
| Ahead / behind (origin/main…main) | **225 ahead / 0 behind** | **совпадает** (225) |
| Последний fetch | 2026-11-04 23:58:51 +0300 | — |
| Stash | пуст | — |
| `git status --porcelain` | 4 записи (см. §3) | согласуется |

## 2. Защиты (проверено фактически, без чтения защищённых файлов)

| Механизм | Состояние |
|---|---|
| `core.hooksPath` | `scripts/hooks` (факт: `git config core.hooksPath`) |
| `scripts/hooks/pre-commit` | существует; вызывает `scripts/protected-paths.sh hook-guard` |
| `scripts/protected-paths.sh` | существует; `bash -n` — синтаксис OK |
| skip-worktree флаги | **0 файлов** (`git ls-files -v | grep ^S` пусто) |
| assume-unchanged флаги | **0 файлов** |
| Защита построена на | pre-commit guard (не на skip-worktree) — зафиксировано как факт |

## 3. Защищённые upload-файлы (только метаданные Git)

Состояние в `git status`: ` D` (удалены в рабочем дереве, присутствуют в index) — **ожидаемое защищённое состояние; не трогать, не восстанавливать**.

Blob-хэши в index (метаданные, `git ls-files -s`):

```
ec9f8efcb66397fd29909d72b7d961ec1307a314  src/app/api/services/upload/route.test.ts
f6c52a424b0d95a613ec8c0812e0cf106f1b06cc  src/app/api/services/upload/route.ts
06b49c3c3f22b0a0e6afccef72baf28d60aa818e  src/app/api/upload/route.test.ts
cb23e5dd766be64b0287cd1983dd8d860c361d62  src/app/api/upload/route.ts
```

## 4. Локальная база данных

| Параметр | Факт |
|---|---|
| Состояние на момент старта Z-v21 | **НЕ инициализирована** (`.pgdata` отсутствовал) |
| Действие Z-v21 | `bun run db:start` — создан свежий кластер |
| Версия | PostgreSQL 18.4 (embedded) |
| Порт / данные | 127.0.0.1:54329, `/home/z/my-project/.pgdata`, БД `conditera` |
| Таблиц в `public` на момент baseline | **0** (чистый кластер) |

⚠️ Заявление Z-v20 «79 миграций применены к чистой PostgreSQL 18» относилось к **disposable** БД той сессии; этот кластер не сохранился. Повторная проверка миграций — в §5 задания Z-v21 (fresh disposable, не трогая production).

## 5. Миграции

- `supabase/migrations/`: **79 файлов** (`0001_init.sql` … `0079_diagnostics_incidents.sql`) — совпадает с заявлением Z-v20 о 79.

## 6. Релизные документы Z-v20 (факт наличия)

`docs/release/` — 16 файлов: `BACKUP_RECOVERY_READINESS.md`, `CI_CD_RELEASE_CHECK.md`, `DATABASE_RELEASE_CHECK.md`, `FINAL_QA_REPORT.md`, `KNOWN_LIMITATIONS.md`, `OWNER_ACTIONS_REQUIRED.md`, `PRODUCTION_ENVIRONMENT_REQUIREMENTS.md`, `RELEASE-03_FINAL_HARDENING_REPORT.md`, `RELEASE-03_OWNER_DECISIONS.md`, `RELEASE-03_VERIFICATION_REPORT.md`, `RELEASE_READINESS.md`, `RELEASE_RUNBOOK.md`, `ROLLBACK_RUNBOOK.md`, `SECURITY_RELEASE_REVIEW.md`, `UX_UI_AUDIT.md`, `Z_V20_INITIAL_GROUND_TRUTH.md`.

## 7. Dev-сервер и health (фактические наблюдения)

- При старте Z-v21 dev-сервер существовал, но **умер** (процесс исчез; признак — ~3.2 GB RSS на машине с 3.9 GB RAM, подозрение на OOM). Перезапущен `bun run dev` в фоне.
- `GET /` → **200**; `GET /api/health` → 200 JSON: `app: ok`, `database: ok`, `n8n: ok`, **`auth: "not-configured"`**, `status: "degraded"`, `lastCriticalAt: null`.

⚠️ Первичные сигналы для последующих разделов Z-v21:
1. `auth: not-configured` — требует разбора в §11.1 (регистрация/вход).
2. `n8n: ok` — что именно проверяет health; фактическое выполнение workflows — в §8.
3. OOM при компиляции Next.js — ограничение среды: браузерные/сборочные проверки только последовательно.

## 8. Что подтверждено из Z-v20 vs что известно только из отчёта

**Подтверждено фактическими командами (эта сессия):**
- HEAD `1505c0b`, ветка main, 225 ahead / 0 behind, чистое дерево кроме 4 защищённых записей;
- защиты (hooksPath, pre-commit, protected-paths.sh) на месте;
- 79 файлов миграций;
- 16 релизных документов;
- PostgreSQL 18 (embedded) запускается локально;
- dev-сервер стартует, `/` и `/api/health` отвечают.

**Известно только из отчёта Z-v20 (требует повторной проверки в Z-v21):**
- применение 79 миграций к чистой PG18;
- 1567 unit-тестов PASS, 244 E2E;
- 81/81 order-lifecycle;
- сборка production build PASS;
- CI workflows валидны (фактически на GitHub не запускались);
- OAuth (Yandex/VK), YooKassa sandbox, n8n execution — ранее заявлены как BLOCKED/501/не доказаны.

## 9. Ограничения окружения (для планирования)

- RAM 3.9 GB: тяжёлые процессы (build, браузеры) — строго последовательно, малым числом workers.
- Нет внешнего доступа к GitHub Actions (без push) — CI проверяется локальными эквивалентами.
- Секреты не выводятся; проверка только на наличие имён переменных.
