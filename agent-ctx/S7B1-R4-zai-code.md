# S7B1-R4 — zai-code report (Conditera v2, recreate-3, redo after data loss)

- Task ID: S7B1-R4 · Дата: 2026-11-21 · Роль: backend-инженер AI-слоя (S7B1).
- База: HEAD 3d54d9c (S6B2 docs, PG fresh). Спека:
  /home/z/my-project/docs/rebuild/prompts/S7B1-llm-core.md.
- Старый проект READ-ONLY: порты ai-config.ts / llm.ts / /api/ai/config
  (коммит e5dd2d8) — контракты env-ключей сохранены.

## 1. Файлы (v2)

- src/lib/ai-config.ts — порт конфига: AI_PROVIDER_ORDER (дефолт v2
  "zai,ollama" — спека задания; в старом был "ollama,zai"),
  OLLAMA_BASE_URL/OLLAMA_MODEL/OLLAMA_TIMEOUT_MS, AI_ZAI_MODEL,
  AI_TEMPERATURE, AI_MAX_TOKENS, + НОВЫЙ AI_TIMEOUT_MS (30000, D12/15);
  getAiConfig() — свежее чтение env; секретов нет; pure-функции
  parseAiProviderOrder/clampTemperature для vitest.
- src/lib/ai/llm.ts — chatComplete(messages, opts?) → {text, model,
  provider, tokens{in,out}|null, ms} | null. zai: ленивый singleton клиента
  на globalThis + Promise.race(вызов, таймаут) — SDK без AbortSignal (D12/15);
  ошибки SDK не печатаются (err=sdk_error, конфиг self-contained). Ollama:
  ТОЛЬКО safeFetch (SSRF-guard SAFE_FETCH_ALLOWLIST) + timeoutMs. Ретай 1×
  на провайдера ТОЛЬКО на таймауте. DEBUG-лог: provider/action/ms/tokens,
  содержимое НИКОГДА.
- src/lib/ai/limits.ts — AI_ACTION_RULES: assistant 20/мин, search 30/мин,
  compare 10/мин, cake-finder 10/мин, dialogue 20/мин; checkAiAction(action,
  key) на store S2B3 (consumeRateLimit), отказ → готовый 429 + Retry-After
  (rateLimitResponse); bucket-ключ ai:<action>:<profileId|ip>.
- src/lib/ai/prompts.ts — RU системные промпты В КОДЕ: вежливый помощник
  CONDITERA, краткость 1–4 предложения, «не выдумывай товары — только
  переданный контекст»; ввод пользователя — только в user-роли messages.
- src/lib/ai/respond.ts — respondWithAi({messages, action, key, fallbackFn}):
  лимит → 429; chatComplete null/throw → fallbackFn(); НИ ОДНОГО 500 из-за
  AI (контракт роутов S7B2).
- src/lib/ai/availability.ts — пробы: zai (import+create, кэш 60 c на
  globalThis), ollama (GET /api/tags, safeFetch, 1.5 c).
- src/app/api/ai/config/route.ts — GET, withAdmin: config + availability +
  actions/лимиты + envKeys/defaults/consumers; секретных полей/значений нет.
- src/app/api/ai/selftest/route.ts — POST, withAdmin+CSRF, DEV-ONLY
  (NODE_ENV=production → 404): пинг → {ok:true, provider, model, ms, text} |
  {ok:false, error:"ai_unavailable"} (200 при валидном запросе); расходует
  assistant-bucket; dev-override {providers, baseUrl, timeoutMs} (clamp
  100..60000; baseUrl идёт через safeFetch — SSRF-guard в силе).
- src/lib/ai.ts — S1B1-заглушка поглощена (реэкспорт-фасад; потребителей не
  было — grep).
- .env.local.example — блок «AI — LLM-ядро» (ключи + комментарии, значения
  пустые); .env.local (gitignored) — AI_PROVIDER_ORDER=zai,ollama,
  AI_TIMEOUT_MS=30000, OLLAMA_TIMEOUT_MS=30000, OLLAMA_BASE_URL пуст.
- package.json/bun.lock — z-ai-web-dev-sdk@0.0.18 (bun add; backend-only).
- tests/s7b1-llm-core.test.ts — 11 pure-тестов (парсер order, clamp,
  карта лимитов, checkAiAction 20→21-й отказ + Retry-After, изоляция
  ключей/действий).

## 2. env-ключи (как конфигурировать локально)

| Ключ | Default | Смысл |
|---|---|---|
| AI_PROVIDER_ORDER | zai,ollama | порядок провайдеров (zai/ollama) |
| AI_ZAI_MODEL | glm-4 | метка модели z-ai (логи/метрики) |
| AI_TEMPERATURE | 0.6 | сэмплинг 0..2 (clamp) |
| AI_MAX_TOKENS | не задан | лимит токенов ответа |
| AI_TIMEOUT_MS | 30000 | таймаут вызова z-ai SDK (Promise.race) |
| OLLAMA_BASE_URL | не задан | URL без /api; пуст → ollama пропускается; хост — SAFE_FETCH_ALLOWLIST |
| OLLAMA_MODEL | llama3.2 | модель Ollama |
| OLLAMA_TIMEOUT_MS | 30000 | таймаут safeFetch к Ollama |

Как проверять лимиты: POST /api/ai/selftest расходует assistant (20/мин по
profile.id): 21-й вызов в минуту → 429 + Retry-After (сброс — рестарт dev).

## 3. Гейты

