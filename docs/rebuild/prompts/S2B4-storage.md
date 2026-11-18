# ПРОМПТ S2B4 — Supabase Storage: файлы пользователей и исполнителей

Этап 2 «Auth/RBAC» | Блок 4. Зависимости: S2B1 (auth), S1B2 (схема,
модель files).
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — backend-инженер. По указанию владельца ВСЕ загруженные файлы
пользователей и исполнителей хранятся в Supabase Storage (аватары,
портфолио исполнителей, фото товаров, документы/сертификаты, вложения
чата). Ты закладываешь ЕДИНЫЙ upload-контур v2: бакеты, RLS-политики,
серверные роуты, гварды ролей — без «зоопарка» из 6+ upload-маршрутов
старого проекта.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui; без indigo/blue; Route Handlers only.
- Storage: Supabase Storage через server-клиент из S2B1; admin-операции
  (создание бакетов, upload от имени сервера) — service-role КЛИЕНТ,
  ключ НИКОГДА не попадает на клиент и в бандл.
- Безопасность: валидация ДО upload (mime по magic-bytes, размер,
  uuid-путь); RLS-политики обязательны на каждом бакете; приватные
  бакеты — только signed URLs; fail-closed.
- Локальный dev: STORAGE_MODE=local — disk-adapter (.uploads/, тот же
  контракт API) когда Supabase недоступен; в prod — STORAGE_MODE=
  supabase. Adapter включается ТОЛЬКО явным флагом.
- Процесс: коммит `[S2B4] ...`; tsc→vitest→agent-browser; worklog.md;
  тесты не писать.
- Запреты: прод/секреты; не печатать .env*; старый проект — только
  чтение.

## 3. ЦЕЛЬ БЛОКА
7 бакетов + RLS-политики + единый роут загрузки/удаления/выдачи ссылок
+ модель files в Prisma + UI-компонент загрузки — покрывающие
потребности v2: каталог S3, кабинеты S5, чаты S6, CMS.

