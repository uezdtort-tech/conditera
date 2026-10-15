# Task 6-a — production-config gaps (DEV-12, DEV-13, DEV-15, DEV-16, DEV-17; TZ v4.0 §9)

Agent: Z.ai Code
Status: DONE — 5 commits, не запушены (по одному на дефект)

## Commits
- f87e057 DEV-12 config(env): .env.production.example required-var contract + automated check
- 29cee6c DEV-13 fix(search): unify Meilisearch env contract to MEILI_URL
- 142956e DEV-15 build(docker): pass GIT_SHA build arg into web image APP_VERSION
- f28b090 DEV-16 docs(ops): mailu.env profile contract + preflight behavior
- d82d5f6 DEV-17 fix(health): coherent readiness status + regression tests (amend собственного tip d2f192b: fold-back формы тела, unpushed)

## Ключевые решения
- DEV-12: 6 required имён подтверждены на текущем compose (11 `:?`-вхождений); PRE-FIX прогон чекера exit 1 → POST-FIX exit 0; плейсхолдеры CHANGE_ME_* ≥24 симв.
- DEV-13: контракт = MEILI_URL (MEILI_HOST — мёртвый fallback, 0 использований); compose-опечатка MEILISearch_URL удалена; smoke ENVIRONMENT-BLOCKED (ECONNREFUSED, exit 1 зафиксирован честно); unit-vitest НЕ заводился (нет соседнего теста meilisearch.ts) — отмечено в evidence.
- DEV-15: ARG GIT_SHA уже был в Dockerfile (43-44/72-73) — добавлен только build-args в ci.yml (web-образ; chat/bridge — без ARG, не трогал); health-роут не редактировался (зона DEV-17).
- DEV-16: mailu.env — единственный env_file сервиса mailu (profiles [mail,full]); дефолт-профиль от файла не зависит (static); advisory-preflight в env-check.sh gated на 2-й аргумент-профиль; /mailu.env в .gitignore.
- DEV-17: фикс противоречия «503 + status:"ok"» → status учитывает dbStatus; n8n — fail-open по докблоку; тесты 6/6 (моки pool/fetch, env restore); прежний route.test.ts (3e1901b) переработан с сохранением формы-покрытия; tsc/eslint/live-200 — чисто.

## Границы
- Dev-стек не перезапускался (read-only curl /api/health после hot-reload); tests/e2e/** и docs/evidence/e2e-tally/** не тронуты; git add — только свои файлы; секретов нет.
- НЕ RUN: container-network meili smoke и `docker compose config` (sandbox без docker engine) — gate владельца.
