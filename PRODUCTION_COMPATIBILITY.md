# PRODUCTION_COMPATIBILITY.md

Известные проблемы Production (conditera.ru) и требования совместимости кода. Обновлено: 2026-11-16 (обход production-watch 18:00 MSK + отчёты Pi).

## 1. Подтверждённое состояние Production

Источник: `logs/agent/production-watch.log` (read-only мониторинг 3 раза/день, только GET) + отчёты владельца/Pi.

| Проверка | Состояние 2026-11-16 |
|---|---|
| `conditera.ru/` | 200 (1.7–3.5 c) |
| `/api/health` | 200, `status=degraded`, `database=ok`, `auth=unreachable`, `n8n=unavailable` |
| 5 критичных API (`products`, `decor/products`, `services`, `builder/decor-shops`, `recipes/marketplace`) | **0 (таймаут 30с/0 байт), ретраи тоже** — как PI-2026-11-15 |
| TLS | валиден до 2027-02-12 (88 дней) |
| Контейнеры (по Pi) | conditera-web healthy; **Caddy unhealthy**; **supabase-rest unhealthy**; **supabase-auth starting** |
| JWT_SECRET | демонстрационное значение — **считается скомпрометированным**, ротация не завершена |

**Журнал:** `2026-11-16T15:09Z | FAIL | home=200 health=degraded db=ok auth=unreachable n8n=unavailable apis=0,0,0,0,0 tls=88`.

## 2. Два инфраструктурных блокера (чинит Pi, не разработчик)

1. **PostgREST → supabase-db**: ошибка подключения (`invalid URI query parameter: "search_path"`, HTTP 503) — требуется роль/БД `supabase` либо корректный `PGRST_DB_URI`.
2. **Caddy → Envoy/Supabase**: сетевые таймауты (HTTP 000) при общей Docker-сети — причина молчания 5 API и регистрации.

План восстановления: ① PostgREST→DB; ② Caddy↔Supabase; ③ задеплоить `cb42589+` (fallback регистрации); ④ (по отдельному разрешению) завершить ротацию JWT по `JWT_SECRET_ROTATION_PLAN.md`; ⑤ проверить 5 API, вход/регистрацию, RLS/`auth.uid()`.

## 3. Совместимость кода с текущей Production-архитектурой

Что код ожидает от окружения (и что ломается при текущем состоянии прода):

- **`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`**: `supabaseAdmin` используется в большинстве route-файлов; при недоступности PostgREST все data-API зависают/503. Fail-closed: `src/lib/auth.ts` `getRequiredEnv` — без секретов в prod приложение не стартует.
- **GoTrue (`/auth/v1`)**: регистрация на проде (старый код) fail-closed 500 при `auth=unreachable` — прямо отражено в `/api/health` (`details: "production registration is fail-closed (500) until the auth provider is reachable"`). Локальный фикс cb42589 (fallback stub) это устраняет после деплоя.
- **`JWT_SECRET`/`JWT_REFRESH_SECRET`**: HS256-подписи; смена секрета инвалидирует все выданные сессии (7d access/30d refresh) — ротация требует пере-входа пользователей.
- **Ролевой гвард uploads, CSRF, CSP** в `proxy.ts` — работают независимо от состояния Supabase.
- **YooKassa**: `YOOKASSA_SHOP_ID/SECRET` не настроены на проде (health: `Missing`) — реальная оплата не активна; webhook защищён IP-allowlist + сверкой с провайдером, mock fail-closed в prod.
- **`n8n`**: `unavailable` — известное ограничение, не блокирует остальное.
- **Dev-fallback** (`src/lib/dev-auth.ts`): в prod отключён по `NODE_ENV` и наличию SERVICE_ROLE — иллюзии пользователя при отказе Auth не создаёт. Регистрация/вход при недоступном Auth дают явные ошибки, фиктивные сессии не выдаются.

## 4. Запреты на период инцидента (задание владельца §1.4)

Без отдельного разрешения владельца НЕ: ротировать JWT_SECRET/ANON/SERVICE_ROLE; менять версии Supabase; удалять volumes / `docker compose down -v`; менять схему БД и RLS; менять архитектуру двух БД; отключать JWT/RLS/TLS verification; вмешиваться в Production-инфраструктуру; push/deploy.

## 5. Критерии восстановления Production (для мониторинга)

Производственный обход считается OK, когда: 5/5 критичных API отвечают 2xx; `auth` ≠ unreachable (или registrация восстановлена через cb42589); главная 200. Мониторинг: `logs/agent/production-watch.log`, cron-агент production-watch (0/12/18 MSK).
