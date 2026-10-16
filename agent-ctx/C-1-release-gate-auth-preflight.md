# Task C-1 — Release Gate v4.1 Этап 3: GoTrue reachability preflight в /api/health

Agent: Z.ai Code
Status: DONE, commit 8cbf9c6 (single commit, not pushed). База: main @ 1a19c29.
Предыдущие записи агентов: /agent-ctx (B-1 — checkout idempotency; 4-a — dev-process-manager; 6-a — production-config).

## Ownership & forbidden zones
- МОИ: src/app/api/health/** (route + tests), src/app/api/auth/register/** (READ-ONLY — fail-closed сохранён, 0 diff на route.ts), auth-lib config (НЕ менялся — resolveSupabaseServerUrl в src/lib/supabase/url.ts уже покрывал потребность), tests, docs/evidence.
- НЕ ТРОНУТЫ: Dockerfile.simplex-bridge, docker-compose.yml, .env.production.example, scripts/env-check.sh (владелец — другой агент), payment/webhook/escrow/payout/refund код. Параллельные коммиты других агентов (7bcf817 simplex, 50214d6 config) моих файлов не касались.

## Topology contract (выведен из кода, file:line)
1. Прод-регистрация = GoTrue admin API: register/route.ts:252-257 `admin.createUser` → POST {SUPABASE_URL}/auth/v1/admin/users; клиент admin.ts:41-58; base — resolveSupabaseServerUrl() (url.ts:25-29).
2. Fail-closed: register/route.ts:259-267 — authErr + NODE_ENV!=="development" → 500 ДО любых записей; auth.users-стаб :278-290 — dev-only; profiles :297-313 / user_roles :333-355 — после.
3. Dev: клиент-stub (admin.ts:21-27) + заглушка /auth/v1/* → 501 LOCAL_AUTH_DISABLED (auth/v1/[...path]/route.ts:17-27; live curl подтверждён).
4. Вывод: проба = GET {SUPABASE_URL}/auth/v1/health (тот же base-path, что и createUser).

## Implementation (минимальная, health/route.ts)
- checkGoTrue(): 3s AbortController, apikey-заголовок (как admin-клиент), never throws; классификация: not-configured (env-пары нет → fetch НЕ выполняется) / reachable (2xx) / unreachable (сеть/таймаут/не-2xx, вкл. 501-заглушку, 404, 5xx шлюза).
- Тело health (аддитивно, прежние поля и HTTP-гейт целы): top-level `auth` ("ok"|"unreachable"|"not-configured") + dep `auth_gotrue` (required:true, reachability, details). Прод-гейт: production && configured && unreachable → status:"degraded" (required-семантика; HTTP 200/503 по-прежнему только по database). Dev/стаб: фактическая классификация БЕЗ прод-маркировки (details: "dev/local runtime, no production gate").
- Fail-closed: НЕ обходится и НЕ ослабляется (probe — read-only preflight).

## Tests (vitest, герметично; NODE_ENV через helper с восстановлением — в next-env read-only, мутируется алиасом)
- health/route.test.ts: 6 → 11 (прежние 6 не менялись). Новые: prod+2xx→auth ok; prod+сеть-ошибка→HTTP 200 + degraded + details fail-closed; prod+501→degraded; dev+501→auth unreachable НО status ok (анти-false-positive, ключевой); not-configured+dev→probe skipped (fetch не выполнялся), деградация только env-presence.
- register/route.test.ts: НОВЫЙ, 3 — prod+authErr→500 и pool/profiles/user_roles/referrals НЕ вызваны (fail-closed locked); dev+authErr→201 + INSERT INTO auth.users ×1; prod+createUser ok→201 (гейт только на фактический authErr). Моки: anti-fraud, supabase/admin, auth, postgrest/pool, metrika/telegram/email. Ловушка vitest: vi.mock-factory хойстится — ссылки на vi.fn() в factory делать ЛЕНИВЫМИ (обёртки (...args) => fn(...args)), иначе TDZ ReferenceError.
- Гейты: bun run test ПОЛНЫЙ → 49 files / 1011 tests exit 0 (48/1003 → +8 тестов, потерь нет); typecheck 0; lint 0.

## Live check (:3000 dev)
- GET /auth/v1/health → 501; GET /api/health → HTTP 200, auth:"unreachable", status:"ok", auth_gotrue details "GoTrue unreachable (HTTP 501) — dev/local runtime, no production gate"; dev.log показывает GET /auth/v1/health 501 от самого роута.
- OPS: Turbopack hot-reload не подхватывал изменение самого health/route.ts (touch/append не помогали) — помогла инвалидация через импортируемый модуль (touch src/lib/supabase/url.ts, затем revert). Приём для следующих агентов.

## .env.production.example (READ-ONLY, п.3)
Только CHANGE_ME-* / пустые / публичные значения (домены, порты, публичный ID Метрики). Реальных секретов нет. Файл не менялся.

## Evidence & scan
- docs/evidence/release-gate/auth-preflight-v41-1a19c29.md (якорь — HEAD на старте; между фиксацией и коммитом легли чужие 7bcf817/50214d6, мои файлы не тронуты — отмечено в шапке).
- scan-evidence: МОЙ файл exit 0 (real 0). ВНИМАНИЕ: полный scan теперь exit 1 — ЧУЖАЯ находка config-reverify-v41-7bcf817.md:145 (supabase-service-role; вошла в параллельный коммит 50214d6, на старте C-1 файла в дереве не было; похоже на цитату CHANGE_ME-шаблона без синтетик-маркеров). Владелец — конфиг-агент; файл мной не трогался.

## Commit
- 8cbf9c6 «feat(health): GoTrue reachability preflight in readiness — production unreachable = degraded, fail-closed untouched (DEV-18)» — 4 файла (health route+test, register test новый, evidence), +661/−7. worklog/agent-ctx не коммитились, push не выполнялся.