- lint 0; tsc --noEmit 0; vitest 149 passed (11 новых pure).
- Curl-матрица /home/z/my-project/agent-ctx/s7b1-matrix.sh (лог
  s7b1-matrix-output.txt, cookie-jar -b/-c, CSRF): PASS=34 FAIL=0.
  - RBAC/privacy: /api/ai/config anon 401 → customer 403 → admin 200;
    order=zai,ollama; availability.zai.reachable=true; actions=5 (assistant
    limit 20); НЕТ секретных полей и НЕТ значений секретов .env.local в теле
    (negative-grep по SECRET/TOKEN/KEY ≥16 симв.).
  - Selftest default: ok:true, provider=zai, model=glm-4, ms=426, text есть.
  - Timeout gate (задание): override {providers:["ollama"],
    baseUrl:"http://127.0.0.1:9", timeoutMs:3000} → ok:false за 69ms
    (не hang, ≤15s).
  - Timeout PROOF (D12): blackhole-listener 127.0.0.1:9990 (accept, без
    ответа) + override timeoutMs:3000 → ok:false за 6063ms = 2 попытки × 3s
    (ретай на таймауте сработал; ≤15s).
  - Limits: рестарт dev (чистый in-memory store) → 20 selftest × 200 →
    21-й → 429 + Retry-After: 54s, body rate_limited.
  - Logs /tmp/dev-v2.log: provider=zai action=selftest ok=true ms= присутствуют;
    «пинг» (содержимое) ОТСУТСТВУЕТ; env-значения не печатаются.
- Restart dev: agent-ctx/s7b1-restart.sh (pkill next-server → .env.local целиком
  → bun run dev >> /tmp/dev-v2.log, wait 200).
- Browser: skip (backend-блок); sanity render / → 200, /catalog → 200
  (в матрице).

## 4. Приватность/безопасность

- SDK backend-only (импорт только в src/lib/ai/llm.ts и availability.ts,
  server-код); grep "z-ai-web-dev-sdk" src/ → 2 файла, оба серверные.
- Конфиг/ошибки SDK никогда не печатаются и не попадают в ответы.
- Логи: только provider/action/ms/tokens/model-метка — содержимого нет.
- Ollama — только safeFetch (SSRF-guard, allowlist, body cap, no-redirect).
- Хардкодов модели/температуры вне ai-config.ts нет (значения берутся из
  getAiConfig() во всех вызовах).

## 5. Артефакты и пины

- Код v2: be5f6e2 «[S7B1] llm-core: ai-config port, provider chain timeouts
  (D12), per-action limits, admin config endpoint, fallback respond
  (recreate-3-r4)».
- Docs v2: 7e365d0 «[S7B1] docs: worklog (sha/bundle pinned)» (worklog r4:
  env-таблица, лимиты, пины).
- Бандл: backups/conditera-v2-S7B1-be5f6e2.bundle — 1 450 116 B, создан
  СРАЗУ после docs-коммита (урок recycle №7); git bundle verify OK
  (complete history, main=7e365d0); clone-проба → HEAD 7e365d0, src/lib/ai/
  на месте; закоммичен в root e0ef928 «backup: conditera-v2 S7B1 bundle
  be5f6e2» (в коммит вошёл ТОЛЬКО файл бандла).
- Root worklog: recreate-3-S7B1-r4 записан, «Далее: S7B2».
- Матрица: agent-ctx/s7b1-matrix.sh + s7b1-matrix-output.txt;
  рестартер: agent-ctx/s7b1-restart.sh.

## 6. Отклонения (осознанные, в worklog тоже)

1. Дефолт AI_PROVIDER_ORDER "zai,ollama" (старый: "ollama,zai") — по спеке
   задания S7B1-R4; env-контракт ключей не менялся.
2. AI_TIMEOUT_MS — новый ключ v2 (в e5dd2d8 только OLLAMA_TIMEOUT_MS):
   закрытие D12/15 для SDK.
3. Пробы availability на каждый GET /api/ai/config без ?probe=1 (старый
   контракт) — zai-проба кэшируется 60 c, ollama 1.5 c; проще для S7B2.
4. Selftest возвращает 200 при ok:false (AI-недоступность — штатная
   деградация, не ошибка сервера).
5. Bundle-файл лежит в корне backups/ (root-repo паттерн прежних блоков);
   копия также в conditera-v2/backups/ (v2 .gitignore *.bundle её игнорирует).
6. Платформенный z-ai-эндпоинт троттлит быстрые подрядные вызовы: в burst-фазе
   матрицы (20 selftest за ~30 c) часть ответов платформы — 429 "Too many
   requests"; ядро обрабатывает штатно (err=sdk_error → null → ok:false, HTTP
   200, НИ ОДНОГО 500). Сам SDK печатает свой console.error ("Failed to make
   API request … 429") — печать ИДЁТ от SDK, не от нашего кода; секретов в
   выводе нет. Гейт спеки («21-й → 429 + Retry-After» — наш per-action
   rate-limit) выполнен: burst 20×HTTP 200, 21-й → наш 429 + Retry-After 54s.

## 7. Recovery-контекст / S7B2 readiness

- Восстановление: git clone bundle → main=7e365d0; dev :3100
  (agent-ctx/s7b1-restart.sh), демо-учётки @demo.ru (Demo123!).
- Ядро готово к S7B2: chatComplete(messages, {action}) + respondWithAi
  (fallback обязателен), лимиты checkAiAction, промпты systemPromptFor
  (assistant/search/compare/cake-finder/dialogue) — роуты S7B2 подключают
  без правок ядра. /api/ai/config CONSUMERS дополнить списком новых роутов.
- Правило процесса: коммит кода → docs-коммит → БАНДЛ СРАЗУ (recycle №7).
