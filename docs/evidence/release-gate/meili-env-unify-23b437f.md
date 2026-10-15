# DEV-13: Meilisearch env-контракт унифицирован на MEILI_URL

HEAD at fix: 23b437f (commit of this change follows). Date: 2026-10-16. TZ v4.0 §9 (P1).

## 1. Trace всех call-site'ов MEILI* (grep -rn "MEILI", tests/e2e/** и docs/evidence/e2e-tally/** — только report-only, чужая зона)

| Путь | Было | Вердикт |
|---|---|---|
| `docker-compose.yml:67` (web service env) | `MEILISearch_URL=http://meilisearch:7700` | ДЕФЕКТ: регистр сломан, код переменную не читал → в Docker-стеке поиск падал на localhost-фоллбэк |
| `src/lib/meilisearch.ts:33` | `process.env.MEILI_HOST \|\| process.env.MEILI_URL \|\| 'http://localhost:7700'` | Истина кода: читает MEILI_HOST (legacy) → MEILI_URL (канон) → localhost |
| `scripts/reindex-meilisearch.ts:11,30` | док-комментарий и error-сообщение упоминали `MEILISearch_URL` | Дрейф → исправлены на MEILI_URL |
| `docs/PGBOUNCER_MEILISEARCH.md:294` | закомментированный пример `MEILISearch_URL=` | Дрейф → исправлен на MEILI_URL |
| `scripts/verify-env.sh:45`, `.env.local.example:34`, `.env.production.example:33`, `docs/RUNNING_MIXED.md:82,123`, `docs/WINDOWS_SETUP.md:84` | `MEILI_URL` | Уже канон, без изменений |
| `docker-compose.yml:244` (meilisearch service), `docker-compose.dev.yml:59` | `MEILI_MASTER_KEY` | Master-key контейнер-сёрвера — не URL-контракт, без изменений |
| `tests/e2e/**`, `docs/evidence/e2e-tally/**` | — | grep: 0 упоминаний MEILI; изменений НЕТ (зона параллельного агента) |

`MEILI_HOST`: единственное упоминание во всём репо — fallback в `src/lib/meilisearch.ts:33`; ни один env-файл, док или сервис его не задаёт → реального использования НЕТ.

## 2. Решение

Контракт = **MEILI_URL** (имя, которое реально читает код; оба .env-шаблона и verify-env.sh уже его документируют).
- `docker-compose.yml` web: `MEILISearch_URL=…` → `MEILI_URL=http://meilisearch:7700` (in-network URL сохранён), ключ-опечатка удалён.
- Код `src/lib/meilisearch.ts` НЕ менялся (MEILI_URL уже читается; MEILI_HOST оставлен как legacy-fallback с предупреждением в smoke-скрипте).
- Build-time инлайнинг: `next.config.ts` не содержит блока `env:`, Dockerfile не прокидывает MEILI_*, переменные не `NEXT_PUBLIC_*` → контракт строго server-side runtime. Подтверждено.

## 3. Smoke: scripts/verify/meili-smoke.mjs (статусы/коды, без секретов)

Запуск в песочнице (Meilisearch локально НЕ запущен):

```
$ MEILI_URL=http://localhost:7700 node scripts/verify/meili-smoke.mjs
health: FAIL (ECONNREFUSED) — Meilisearch недоступен по http://localhost:7700
search-ping: SKIPPED (health не прошёл)
master-key: NOT set
SMOKE FAIL
exit code: 1
```

**Вердикт: ENVIRONMENT-BLOCKED (честно, НЕ PASS).** ECONNREFUSED ожидаем: в песочнице нет контейнерной сети/сервиса.
Container-network smoke (`MEILI_URL=http://meilisearch:7700` после `docker compose up -d meilisearch`) —
это gate владельца Docker-хоста: ожидаемо `health: PASS (HTTP 200, status=available)` +
`search-ping: PASS (HTTP 200 или 404 index_not_found)` → `SMOKE PASS`, exit 0.
Дополнительно проверено поведение скрипта: без env → exit 1 («переменную контракта читать неоткуда»);
legacy `MEILI_HOST` → WARNING на stderr и работа через fallback.

## 4. Unit-регрессия (решение: НЕ добавлена)

По критерию «только если тест для meilisearch.ts уже существует рядом»: рядом (`src/lib/`)
есть `product-search.test.ts`, но он покрывает детерминированный движок P2.1
(`src/lib/product-search.ts`), а НЕ клиент Meilisearch; отдельного
`meilisearch.test.ts` в репо нет → unit-тест на резолв URL не заведён, чтобы не
создавать новую тестовую инфраструктуру в чужой зоне (vitest include `src/**`).
Контракт зафиксирован smoke-скриптом + этим evidence вместо unit-теста.

## 5. Изменённые файлы (file:line)

- `docker-compose.yml:67-69` — MEILISearch_URL → MEILI_URL (+ комментарий контракта)
- `scripts/reindex-meilisearch.ts:11,30` — упоминания MEILISearch_URL → MEILI_URL
- `docs/PGBOUNCER_MEILISEARCH.md:294` — пример env → MEILI_URL
- `scripts/verify/meili-smoke.mjs` — новый smoke-скрипт
- этот evidence-файл
