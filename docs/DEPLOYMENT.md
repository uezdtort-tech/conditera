# DEPLOYMENT — реальная процедура публикации и отката

## Два способа развёртывания

1. **Платформа space-z (фактический хостинг)** — собственный пайплайн платформы:
   `.zscripts/build.sh` → `next build` (OOM-кап 2560MB) → packaging →
   `start.sh` (space-proof: порт/раскладка/edge best-effort). Из репозитория
   требуется только `git push` в ветку, из которой платформа собирает.
2. **Собственный VPS через Docker** — workflow `.github/workflows/deploy.yml`
   (только ручной запуск `workflow_dispatch`). Описан ниже.

## Разовая подготовка VPS

1. Сервер: Docker 24+, docker compose v2, каталог `/opt/conditera` с репозиторием
   (для compose-файлов) и `.env.production` (создаётся ВРУЧНУЮ один раз —
   workflow больше не генерирует env и не печатает секреты).
2. GitHub secrets: `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY`,
   `REGISTRY_TOKEN` (PAT read:packages — для docker login на сервере),
   `POSTGRES_PASSWORD`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `NEXT_PUBLIC_APP_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`.
3. GitHub environment `production` с required reviewers — добавит окно одобрения
   перед SSH-шагом.
4. Сеть compose называется `conditera-net` (проверьте в docker-compose.yml —
   migrator подключается именно к ней).

## Публикация (каждый релиз)

1. Убедитесь, что CI на целевом коммите зелёный.
2. Actions → **Deploy to Production** → Run workflow → (метка версии опционально).
3. Workflow: соберёт runner+ migrator образы с тегом `sha-xxxxxxx` (immutable) →
   применит миграции one-shot контейнером из того же SHA → поднимет `web`
   на этом теге → дождётся `/api/health` (retry 10×10с) → проверит публичный
   health → уведомит в Telegram.
4. Проверьте руками: `GET /api/health` → поле `version` = ожидаемый SHA.

### Идемпотентность миграций

`01-apply-migrations.sh` ведёт журнал `public.schema_migrations(filename)`.
Каждый файл применяется РОВНО ОДИН РАЗ, каждый в транзакции с `ON_ERROR_STOP=1`.
Упавший файл останавливает деплой с понятной ошибкой (fail-fast), повторный
запуск продолжает с места падения. Seeds применяются только при первичной
инициализации (пустой БД).

### База-лайн существующей БД (если миграции применялись вручную до ledger)

```sql
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- Заполнить именами фактически применённых файлов:
INSERT INTO public.schema_migrations(filename)
SELECT f FROM (
  VALUES ('0001_init.sql'), ('0002_marketplace.sql') /* ...полный список */
) AS v(f)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='profiles');
```
Если не сделать baseline — migrator честно упадёт на первом неидемпотентном
объекте 0001/0002 (POLICY/INDEX уже существуют). Это намеренная защита.

## Откат

1. Узнать предыдущий тег: `docker image ls ghcr.io/<repo>` (sha-теги не prune'ятся)
   или в реестре ghcr.io.
2. `WEB_IMAGE=ghcr.io/<repo>:sha-ПРЕДЫДУЩИЙ WEB_TAG=sha-ПРЕДЫДУЩИЙ docker compose up -d --no-deps web`
3. Миграции НЕ откатываются (проект ведёт только additive-миграции; в коде
   сохранены fallback-ветки на отсутствие свежих RPC). Восстановление данных —
   из бэкапа по docs/RELEASE_CHECKLIST.md §1.

## Известные ограничения

- `appleboy/ssh-action` не верифицирует host key сервера (ограничение action).
  Строгая верификация: self-hosted runner на VPS либо ручной SSH по инструкции
  выше. `StrictHostKeyChecking=no` из старого workflow устранён вместе с шагом
  raw-ssh.
- Runner-стадия Dockerfile ставит зависимости через `npm install` (bun.lock
  на node-образе не читается npm) — воспроизводимость сборки образа ниже,
  чем у bun. Переход на oven/bun-базу — в roadmap.
- Healthcheck до применения миграций не проверяет схему БД — только
  конфигурацию и живость процесса.
