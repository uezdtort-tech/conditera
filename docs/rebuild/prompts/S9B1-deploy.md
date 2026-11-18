# ПРОМПТ S9B1 — Деплой-конвейер (Docker/bun, CI, релиз)

Этап 9 «Эксплуатация» | Блок 1. Зависимости: все предыдущие блоки.
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — DevOps-инженер. Деплой-конвейер v2 закрывает D7/D8 старого
проекта: прод отставал на ~300 коммитов из-за ручного деплоя, Docker
собирался npm'ом. Одна команда — один воспроизводимый релиз.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Артефакты деплоя: Dockerfile (база oven/bun:1), docker-compose
  (app + postgres + n8n + caddy/traefik по желанию владельца).
- Секреты: только env/.env на сервере; НЕ коммитить; не печатать.
- CI-гейт: tsc → lint → vitest → сборка → smoke.
- Процесс: коммит `[S9B1] ...`; worklog.md.
- Запреты: пушить/мержить/деплоить в боевой БЕЗ явного поручения
  владельца; хранить секреты в репо; multi-манифесты PWA (урок D13
  старого проекта — один manifest).

## 3. ЦЕЛЬ БЛОКА
Воспроизводимый конвейер: Dockerfile (bun), compose для VPS, GitHub
Actions CI, release-скрипт с обязательным бэкапом перед миграциями,
runbook первого деплоя.

## 4. ШАГИ
1. Dockerfile (multi-stage): FROM oven/bun:1 → bun install --frozen-
   lockfile → bunx prisma generate → next build → runtime-слой
   (bun, next start). Проверить: npm НЕ используется нигде (закрыть D8).
2. docker-compose.yml: postgres:16 (volume, healthcheck), app
   (depends_on healthy, env_file .env), n8n (volume, port 5678
   internal), reverse-proxy с TLS (caddy: автоматический
   Let's Encrypt — как у владельца сейчас); секреты только через
   .env на хосте.
3. Миграции на релизе: entrypoint app: prisma migrate deploy +
   scripts/verify-ledger.ts (S4B3) перед стартом; НЕДСТУПИМО
   автоприменение dev-команд.
4. CI (.github/workflows/ci.yml): на PR и main: bun install → tsc →
   lint → vitest → next build → docker build (смок). Артефакты
   образа — по тегу.
5. Release-скрипт scripts/release.sh (локально/сервер):
   - шаг 0: обязательный бэкап БД (pg_dump в /backups с датой) —
     отказ релиза без бэкапа;
   - pull образа → migrate deploy → health-check → переключение
     трафика → smoke (GET /api/health, 3 ключевых маршрута);
   - rollback-инструкция (предыдущий образ + restore бэкапа).
6. Переключение прод-домена: runbook docs/DEPLOY_RUNBOOK.md —
   пошагово: DNS/резерв, первый деплой на стенде, прогон E2E-чек-
   листа (золотые пути S3–S7), THEN переключение conditera.ru.
   Отдельная задача — миграция auth.users/бакетов Storage старого
   проекта в Supabase-проект v2 (Admin API экспорт→импорт, копирование
   объектов): ТОЛЬКО по явному поручению владельца.
   ВАЖНО: переключение домена — отдельное поручение владельца — в
   блоке только подготовить и отрепетировать на стенде.
7. Чек-лист parity со старым продом: список env-ключей (из
   .env.example) + внешние сервисы (YooKassa боевые — тест-контур
   first, домен Метрики, Telegram-бот, ПРОЕКТ SUPABASE: URL/anon/
   service-role/JWT-секрет, создание бакетов S2B4) — «что должен
   предоставить владелец».

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- docs/DEPLOYMENT.md, docs/DOCKER_DEPLOY.md — полезные шаги;
- уроки LIMIT 6–9: настоящая проверка хоста, bun-образ, migrator
  с валидацией схемы;
- worklog старого проекта — список внешних зависимостей прода.

## 6. ЗАПРЕТЫ
- Не деплоить на conditera.ru без явного поручения владельца.
- Не встраивать секреты в образы/compose.
- Не применять migrate на прод без бэкапа (скрипт отказывает).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] docker build проходит, образ стартует, health ok;
- [ ] compose поднимает стек локально (стенд) полностью;
- [ ] CI-гейт зелёный (по репо v2);
- [ ] release.sh отказывается работать без бэкапа; rollback описан;
- [ ] runbook + parity-чек-лист готовы; tsc 0; lint 0; коммит [S9B1];
      worklog.

## 8. ВЕРИФИКАЦИЯ
- Локальный прогон compose-стенда + release.sh в dry-run режиме;
- CI-лог (если GitHub доступен) или локальная имитация шагов.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S9B1]; Dockerfile/compose/CI/release.sh/runbook; worklog.
- Отчёт: как выглядит релиз одной командой; список данных, которые
  нужен от владельца для боевого переключения.
