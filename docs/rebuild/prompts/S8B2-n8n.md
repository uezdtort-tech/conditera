# ПРОМПТ S8B2 — n8n-интеграция: receiver + актуальные workflow

Этап 8 «Автоматизация» | Блок 2. Зависимости: S8B1 (cron-реестр).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — интеграционный инженер. n8n-слой v2: receiver-микросервис,
25 актуализированных workflow-JSON (покрытие 100% реестра), дашборд
автоматизации в админке.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 + TS strict; bun; mini-services/n8n-receiver — отдельный
  bun-сервис (СВОЙ package.json, порт 5678, `bun --hot`).
- Безопасность: receiver в dev слушает 127.0.0.1; все вызовы Next →
  safe-fetch с X-Cron-Secret; не печатать .env*.
- Процесс: коммит `[S8B2] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты; старый проект — только чтение (JSON читаем).

## 3. ЦЕЛЬ БЛОКА
Receiver v2 (events + healthz + dev-keeper), обновлённые workflow-JSON
для ВСЕХ 20 задач (закрыть пробел старого проекта — 7 задач без JSON),
da­шборд n8n в админке, инструкции импорта.

## 4. ШАГИ
1. mini-services/n8n-receiver (перенести из старого и упростить):
   - HTTP :5678: GET /healthz → {status, received}, POST /events
     (запись событий в кольцевой буфер + опц. пересылка в Next),
     встроенный dev-keeper (probe Next :3000/15s → respawn bun run dev)
     — как в старом (проверено, работает);
   - лог в .zscripts/mini-service-n8n-receiver.log.
2. Workflow-JSON: за основу — старые 25 файлов (n8n-workflows/*.json):
   - обновить ВСЕ URL шагов на новый контур: Next /api/cron/run/[taskId]
     с X-Cron-Secret из переменной окружения n8n (не хардкод секрета
     в JSON!);
   - закрыть пробел: для 7 задач без JSON (auto-approve,
     diagnostics-cleanup, escrow-release, holiday-reminders,
     payment-reminders, sitemap-refresh, subscriptions) — создать
     workflow по образцу существующих (schedule trigger + HTTP Request
     + error-branch);
   - remove дубли (25 → консолидировать до 20 — по одной на задачу);
   - экспорт: n8n-workflows/ v2 в новом репозитории.
3. Map соответствий docs/AUTOMATION.md (S8B1) дополнить колонкой
   «workflow-файл → задача» (100% покрытие).
4. Дашборд /admin/automation: карточка «n8n» — статус receiver
   (healthz через safe-fetch), список workflow с кнопкой «Скачать JSON»
   (как в старом n8n-automation-dashboard), инструкция импорта
   (Workflows → Import from File, env-переменная CRON_SECRET в n8n).
5. E2E-проверка контура: n8n в песочнице не запускается — вместо него
   смоук-скрипт scripts/smoke/n8n-simulate.ts: читает workflow-JSON →
   выполняет их HTTP-шаги по расписанию-эмуляции (однократно) →
   проверяет, что каждая задача реестра отвечает success. Это
   доказывает актуальность JSON без живого n8n.
6. Метрики: receiver received-counter → в healthz; админ-карточка
   показывает число событий за 24ч.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- mini-services/n8n-receiver/index.ts — целиком (dev-keeper!);
- 25 workflow-JSON — как шаблоны (URL/секреты обновить);
- n8n-automation-dashboard.tsx — UI-паттерн карточек.

## 6. ЗАПРЕТЫ
- Хардкод CRON_SECRET или любых секретов в JSON/коде — запрещён.
- Прямые URL localhost:3000 в JSON — только env-плейсхолдеры
  {{BASE_URL}}.
- Не запускать n8n-движок в песочнице (только smoke-симулятор).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] Receiver: healthz ok, events счётчик работает;
- [ ] 20 workflow-JSON (по одному на задачу), URL — плейсхолдеры,
      секрет — env-переменная;
- [ ] smoke-скрипт: 20/20 задач success через JSON-шаги;
- [ ] Дашборд n8n: статусы + скачивание JSON; tsc 0; lint 0; коммит
      [S8B2]; worklog; docs/AUTOMATION.md с 100% покрытием.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser + bun)
- bun scripts/smoke/n8n-simulate.ts → сводка 20/20;
- agent-browser: карточка n8n в /admin/automation.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S8B2]; n8n-workflows/ v2; docs/AUTOMATION.md; worklog.
- Отчёт: как импортировать в боевой n8n, что осталось владельцу
  (n8n-инстанс, env CRON_SECRET).
