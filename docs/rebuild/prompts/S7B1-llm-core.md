# ПРОМПТ S7B1 — LLM-ядро (конфиг, таймауты, rate-limit)

Этап 7 «AI» | Блок 1. Зависимости: S1B1 (каркас), S2B3 (rate-limit).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер AI-слоя. Переносишь LLM-ядро v2 из старого проекта
(коммит e5dd2d8 — уже вынесенная конфигурация) и закрываешь D12
(таймауты, per-action rate-limit).

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Backend: только Route Handlers; z-ai-web-dev-sdk — ТОЛЬКО в backend.
- Безопасность: safe-fetch (S2B3) для Ollama; env-конфиг; не печатать
  .env*; промпты — без секретов.
- Процесс: коммит `[S7B1] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты; вызовы SDK в клиентском коде; старый проект —
  только чтение.

## 3. ЦЕЛЬ БЛОКА
Единое LLM-ядро v2: env-конфигурация, провайдер-цепочка, таймауты,
rate-limit per-action, /api/ai/config (admin-only) — и модульные
хелперы для функций S7B2.

## 4. ШАГИ
1. Перенести src/lib/ai-config.ts из старого проекта (коммит e5dd2d8)
   БЕЗ изменений контракта: AI_PROVIDER_ORDER, OLLAMA_BASE_URL/
   OLLAMA_MODEL/OLLAMA_TIMEOUT_MS, AI_ZAI_MODEL, AI_TEMPERATURE,
   AI_MAX_TOKENS; блок ключей — в .env.example (S1B1 уже заложил).
2. src/lib/ai/llm.ts: chatComplete(messages, opts?) — цепочка по
   order; ОБЯЗАТЕЛЬНО:
   - Ollama через safe-fetch (таймаут AI_TIMEOUT_MS default 30000,
     SSRF-guard разрешает только OLLAMA_BASE_URL);
   - z-ai: обёртка с Promise.race(вызов, timeout) — SDK не
     гарантирует AbortSignal (закрыть D12/15);
   - ретраи: 1 повтор на провайдер при таймауте (не при 4xx);
   - результат: {text, model, provider, tokens} | null (null —
     вызывающий даёт fallback).
3. Rate-limit per-action: src/lib/ai/limits.ts — карта
   action→(window, max): assistant 20/мин, search 30/мин, compare
   10/мин, cake-finder 10/мин, dialogue 20/мин; интеграция с
   rate-limit.ts (S2B3); ответ 429 с Retry-After.
4. Системные промпты: src/lib/ai/prompts.ts — константы (тонал —
   вежливый помощник CONDITERA, RU; краткость; без выдумок о товарах —
   только переданный контекст). Промпты в коде (не в env) — это
   управляемая логика, не секрет.
5. GET /api/ai/config (admin-only): эффективная конфиг + availability
   probe (как в старом e5dd2d8; Ollama probe 1.5s) + список actions
   с лимитами. Секретов в ответе нет.
6. Fallback-паттерн для роутов S7B2: src/lib/ai/respond.ts —
   обёртка: try chatComplete → если null → дефолтный ответ действия
   (обязательный параметр fallbackFn) — НИ ОДНОГО 500 из-за AI.
7. Логирование: provider, action, ms, tokens (без содержимого
   сообщений — приватность) в DEBUG-лог.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/lib/ai-config.ts + src/lib/llm.ts (e5dd2d8) — база;
- src/app/api/ai/config/route.ts — контракт admin-endpoint;
- уроки LIMIT 15–16 → обязательные таймауты и per-action лимиты.

## 6. ЗАПРЕТЫ
- Вызовы z-ai-web-dev-sdk в client-компонентах — запрещены.
- Хардкод модели/температуры вне ai-config.ts — запрещён.
- Пробрасывать пользовательский ввод в системный промпт без
  разделения ролей messages — запрещено.

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] chatComplete работает с mock и zai (локально zai доступен);
- [ ] таймаут срабатывает (тест с недостижимым OLLAMA_BASE_URL →
      null за ≤30с, не зависает);
- [ ] 21-й запрос assistant в минуту → 429 с Retry-After;
- [ ] /api/ai/config: 401 без сессии, корректен с админом;
- [ ] tsc 0, lint 0; коммит [S7B1]; worklog.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl: POST/GET-пробы лимитов и config-гейта;
- проверка логов: provider/action/ms присутствуют, содержимого нет.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S7B1]; worklog (env-ключи, лимиты).
- Отчёт: как конфигурировать AI локально (env-таблица), как
  проверять лимиты.