## 4. ШАГИ
1. Реестр бакетов (идемпотентный скрипт scripts/storage-init.ts через
   service-role):
   - avatars — публичный; пишет только владелец (путь {userId}/*);
   - portfolios — публичный; {userId}/* — фото работ исполнителей
     (кондитеры, студии, поставщики, аниматоры…);
   - products — публичный; {userId}/{productId}/* — фото товаров;
   - recipes — публичный; {userId}/*;
   - documents — ПРИВАТНЫЙ (сертификаты, документы исполнителей);
     доступ: владелец + роли QUALITY_INSPECTOR / CERTIFICATION_AGENT /
     ADMIN через signed URLs (TTL 5 мин);
   - chat-attachments — ПРИВАТНЫЙ; доступ — участники беседы
     (проверка прав в роуте, использовать в S6B1);
   - cms — ПРИВАТНЫЙ; пишут роли с permission content.moderate.
2. RLS-политики storage.objects на каждый бакет: owner-write по
   префиксу {auth.uid()}/*; public-read для публичных; запрет листинга
   приватных. Политики зафиксировать в supabase/policies.sql (читаемый
   артефакт) и применить скриптом.
3. Лимиты и валидация src/lib/storage/limits.ts: изображения
   jpeg/png/webp ≤ 10 МБ; pdf ≤ 5 МБ; mp4 ≤ 50 МБ (только portfolios);
   mime по magic-bytes (не по расширению); путь объекта:
   {userId}/{yyyy}/{uuid}.{ext} — оригинальные имена в пути ЗАПРЕЩЕНЫ.
4. Prisma-модель files (миграция): id, bucket, path, ownerId, refType,
   refId?, size, mime, width?, height?, createdAt — метаданные каждого
   объекта (по ним работают чистки и права).
5. Серверные роуты (auth-гвард + CSRF):
   - POST /api/upload — multipart {bucket, file, refId?}: гвард роли
     по бакету (avatars — любой auth; portfolios/products/recipes —
     SUPPLIER_GROUP: CONFECTIONER, STUDIO, SUPPLIER, WHOLESALER;
     documents — исполнители; cms — content.moderate) → validate →
     upload → row files → вернуть {id, url|signedUrl};
   - DELETE /api/upload/:id — только владелец или ADMIN;
   - GET /api/files/:id/url — signed URL для приватных (проверка прав:
     владелец/роли/участие в беседе), TTL 5 мин;
   - rate-limit: 100 файлов/сутки/пользователь (модуль S2B3).
6. Disk-adapter (STORAGE_MODE=local): контракт put/get/delete/signedPath
   поверх .uploads/ (signedPath = роут-прокси с HMAC и TTL) —
   идентичный контракт с Supabase-режимом.
7. UI src/components/ui/file-upload.tsx: drop-зона + Dialog (shadcn),
   прогресс, превью изображений, удаление, понятные ошибки (413 «Файл
   больше 10 МБ», 415 «Формат не поддерживается»); демо-страница
   /dev/storage (только dev) для приёмки блока.
8. Cron-заготовка: POST /api/cron/storage-cleanup (за X-Cron-Secret):
   orphan-объекты (row files удалён ИЛИ refType/refId не заполнены
   более 30 дней) → удалить объект + row; реализация — здесь, включение
   в реестр cron — S8B1.
9. Ширина/высота изображений — в files (для стабильного layout без
   layout-shift).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/lib/upload-role-guard.ts + src/lib/upload-service.ts — матрицу
  «кто что может грузить» (сверить с реестром бакетов);
- src/lib/upload-config.ts — лимиты типов/размеров (актуализировать);
- src/lib/product-media/storage.ts — паттерн ссылок на медиа товаров;
- урок: в старом проекте upload-логика разрослась на 6+ маршрутов —
  в v2 ОДНА точка /api/upload.

## 6. ЗАПРЕТЫ
- Не выдавать service-role ключ на клиент; не строить URL с ключами.
- Не принимать оригинальные имена файлов в путь объекта.
- Не отдавать объекты приватных бакетов без signed URL и проверки прав.
- Не хранить файлы вне Storage в prod (disk-adapter — только dev).
- Не рендерить пользовательские изображения через next/image без
  ограничения доменов (next.config remotePatterns — только домен
  Supabase-проекта).

## 7. КРИТЕРИИ ПРИЁМКИ
- [ ] scripts/storage-init.ts создаёт 7 бакетов + политики (повторный
      запуск — no-op);
- [ ] POST /api/upload: аватар customer → 200; portfolio без
      SUPPLIER_GROUP → 403; exe с подменой mime → 415; >10 МБ → 413;
      без CSRF → 403;
- [ ] documents: чужой пользователь → signed URL не выдаётся (403);
      владелец и QUALITY_INSPECTOR — получают;
- [ ] row files пишется в Prisma; DELETE удаляет и объект, и row;
- [ ] STORAGE_MODE=local — curl-цикл идентичен Supabase-режиму;
- [ ] tsc 0, lint 0; коммит [S2B4]; worklog (бакеты, лимиты, контракт).

## 8. ВЕРИФИКАЦИЯ (curl + agent-browser)
- curl: login confectioner → upload portfolio (jpeg) → 200 → публичный
  URL открывается → DELETE → повторный GET → 404;
- curl: customer → попытка upload в products → 403;
- agent-browser: /dev/storage — загрузка через UI (превью, прогресс,
  ошибка oversized), удаление; mobile-вид.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S2B4]; supabase/policies.sql; scripts/storage-init.ts;
  worklog (бакеты, лимиты, контракт роутов).
- Отчёт владельцу: реестр бакетов, как загружаются файлы в dev и prod,
  что требуется от Supabase-проекта (ключи, лимиты проекта).
