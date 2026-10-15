# Release Gate v4.1 — Этап 1: checkpoint и доказательства

- Дата: 2026-10-15 (UTC), HEAD на момент снимка: `4a901ae36b5b23c16af42d89fa79450590b6080c`
- Ветка: `main`; дерево чистое (см. ниже один восстановленный drift)

## 1. Checkpoint
- `git rev-parse HEAD` → `4a901ae36b5b23c16af42d89fa79450590b6080c`
- `git branch --show-current` → `main`
- `git fetch origin` (read-only) → без изменений
- `origin/main` = `8454b3ae249801effb6a699abb6633db164a219b`
- ahead = **52**, behind = **0** (`git rev-list --left-right --count origin/main...HEAD` → `0 52`)
- Публикация проверена по GitHub API (`GET /repos/uezdtort-tech/conditera/commits/main`):
  remote main = `8454b3ae…` → **локальные 52 коммита НЕ опубликованы** (не по локальному fetch, а по первичному ответу GitHub).

## 2. Protected upload routes — повторный drift (DRIFT #7) и восстановление
- На старте сессии: `git status --short` → ` D src/app/api/upload/route.ts`, ` D src/app/api/services/upload/route.ts`
  (обе удалены в рабочем дереве, БЕЗ коммита — тот же механизм, что DRIFT #6 в v3.0).
- Точный deletion diff сохранён ДО восстановления: `docs/evidence/release-gate/pre-restore-deletion-diff-v41-4a901ae.txt` (162 строки, идентично прецеденту v3.0).
- Восстановление: точечный `git restore -- <два файла>` (НЕ массовый), результат: оба tracked, на диске, идентичны HEAD, дерево чистое.

## 3. Vitest 928 → 925: погрешность сведена к конкретным файлам
Файлы тестов, изменённые с эры 928 (`7a8d878`) до HEAD: только
1. `src/app/api/health/route.test.ts` — vitest: **9 → 6 тестов (−3)** → объясняет 928 − 3 = 925;
2. `tests/e2e/integration-auth-flow.spec.ts` — Playwright E2E (в vitest-счётчик не входит).

### Доказательство отсутствия ослабления (реворк `d82d5f6`)
СТАРЫЕ 9 (толерантные): 200-когда-БД-жива/503-иначе; service; version; timestamp; uptime;
features (v2.0); dependencies; environment.

НОВЫЕ 6 (детерминированные, с моками):
1. БД доступна + env → 200, database:'ok', status:'ok'
2. БД недоступна → **503 + database:'unavailable' + status:'degraded'** (новое утверждение — фикс DEV-17)
3. n8n недоступен → fail-open по контракту (200)
4. required env отсутствует (БД жива) → 200 + status:'degraded'
5. комбинированная деградация → 503 + degraded
6. тело содержит контракт и форму v2.0 — **все прежние body-проверки включены дословно**
   (service, version, timestamp, uptime, environment, features.roles_v2/rbac/csrf_protection,
   dependencies[].supabase.required/configured — проверено grep-ом и чтением теста).

Вывод: консолидация 9→6, покрытие СТРОГО шире (5 новых поведенческих сценариев +
все старые проверки сохранены); ни одно утверждение не удалено и не ослаблено.

## 4. SHA-binding production build
- Build PASS v4.0 исполнен на дереве `ad787ed` (`build-v4-ad787ed.log`, exit 0, 233/233 страниц).
- Коммит `4a901ae` (отчёт v4.0) НЕ меняет исходники: `git diff --name-only ad787ed..4a901ae | grep -vE '^(docs/|worklog\.md|agent-ctx)' | wc -l` → **0**.
- Следовательно build-результат привязан к текущему исходнику (source-equivalence доказана);
  независимо от этого на финальном дереве v4.1 выполнен свежий build (см. Этап 4 evidence).

## 5. Гигиена
- История не переписывалась; массовых reset/clean/restore нет (точечный restore 2 файлов);
- все новые evidence до коммита проходят `node scripts/scan-evidence.mjs` (exit 0).
