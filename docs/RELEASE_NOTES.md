# RELEASE NOTES

## v2.0-rc2 — Z-v32/Z-v33 (2026-11-13)

Дата: 2026-11-13. Ветка: `main` (HEAD `9d58cbf` + release-документация цикла). Статус: RELEASE CANDIDATE — см. `docs/release/RELEASE_CANDIDATE.md` (вердикт OWNER ACTION REQUIRED: production build/конфигурация/push — владелец).

### Основные изменения Z-v32/Z-v33

- **История цен с версиями** (миграции 0083–0086): интервалы half-open `[from, to)` без пересечений (EXCLUDE + `btree_gist`), `set_product_price`/`get_product_price_at`, планирование будущих цен с превью, catch-up lazy-sync; привязка заказов к версии цены (`order_items.price_version_id` + снимок в `orders.metadata.pricing`); маркер «от», «Цена действует с DD.MM.YYYY», защита от фиктивных скидок в каталоге; админ-коррекция с правилом HISTORICAL_IMMUTABLE.
- **Сроки действия индивидуальных предложений** (0085 `negotiations.valid_until` + `confectioner_quotes.valid_until` + триггер-бэкстоп): accept-endpoint с 410 OFFER_EXPIRED, повторный accept → 409 OFFER_ALREADY_ACCEPTED, «один заказ на переговоры» → 409 OFFER_ALREADY_ORDERED (условная ссылка order_id), revisions сохраняются, срок в TZ Europe/Moscow; checkout-биндинг согласуется сервером (`metadata.offerBinding`) — подмена цены покупателем невозможна.
- **UI предложений для обеих ролей**: вкладка «Предложения» у покупателя (принятие/истечение/история/переход в checkout) и у кондитера (форма предложения, re-quote, бейджи статусов); фиксация цены в заказе переживает изменение цены товара; навигация cart-drawer/buyer-offers/cake-builder → checkout починена.
- **Security**: `/api/auth/session` + `/api/auth/refresh` отдают 403 ACCOUNT_BLOCKED и чистят cookie для заблокированных профилей; upload role-guard (`src/proxy.ts` + `src/lib/upload-role-guard.ts`): `/api/upload` — CONFECTIONER/ADMIN/SUPER_ADMIN + CUSTOMER (фото отзывов/тикетов), `/api/services/upload` — manager-only; live-пробы 401/403/201 подтверждены.
- **Удалены live-моки**: `/api/recipes/[id]/acceptances` больше не фабрикует кондитеров при пустом результате (честный пустой ответ), `/api/video-feed` больше не маскирует ошибку БД (503 вместо фейковых видео); публичный каталог — только живые строки БД (demo-hatch `NEXT_PUBLIC_DEMO_MODE` default OFF).
- **Seed-бэкфилл цен**: `scripts/db/setup.mjs` после сидов создаёт начальные строки `product_price_history` (идемпотентно, 12/12 товаров версированы) — локальный bootstrap и каталог не расходимся.
- **CMS-версии/конфликты**: регрессия draft→preview→publish→409 CMS_CONFLICT→rollback→banners→audit — ALL PASS (Z-v32 Пакет E-2 + ZV33-6 Part A).
- **Сканер секретов quick-режим** (ZV33-9b): gitignored-файлы (`.env*`) исключены из quick-скана — находки в них были структурными ложными позитивами (файл не может попасть в коммит); full-режим без изменений (0 findings / 1801 файлов).

### Метрики проверок (gate Z-v33, 2026-11-13)

- typecheck 0 ошибок (4.5s); ESLint 0 problems (46.3s); Vitest: **146 файлов / 1922 теста PASS, 0 skipped** (142.88s); route-error-coverage 47/48 (1 — script-documented exempt); secrets-scan full 0 findings / 1801 файлов; check:quick exit 0 (после ZV33-9b); redline 9/9; миграции 85 = 85 (ledger); PG-интеграция 39/39 (inventory 8/8, checkout-idempotency 15/15, diagnostics 16/16).
- Production build: **NOT RUN в песочнице** (3.9 GiB RAM/no swap, OOM-прецедент exit 137) — OWNER ACTION REQUIRED (`bun run build` на машине ≥8 GB RAM).

---

## release/readiness-fixes (v2.0-rc1)

Дата: 2026-09-29. Ветка: `release/readiness-fixes` (в main — через PR после ревью).

## Раунд независимой верификации (2026-09-30, агент-аудитор №2)

