# INCIDENT_MANAGEMENT — единый реестр инцидентов (DEPLOY-01 §4)

**DEPLOY-01 EXTENDED (§4) · Дата: 2026-11-10**
Исходники: `src/lib/diagnostics/incidents.ts`, `src/lib/diagnostics/event-store.ts` (`upsertIncident`, `classifyPriority`, `notifyCriticalIncidentDeduped`), `src/app/api/admin/diagnostics/{incidents,events,metrics}/route.ts`, `src/components/dashboard/admin-incidents-tab.tsx`, `supabase/migrations/0079_diagnostics_incidents.sql`.

Инцидент = агрегат повторяющихся ошибок по `fingerprint` (см. ERROR_TRACKING.md §3.1). Таблицы: `public.app_incidents` (реестр), `public.app_incident_history` (журнал переходов), `public.app_error_events` (сырые события).

---

## 4.1 Агрегация и рецидивы (`upsertIncident`, event-store.ts:383)

Вызывается на **каждое** диагностическое событие (включая rate-limited дропы raw-записей — агрегация важнее):

```sql
INSERT INTO app_incidents (fingerprint, title, component, priority, severity, …, status)
VALUES (…, 'NEW')
ON CONFLICT (fingerprint) DO UPDATE SET
  occurrence_count = app_incidents.occurrence_count + 1,
  last_seen_at = EXCLUDED.last_seen_at, last_version = EXCLUDED.last_version,
  last_route = EXCLUDED.last_route,
  status = CASE WHEN app_incidents.status IN ('CLOSED','VERIFIED') THEN 'REOPENED'
                ELSE app_incidents.status END,
  updated_at = now();
```

Т.е. повтор ошибки после закрытия/верификации автоматически **реоткрывает** инцидент (REOPENED), счётчик повторов и версии (`first_version`/`last_version` из `APP_VERSION`) обновляются.

## 4.2 Статусная машина (§4)

Статусы: `NEW → TRIAGED → IN_PROGRESS → FIXED → VERIFIED → CLOSED`, плюс `REOPENED` (авто-рецидив) и `IGNORED` (с обязательной причиной, автором, временем). Разрешённые переходы (`TRANSITIONS`, incidents.ts:28) валидируются **сервером** (`canTransition`; нарушение → `IncidentStateError` HTTP 409):

| Из → В | Допустимые статусы |
|---|---|
| `NEW` | TRIAGED, IN_PROGRESS, IGNORED, CLOSED |
| `TRIAGED` | IN_PROGRESS, IGNORED, CLOSED |
| `IN_PROGRESS` | FIXED, IGNORED, CLOSED |
| `FIXED` | VERIFIED, CLOSED |
| `VERIFIED` | CLOSED, REOPENED |
| `CLOSED` | REOPENED |
| `REOPENED` | TRIAGED, IN_PROGRESS, FIXED, IGNORED, CLOSED |
| `IGNORED` | REOPENED |

При переходе в FIXED/VERIFIED/CLOSED фиксируются `resolved_at` + `resolved_version` (текущий `APP_VERSION`); в FIXED можно передать `fix_commit` (≤40 симв.); IGNORED **требует** `ignoreReason` (иначе 400), сохраняются `ignore_reason` + `ignore_actor_id`. Каждый переход пишется в `app_incident_history` (from→to, actor, note ≤500 симв.).

## 4.3 Приоритеты P0–P3 — автоматическая классификация

`classifyPriority(component, severity)` (event-store.ts:362) — **подсказка, не истина**:

| severity | component | Приоритет |
|---|---|---|
| critical | payments, database, infrastructure | **P0** (деньги/изоляция/доступность) |
| critical | остальные | **P1** |
| error | payments, auth, orders | **P1** |
| error | остальные | **P2** |
| warning | любые | **P2** |
| debug / info | любые | **P3** |

Приоритет хранится в `app_incidents.priority` (CHECK P0–P3). Отдельного API-эндпоинта смены приоритета в коде нет — корректировка возможна только прямым UPDATE с правами admin (RLS `app_incidents_update_admin`, 0079) либо через переходы статусов.

## 4.4 Уведомления P0/P1 с дедупликацией

