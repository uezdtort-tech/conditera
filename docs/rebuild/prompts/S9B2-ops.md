# ПРОМПТ S9B2 — Мониторинг, бэкапы, восстанавливаемость

Этап 9 «Эксплуатация» | Блок 2. Зависимости: S9B1 (конвейер).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — SRE-инженер. Эксплуатационный контур v2: мониторинг, бэкапы,
рецепты восстановления (урок D13: песочница/сервер может терять данные
— восстановление обязано быть scripted).

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 + TS strict; bun; health-эндпоинт (S1B1) — база.
- Секреты через env; не печатать .env*; журнал append-only.
- Процесс: коммит `[S9B2] ...`; worklog.md.
- Запреты: прод-действия без поручения владельца; запуск деструктивных
  cleanup безdry-run.

## 3. ЦЕЛЬ БЛОКА
Мониторинг-контур (health-матрица + внешний watch), автоматические
бэкапы с проверкой восстановления, runtime-рецепты (recycle-safe),
журнал дежурства.

## 4. ШАГИ
1. Health-матрица v2 (расширить S1B1): зависимости database, chat-
   service (:3030/health), n8n-receiver (:5678/healthz), cron (последний
   успешный запуск каждой задачи из CronRun), env-ключи (configured/
   missing, значения НЕ раскрываются), version, uptime. Когерентность
   HTTP↔body (503↔degraded) — как в S1B1.
2. Внешний watch: scripts/watch/runtime-watch.sh — цикл (cron на хосте
   или планировщик владельца): health → classify OK/WARN/FAIL →
   append-only лог logs/agent/runtime-watch.log; FAIL → попытка
   самолечения (restart контейнеров compose; НИКАКИХ SQL) →
   перепроверка → запись. Паттерн перенести из старого проекта
   (журнал-протокол патруля, 2026-11 серия).
3. Бэкапы: scripts/ops/backup.sh — pg_dump → /backups/conditera-YYYY-
   MM-DD-HH.sql.gz, ротация (хранить 14 дневных + 4 недельных),
   sha256-манифест; cron-задача daily (в реестре S8B1 задача backup
   вызывает этот скрипт).
4. Восстановление: scripts/ops/restore.sh /backups/file.sql.gz —
   остановка app → restore → verify-ledger → health-check → старт;
   ОБЯЗАТЕЛЬНАЯ проверка-восстановление на стенде (создать тестовый
   бэкап, восстановить, сравнить counts таблиц) — протокол в
   docs/OPS_RECOVERY.md.
5. Runtime-рецепты (из песочницы старого проекта):
   - pgdata потерян → node scripts/db/runtime.mjs start → setup.mjs
     (или restore.sh на проде) → health;
   - процесс Next умер → compose restart app / dev-keeper (dev);
   - чат/receiver умер → restart сервиса; — все рецепты scripted в
     scripts/ops/recover.sh с dry-run и перепроверкой после каждого
     шага (уроки 4-х патрулей старого проекта).
6. Журнал дежурства: logs/agent/ — append-only, формат строки
   `ISO | OK|WARN|FAIL | checks | actions` (в точности как в старом
   runtime-watch.log — протокол показал себя).
7. Алерты владельцу (MVP): при FAIL watch пишет в Telegram (env
   TELEGRAM_BOT_TOKEN, chat_id) — сообщение ≤200 симв, fail-open
   (нет токена → только лог).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- scripts/db/runtime.mjs — runtime-рецепты;
- паттерн runtime-watch.log (4 патруля, протокол проверен);
- production-watch паттерн (5 API-проб, TLS-классификация) — для
  скрипта scripts/watch/production-watch.sh (read-only, на проде
  выполняет владелец).

## 6. ЗАПРЕТЫ
- Деструктивные cleanup-задачи без dry-run флага — запрещены.
- Печать секретов в health/watch-логах — запрещена.
- Перезаписывать runtime-watch.log (только append).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] Health-матрица показывает все зависимости и env-статусы;
- [ ] backup.sh создаёт архив + манифест; restore.sh на стенде
      восстанавливает с проверкой counts и ledger;
- [ ] recover.sh проходит сценарии «pgdata потерян», «app умер» на
      стенде (протокол в docs/OPS_RECOVERY.md);
- [ ] watch-скрипт пишет журнал в формате старого протокола;
- [ ] Telegram-алерт (или явный skip без токена); tsc 0; lint 0;
      коммит [S9B2]; worklog.

## 8. ВЕРИФИКАЦИЯ
- Стенд: сломать app-контейнер → watch самолечит → журнал;
- restore-тест на свежем бэкапе; grep-проверка логов на отсутствие
  секретов.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S9B2]; scripts/ops/*, scripts/watch/*, docs/OPS_RECOVERY.md;
  worklog.
- Отчёт: как мониторится/бэкапится/восстанавливается v2; что
  выполняет владелец на проде (watch-планировщик, Telegram-токен).
