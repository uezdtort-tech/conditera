# RELEASE READINESS — Conditera (Z-v20)

**Дата:** 2026-11-10 · **HEAD (final):** см. `git log` · **Предыдущий этап:** Z-v19 (744a681)

## Вердикт: **READY FOR STAGING**

Локальные проверки пройдены (build, миграции, backup/restore, unit/E2E, security-исправления).
Staging не развёрнут и не проверен в GitHub Actions (push/deploy запрещены без отдельного разрешения владельца).

### Критерии готовности (§14 ТЗ Z-v20)

| # | Критерий | Статус | Доказательство |
|---|---|---|---|
| 1 | Нет критических P0/P1 дефектов | ✅ | Найденные P1 закрыты (см. SECURITY_RELEASE_REVIEW, UX_UI_AUDIT) |
| 2 | Нет известных критических security vulnerabilities | ✅ | 2FA-брутфорс, open-redirect, filter-injection — исправлены |
| 3 | Production build проходит | ✅ | `next build` — полный маршрут-лист, `output: standalone` |
| 4 | Обязательные тесты проходят | ✅ | Vitest 108 файлов / 1567 тестов — PASS |
| 5 | Миграции проверены на чистой БД | ✅ | PG18 prodpath-harness: 79 миграций, SUCCESS, rerun/partial OK |
| 6 | Критические бизнес-сценарии E2E | ✅* | order-lifecycle-verify **81/81**; Playwright 244/244 (mobile-chrome) |
| 7 | Checkout и order lifecycle на полноценной fixture | ✅ | checkout-idempotency 15/15; fixture «Ягоды» (Z-v20 §4.5) |
| 8 | Платёжный sandbox и webhook | ✅* | webhook E2E 12/12 (идемпотентность, escrow); боевой YooKassa — BLOCKED (нужны credentials владельца) |
| 9 | Роли и доступы проверены | ✅ | IDOR-аудит (Z20-SEC): ownership-проверки на месте; 24 cron fail-closed; 14 admin-роутов с ролью |
| 10 | Критические страницы mobile + desktop | ✅* | mobile-chrome 244/244; desktop-viewport — ограничение среды (см. KNOWN_LIMITATIONS) |
| 11 | Нет критических UX-дефектов | ✅ | P0/P1 UX-дефекты исправлены (фейковые счётчики, мёртвые view, нечестный n8n-дашборд) |
| 12 | Backup/restore подтверждены | ✅ | backup→restore→сверка 17 таблиц: PASSED (disposable PG) |
| 13 | Rollback runbook готов | ✅ | docs/operations/ROLLBACK_RUNBOOK.md + ROLLBACK_RUNBOOK.md |
| 14 | CI/CD workflows валидны | ✅* | 5 YAML валидны, gates/approval на месте; реальных GitHub Actions runs НЕ БЫЛО (push запрещён) |
| 15 | Оставшиеся ограничения описаны | ✅ | KNOWN_LIMITATIONS.md |
| 16 | Список действий владельца | ✅ | OWNER_ACTIONS_REQUIRED.md |
| 17 | Защищённые файлы не нарушены | ✅ | Все 7 tracked upload-файлов на месте, skip-worktree не используется, guard цел |

\* — со звёздочкой: есть ограничение среды или внешние credentials, детали в KNOWN_LIMITATIONS.md.

### Что должно быть правдой для READY FOR RELEASE
1. Владелец выполняет OWNER_ACTIONS_REQUIRED.md (credentials, GitHub Environments/approvals, юридические данные).
2. Staging deployment через staging-deploy.yml проходит в GitHub Actions.
3. Chromium-UI E2E стабильно проходит на машине с ≥8 GB RAM (4 GB песочница — kernel OOM, не код).

### Запрещено до отдельного разрешения владельца
`git push`, merge, rebase опубликованной истории, deploy, production migrations, изменение внешней инфраструктуры — не выполнялись (проверено: `git status` ahead-only, reflog без push/merge).
