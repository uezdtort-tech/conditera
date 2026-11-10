# Z-v20 — Initial Ground Truth (ЭТАП 1)

**Дата фиксации:** 2026-11-10 18:50 UTC
**Метод:** только прямые измерения текущего репозитория и окружения. Старые отчёты не использовались как доказательства.

---

## 1. Git

| Параметр | Значение |
|---|---|
| HEAD | `2f52a55af5d62e7353abf4f352402998d11168d2` |
| Ветка | `main` |
| Родитель HEAD | `744a68105f43ca8e8a2c366c3894cf1ca6a6af67` |
| `git status` | чистое рабочее дерево, 0 изменённых, 0 staged |
| `git diff` / `git diff --cached` | пусто |
| Ahead / behind (origin/main) | **220 ahead / 0 behind** |
| Stash | пусто |

### Цепочка коммитов после Z-v19 (проверено)

```
ea7379f (DEPLOY-01 EXT ops+docs)
  → f79ed46 (Z-v19 независимая пост-верификация)
    → 744a681 (Z-v19 evidence prodpath PG18, 2 прогона)
      → 2f52a55  «30e85e7c-82a1-403d-8858-93e70ee38859»  ← текущий HEAD
```

**2f52a55 — пустой коммит** (tree идентичен родительскому `8ccff750…`, 0 файлов изменено, subject — UUID). Работа продолжается от фактического HEAD; откат не требуется.

Новых непустых коммитов после Z-v19 не появилось. Конфликтов нет.

## 2. Git hooks / защита

| Параметр | Значение |
|---|---|
| `core.hooksPath` | `scripts/hooks` |
| `scripts/hooks/pre-commit` | исполняемый, вызывает `scripts/protected-paths.sh hook-guard` (drift-предохранитель инцидентов #13–#17) |
| Изменения hooks/защиты в этой сессии | **запрещены и не выполнялись** |

## 3. Защищённые upload-файлы (только метаданные, содержимое не читалось)

7 файлов отслеживаются в `upload/`; **все 7 присутствуют в worktree** (проверка `ls`/`[ -f ]` по именам; содержимое не читалось):

- `upload/MASTER PROMPT — «Уездный кондитер» 2026.md` — present
- `upload/ПРОМПТ_ДЛЯ_НОВОГО_ЧАТА_v3.md` — present
- `upload/Brokgauz_amp_Efron-Italic.ttf` — present
- `upload/Miama Nueva.ttf` — present
- `upload/ofont.ru_TriodPostnaja.ttf` — present
- `upload/Pasted markdown.md` — present
- `upload/tz.pdf` — present

`git ls-files -v upload/` → все `H` (обычный индекс, skip-worktree не используется).
`git status upload/` → пусто (нет удалений/модификаций).

**Вывод:** расхождение, зафиксированное в Z-v19 («4 файла отсутствуют в worktree»), в текущем состоянии **не воспроизводится — устранено**. Защитные механизмы целы. Восстановление владельцем не требуется. Файлы не читались, не редактировались, флаги не изменялись.

## 4. Процессы и сервисы (локальная dev-среда)

| Сервис | Порт | Состояние |
|---|---|---|
| Next.js dev (`next-server v16.3.5`, `bun run dev:local`) | 3000 | работает; RSS ≈ 1.6 GB (наблюдение, контролируется в ЭТАП 9) |
| PostgreSQL (embedded, `@embedded-postgres`, `.pgdata`) | 54329 | работает |
| chat-server (`mini-services/chat-server`, bun --hot) | 3030 | работает, `/healthz` = ok, connections: 0 |
| **n8n-receiver** (`mini-services/n8n-receiver`, bun --hot) | 5678 | работает, `/healthz` = ok, received: 12 |
| simplex-bridge (`mini-services/simplex-bridge`) | 5226 | работает |
| gateway/reverse proxy (Caddy) | 81 | отвечает HTTP 200 |

Примечание: в `mini-services/n8n-receiver/index.ts` присутствует задокументированный блок `TEMP-DEV-KEEPER` (авто-рестарт dev-сервера при OOM; откат описан в самом блоке). Изменения в этой сессии не вносились.

## 5. Состояние Supabase / GoTrue

`/api/health` (реальный ответ 18:48 UTC):

```json
{"app":"ok","database":"ok","n8n":"ok","auth":"unreachable","status":"ok",…}
```

- База: **ok** (embedded PostgreSQL 54329).
- **GoTrue/Supabase auth: unreachable** — локальный Supabase-стек не поднят (docker-compose.supabase.yml не запущен). Все auth-проверки в этой сессии будут классифицироваться с учётом этого ограничения (BLOCKED для реального OAuth/login E2E, если stack не поднят).

## 6. Состояние n8n (автоматизация)

| Компонент | Состояние |
|---|---|
| `src/lib/n8n.ts` (исходящий эмиттер) | fail-safe, timeout 3s, dead-letter → `audit_log` (`n8n.dead-letter`) |
| Точки эмита | checkout, orders (+cancel, +[id]), payment/webhook, payment/refund, chat messages, inventory movements, services/bookings, ops/lifecycle |
| `mini-services/n8n-receiver` :5678 | **E2E подтверждено: 12 реальных событий** (`order.created` ×11, `order.status_changed` ×1) дошли от приложения до приёмника |
| `POST /api/webhooks/n8n` (входящий) | fail-closed: без `N8N_WEBHOOK_SECRET` → 503; протестировано [503] |
| `X-Cron-Secret` cron-endpoints | fail-closed: `/api/cron/abandoned-cart` без секрета → 401 (протестировано) |
| `n8n-workflows/*.json` | 25 файлов, **все валидный JSON** |
| `docker-compose.yml` сервис n8n | определён (n8nio/n8n:1.95.0, CRON_SECRET/N8N_ADMIN_PASSWORD required, healthcheck, volume ./n8n-workflows:/imports) |
| Настоящий n8n (docker) | **не запущен**; работает локальный приёмник-заглушка |

## 7. Окружение / секреты

- `.env` (61 байт) и `.env.local` (1278 байт) существуют; содержимое не выводилось.
- Имена переменных (без значений) в `.env.local`: `DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, CRON_SECRET, BOT_SECRET, N8N_BASE_URL, N8N_WEBHOOK_BASE_URL, OLLAMA_BASE_URL, OLLAMA_MODEL, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `N8N_WEBHOOK_SECRET` в `.env.local` отсутствует → входящий вебхук n8n остаётся в fail-closed 503 (ожидаемое поведение до настройки владельцем).

## 8. Отклонения от ожиданий / что передаётся в ЭТАП 2+

1. Новый пустой коммит `2f52a55` — зафиксирован, не мешает работе.
2. Защищённые файлы — **ок** (Z-v19 расхождение устранено).
3. GoTrue локально недоступен — ограничение для auth E2E.
4. Настоящий n8n не поднят — работает dev-приёмник; цепочка эмиттер→приёмник проверена E2E.
5. Предварительные находки для ЭТАП 3/4 (n8n-дашборд): `MOCK_RECENT_RUNS` отображается в админке как «История запусков (последние 24 часа)» без маркировки «демо»; кнопка «Симулировать» показывает случайные числа; кнопка скачивания JSON отдаёт пустой workflow (`nodes: []`); инструкция «импортируйте 3 JSON-файла» при 25 существующих; дублирование механизмов автоматизации (n8n vs `scheduled_jobs`+pg_cron в `use-automation.ts`). Подтверждение и исправление — в соответствующих этапах.
