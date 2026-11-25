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
5. В `.env.production` должны быть заполнены все обязательные production values:
   SMTP host/user/password/from, YooKassa live Shop ID/Secret Key, Yandex OAuth
   enabled + Client ID + точный callback, Supabase keys, отдельные JWT/TFA/CRON
   secrets и оба PostgreSQL URL. Примеры-заглушки из template не являются
   рабочими значениями; runtime guard остановит production server.
6. Перед выпуском на Linux host выполнить `bash scripts/env-check.sh production`.
   Ошибка preflight означает BLOCKED, не обходить её заглушками.
   
**Compose build args:** при ручной сборке всегда передавайте
`docker compose --env-file .env.production -f docker-compose.yml ...`.
Секция `env_file:` сервиса задаёт runtime environment контейнера, но не
переменные Compose interpolation для `build.args`. Production web image
компилирует `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` и
`NEXT_PUBLIC_APP_URL` в Next.js bundle; они должны совпадать с runtime env.

## Восстановление Kong 2.8 без перезапуска базы

Kong работает в DB-less режиме. Compose запускает
`scripts/supabase/kong-entrypoint.sh`, который подставляет реальные
`SUPABASE_ANON_KEY` и `SUPABASE_SERVICE_KEY` в шаблон
`supabase/kong.yml` перед запуском Kong. Сам Kong не подставляет env-переменные
в declarative YAML автоматически.

После выкладки исправленного кода и проверки резервных копий на сервере:

```bash
docker compose --env-file .env.production -f docker-compose.supabase.yml config -q
docker compose --env-file .env.production -f docker-compose.supabase.yml up -d --no-deps --force-recreate supabase-kong
docker logs --tail=100 conditera-supabase-kong
docker exec conditera-supabase-kong kong health
docker exec conditera-supabase-kong sh -c 'test -s /tmp/conditera-kong-rendered.yml && ! grep -Fq "\${SUPABASE_ANON_KEY}" /tmp/conditera-kong-rendered.yml && ! grep -Fq "\${SUPABASE_SERVICE_KEY}" /tmp/conditera-kong-rendered.yml'
curl -fsS http://127.0.0.1:8000/auth/v1/health
curl -fsS https://conditera.ru/api/auth/v1/health
```

Именно `--force-recreate` нужен, чтобы контейнер перестал использовать старые
переменные окружения (в том числе ошибочное значение `true`). Команда
`--no-deps` ограничивает операцию сервисом Kong и не переключает/не пересоздаёт
PostgreSQL volume. Не выполнять `docker compose down -v` и не запускать весь
Supabase stack до завершения отдельного PG15→PG17 backup/restore и cutover gate.

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