- **CI: починен Docker-job.** В Dockerfile остался мёртвый
  `COPY node_modules/xdg-basedir` (Prisma-эпоха, initial commit) — пакета нет
  в lockfile с момента перехода на bun, сборка web-образа падала
  (run 36777755363). Строка удалена; остальные COPY-пакеты сверены с node_modules.
- **Миграция 0039 валидирована рантаймом** на изолированной БД (PGlite):
  новый `scripts/verify-release-0039-pglite.ts` — 21/21 (RLS-политика,
  атомарное списание 2FA-кода, дедуп refund-вебхука по refund_id,
  атомарное суммирование, идемпотентность двойного прогона).
- **IDOR ai-dialogue покрыт негативными тестами** (7 кейсов: чужая пара,
  не-кондитер, несуществующий ID, fail-closed 500 при ошибке БД).
- **Состав 33 файлов заявленного push подтверждён** побайтово
  (78e4f66..51eba6b: 33 files, +1122/−400 — цифры совпали).
- **Скан секретов**: дифф и вся история чисты (токены никогда не коммитились;
  в worklog только маскированный префикс).
- **Новые документы**: docs/PRODUCTION_MIGRATION_PLAN.md (безопасное окно
  0034–0039: pre/post-проверки, стоп-условия, откат, частичное применение),
  docs/SAFE_GIT_WORKFLOW.md (протокол работы при автокоммитере-watcher,
  хронология инцидентов №1–№5).

## Безопасность

- **Журнал финопераций закрыт**: `confectioner_transactions` получил RLS
  (ранее читался любым анонимным пользователем через PostgREST).
- **Возвраты YooKassa стали идемпотентными**: дедуп по refund id +
  атомарное суммирование (раньше повторная доставка вебхука задваивала
  суммы частичных возвратов, а гейт идемпотентности вообще проглатывал
  refund-события).
- **2FA-защита выплат реально работает**: гейт выплат теперь читает живые
  колонки two_factor_* (прежде — пустые legacy), backup-коды списываются
  атомарным RPC, при отсутствии миграций — fail-closed (503), а не «пускать».
- **Логин по backup-коду**: закрыта гонка двух параллельных логинов с одним
  кодом (оба получали JWT).
- **Отмена заказов**: запрещена для заказов в составе выплаты и с
  выплаченным эскроу (раньше создавала «выплату за отменённый заказ»).
- **IDOR в AI-диалогах закрыт**: чужие AI-память/профиль/контекст недоступны.
- **CSRF+auth во всех AI-виджетах** (12 вызовов): оживлены cake-finder,
  visual-search, генераторы описаний/фото, AI-ассистенты.
- **deploy.yml переработан**: больше не печатает секреты в логи, не создаёт
  пустой .env.production, не отключает проверку SSH-ключа, применяет ВСЕ
  миграции через fail-fast ledger (раньше — 5 из 38 по неверному пути).

## Надёжность

- Мигратор с журналом `schema_migrations`: каждый файл ровно один раз,
  ошибка = остановка деплоя (раньше ошибки SQL молча пропускались).
- Компенсация резерва выплаты: CAS-защита от двойного возврата при гонке
  с админ-отклонением.
- Mock-платежи в production отклоняются (defense-in-depth поверх IP-allowlist).
- CI переведён на bun (Prisma-шаги удалены — пакет отсутствует в проекте).

## Продукт

- **Карточка товара без выдуманных данных**: убраны фейковые отзывы
  (pravatar-аватарки), захардкоженное распределение оценок, выдуманные сроки
  изготовления и синтетические бейджи. Показываются только реальные данные.
- Placeholder вместо сломанной картинки у товаров без фото.
- `/api/health` отдаёт версию образа (commit SHA) — база мониторинга раскатки.
- Устранён дубль PWA-манифеста.

## Инфраструктура

- Новый безопасный VPS-деплой: immutable SHA-теги, миграции из того же SHA,
  healthcheck с retry, откат на предыдущий тег (prune убран). Только ручной
  запуск — авто-деплой в main отключён.
- Документация: docs/RELEASE_CHECKLIST.md, docs/SECURITY_REVIEW.md,
  docs/DEPLOYMENT.md, docs/KNOWN_LIMITATIONS.md.

## Метрики проверок

- typecheck: 0 ошибок; ESLint: 0 errors; Vitest: 27 файлов / 744 теста PASS;
  production build: PASS (OOM-кап 2560MB).
