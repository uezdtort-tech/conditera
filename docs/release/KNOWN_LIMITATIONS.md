# KNOWN_LIMITATIONS — известные ограничения (обновлено Z-v21)

**Дата:** 2026-11-10. Разделение: проверено / не проверено / заблокировано / требует владельца / исключено.

## 1. Среда разработки (не дефекты продукта)

1. **Production build невыполним в песочнице**: cgroup ~3.9 GB RAM; kernel OOM-killer убивает `next build` (turbopack и webpack) при ~2 GB RSS. Доказательство: `dmesg` (oom-kill next-build). Build-гейт — первый фактический прогон будет в GitHub Actions (7 GB runners). TypeScript (0 ошибок) и runtime проверены.
2. **Полный Playwright-прогон** (244 спеки) в этой сессии не выполнялся (RAM). Ключевые пути покрыты agent-browser + verify-скриптами; полный прогон — на staging.
3. **Выходной канал сессии вырезает литерал `[m`** — любые наблюдения через cat/sed/rg, содержащие `[m` (например YAML flow-массивы `[main]`), искажаются. Метод защиты: guard-замена `[` или `od -c`. Из-за этого в Z-v21 первоначально была ложная тревога о «порче branch-фильтров CI» — файлы целы (подтверждено `od` + YAML-парс).

## 2. Интеграции — статус

| Интеграция | Статус | Комментарий |
|---|---|---|
| GitHub Actions | NOT RUN | 229 коммитов не опубликованы; workflows валидны локально |
| Yandex OAuth | BLOCKED (креды) | цепочка реализована, fail-closed 501 без кредов; `mode=check` честен |
| VK ID | исключён de-facto | не реализован на main (501); тост честный; решение владельца A/B |
| YooKassa | код PASS, sandbox BLOCKED | sandbox-цикл требует тестового магазина |
| n8n | NOT VERIFIED | только stub-receiver; движок не запущен; escalation/critical events не эмитятся |
| Email | деградация без SMTP | письма не отправляются, помечаются failed (честно) |
| SMS | выключено по умолчанию | SMS.ru, без API_ID — только консоль |
| Telegram | graceful skip | без токена — warn + false, не бросает; at-least-once для инцидентов |
| Storage | локальный диск + shim | signed URLs отсутствуют (per-request ACL); orphan-GC нет |

## 3. Продуктовые ограничения

1. **Backup покрывает 33 критичные таблицы** из 248 (справочники восстанавливаются миграциями+сидами). RESTORE-VERIFY: PASSED по ключевым таблицам.
2. **Миграции forward-only** — откат кода на старый SHA возможен только при additive-миграциях (правило ревью).
3. **Avatar/portfolio uploads доверяют клиентскому MIME** (без magic-byte сниффа; ограничения размера есть). Порядок: низкий риск (private buckets), фикс — в backlog.
4. **Orphan-файлов GC на диске нет** (DB-строки чистятся, файлы pending/ остаются).
5. **Email/SMS без retry/dedup** (одна попытка, результат журналируется); уведомления (внутренние) имеют dedupKey + дневной кап.
6. **Health n8n-проба fail-open**: «ok» = любой HTTP-ответ на базе; не проверяет /healthz и workflows.
7. **Двойные реализации**: n8n vs pg_cron/scheduled_jobs (coexist); Telegram webhook Next vs Deno (Deno — legacy, не деплоить); yookassa-webhook Deno — дрейф-риск (verify_jwt=false).
8. **`/checkout` отдаёт `robots: index`** — противоречие с robots.txt Disallow (приоритет у robots.txt; косметика).
9. **Параллельная автоматизация**: `use-automation.ts` дублирует n8n-функциональность — зафиксировано, не расширять.

## 4. Безопасность — открытое

- `cms/media` role-gate + MIME-снифф — закрыто в Z-v21 (01886c1).
- Основные провеки: CSRF, анти-брутфорс 2FA, timing-safe секреты webhook, RLS-изоляция orders — PASS (эта сессия).
- Полный внешний пентест не проводился (вне скоупа).

## 5. Исключено из текущего релизного объёма (де-факто)

- VK ID (до решения владельца), реальные SMS-рассылки, внешний пентест, полная матрица браузеров Firefox/WebKit (зафиксировано в e2e.yml TODO).
