# ПРОМПТ S8B1 — Cron-ядро: единый реестр задач

Этап 8 «Автоматизация» | Блок 1. Зависимости: S1B2 (схема), S4B3,
S6B2 (функции-задачи).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер автоматизации. В v2 ты строишь ЕДИНЫЙ cron-реестр
вместо 20 разрозненных эндпоинтов старого проекта: один манифест задач,
один секрет-гейт, единая история запусков.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Данные: только Prisma; Route Handlers; secret-гейт X-Cron-Secret
  (env CRON_SECRET) — fail-closed.
- Безопасность: задачи НЕ выполняются без секрета; идемпотентность
  каждой задачи (повторный запуск не дублирует эффект); не печатать
  .env*.
- Процесс: коммит `[S8B1] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
Реестр задач src/lib/cron/registry.ts (манифест 20 задач), универсальный
исполнитель, история запусков в БД, админ-страница истории.

## 4. ШАГИ
1. Модель CronRun (миграция): task, status (success|failed|running),
   startedAt, durationMs, stats (json), errorMessage, trigger (cron|
   manual|n8n). История: последние 50 на задачу (ротация).
2. Реестр src/lib/cron/registry.ts: массив задач v2 (перенос
   функциональности старых 20 cron-эндпоинтов, см. audit.md раздел
   «API»):
   abandoned-cart, weekly-digest, expiring-bonuses, backup, cleanup,
   content-moderation, crm-integration, demand-forecasting,
   certification-reminders, escrow-auto-release (S4B3 auto-complete),
   franchisee-reports, holiday-reminders, payment-reminders,
   pp-certification-check, quality-inspections, review-analysis,
   sitemap-refresh, subscriptions, taster-assignment, user-reengagement.
   Каждая задача: {id, name, schedule (cron-выражение описание),
   enabled, fn(): Promise<CronRunStats>} — fn переносится из старого
   кода соответствующего роута (логика истребована, адаптировать на
   Prisma; задача НЕ делает HTTP-самовызов — прямой вызов функции).
3. Исполнитель: POST /api/cron/run/[taskId] (секрет-гейт) —
   идемпотентный запуск: if running → 409; запись CronRun running →
   fn → success/failed; ручной запуск с admin-сессии без секрета —
   разрешён (только manual).
4. История: GET /api/cron/status (секрет или admin) — последние
   запуски всех задач; UI /admin/automation (S5B3 связывает):
   таблица задач (расписание, статус, последний запуск, длительность)
   + кнопка «Запустить» (manual).
5. Расписание: В v2 исполняет ВНЕШНИЙ планировщик (n8n — S8B2 или
   системный crontab хоста — решается в S9B1). Внутри Next — только
   ручной/вебхук-запуск. Задокументировать карту «задача → cron-
   выражение» в docs/AUTOMATION.md v2.
6. Безопасность данных задач: каждая задача в try/catch, ошибка — в
   errorMessage (truncate 500), НИКОГДА не тянет процесс вниз.

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- Логика 20 роутов src/app/api/cron/*/route.ts (переносить
  функционально, разбивая на lib-функции);
- verifyCronSecret паттерн (src/lib/cron-auth.ts);
- урок: 7 задач не были покрыты workflow-JSON — теперь все 20 в
  одном реестре, покрытие 100%.

## 6. ЗАПРЕТЫ
- Запуск задач по GET без секрета — запрещён.
- Прямые SQL-вызовы мимо Prisma в задачах — запрещены.
- Не переносить n8n-HTTP-самовызовы (старый анти-паттерн).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] Реестр содержит все 20 задач с расписаниями и enabled-флагами;
- [ ] Запуск без секрета → 401; с секретом → success + CronRun
      запись; повтор во время running → 409;
- [ ] /admin/automation показывает историю и позволяет manual-run;
- [ ] docs/AUTOMATION.md: карта расписаний; tsc 0; lint 0; коммит
      [S8B1]; worklog.

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl: 401 → run с секретом 2 задач (cleanup, sitemap-refresh) →
  история; agent-browser: /admin/automation, manual-run кнопка.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S8B1]; docs/AUTOMATION.md; worklog.
- Отчёт: таблица задач/расписаний, как запускать вручную.