`notifyCriticalIncidentDeduped` (event-store.ts:439):

1. Если `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHANNEL_ID` не настроены — **честный** `console.warn` с троттлингом не чаще 1 раза в 60с на процесс; уведомление НЕ отправляется и не имитируется (→ решение владельца D-EXT-4).
2. **Claim окна**: атомарный `UPDATE app_incidents SET notified_at = now() WHERE fingerprint = $1 AND (notified_at IS NULL OR notified_at < now() - interval '30 minutes') RETURNING …` — защита от гонок воркеров; окно `NOTIFICATION_COOLDOWN_MS = 30 мин`. Если claim не вернул строку — недавно уже уведомляли, повтор молча агрегируется в `occurrence_count`.
3. Отправка `notifyChannel({type:"error", title:"🚨 [P0] payments", body: message | route | env | ver})` через существующий Telegram-канал.
4. **At-least-once**: сбой отправки возвращает окно (`notified_at = NULL`) — следующий повтор инцидента повторит попытку. Пропущенный P0 дороже повторной телеграммы.

## 4.5 API-эндпоинты (админ, §4.2)

Все эндпоинты `runtime = "nodejs"`, `dynamic = "force-dynamic"`; доступ: `getUserFromRequest(request)` → 401, затем `requireAnyRole(userId, ["ADMIN","SUPER_ADMIN"])` (role-guards, через service-role) → 403. Клиентские проверки (скрытие кнопки/роль в токене) механизмом безопасности НЕ являются.

| Метод/путь | Назначение |
|---|---|
| `GET /api/admin/diagnostics/incidents` | список: фильтры `status` (валидация 400), `priority` (P0–P3), `component`, поиск `q` по id/fingerprint/title, `limit` (1–200, default 50), `offset`; сортировка по `last_seen_at DESC` |
| `GET …/incidents?summary=1` | сводка: `byStatus`, `byPriority`, `openTotal` (NEW+TRIAGED+IN_PROGRESS+REOPENED), `last24h` |
| `GET …/incidents?incidentId=<uuid>` | история переходов (последние 100), `actor_name` через JOIN profiles |
| `PATCH …/incidents` | переход: `{incidentId, toStatus, note?, fixCommit?, ignoreReason?}`; серверная валидация перехода (409), REQUIREMENT ignoreReason для IGNORED (400); 404 если инцидента нет |
| `GET /api/admin/diagnostics/events?fingerprint=…` | сырые события по fingerprint (`limit` 1–200); только уже маскированные поля |
| `GET /api/admin/diagnostics/metrics` | снимок метрик (см. MONITORING.md §4); fail-open 503 с `partial:true` при сбое сбора |

## 4.6 RLS (0079) — defense-in-depth поверх серверных гейтов

- `app_error_events`, `app_incidents`, `app_incident_history`: SELECT только для `authenticated` с активной ролью `ADMIN|SUPER_ADMIN` в `user_roles`.
- `app_incidents`: UPDATE admin-only (смена статуса через админ-API).
- INSERT/DELETE-политик для клиентских ролей **нет** (fail-closed): сырые записи и upsert идут только сервером через pg-пул (service_role по назначению).
- Повторный прогон 0079 — no-op (IF NOT EXISTS / DO-гварды pg_policies).

## 4.7 Admin UI — таб «Инциденты» (`admin-incidents-tab.tsx`)

Компонент dashboard (`"use client"`, запросы через `csrfFetch`):
- сводные карточки (по статусам/приоритетам, openTotal, last24h);
- список с фильтрами status/priority/component и поиском по ID/fingerprint/title; бейджи приоритетов (P0 красный … P3 серый), `occurrence_count`, версии first/last, `last_seen_at` (formatDistanceToNow);
- кнопки переходов статусов (валидные варианты по статусной машине), для IGNORED — модалка обязательной причины, для FIXED — поле fix_commit; история переходов (кто/когда/откуда/куда + note);
- панель сырых событий выбранного инцидента (`events?fingerprint=…`) и панель метрик канала диагностики (очередь/circuit-breaker/дропы, события 1ч/24ч).

API проверяет права независимо от UI — скрытие вкладки не является контролем доступа.
