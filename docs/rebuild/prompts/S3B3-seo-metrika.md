# ПРОМПТ S3B3 — SEO, Яндекс.Метрика, PWA

Этап 3 «Публичный сайт» | Блок 3. Зависимости: S3B1.
> Скопируйте текст ниже целиком в нового агента.

---

## 1. РОЛЬ
Ты — frontend-инженер по видимости и аналитике. Ты переносишь в v2
SEO-фундамент, Яндекс.Метрику (client + server) и PWA-минимум.

## 2. СТЕК И НЕИЗМЕНЯЕМЫЕ ПРАВИЛА
- Next.js 16 (App Router) + TypeScript strict; bun (:3000, lint, tsc).
- Tailwind CSS 4 + shadcn/ui; без indigo/blue.
- Данные: только Prisma. Backend: только Route Handlers; safe-fetch
  (S2B3) для всех исходящих; секреты через env; не печатать .env*.
- Процесс: коммит `[S3B3] ...`; tsc→vitest→agent-browser; worklog.md.
- Запреты: прод/секреты; старый проект — только чтение.

## 3. ЦЕЛЬ БЛОКА
generateMetadata/sitemap/robots, подключение Метрики с env-гейтом
(локально выключена), server-side цели, PWA-манифест единственный.

## 4. ШАГИ
1. SEO: generateMetadata для всех 8 маршрутов (title/description/
   openGraph); sitemap.ts (статические + товары/кондитеры из Prisma);
   robots.ts (dev: disallow all — по NEXT_PUBLIC_APP_URL эвристике,
   prod: allow); canonical URL из NEXT_PUBLIC_APP_URL.
2. Яндекс.Метрика (перенести src/lib/yandex-metrika.ts из старого):
   - client: скрипт инжектится ТОЛЬКО при заданном
     NEXT_PUBLIC_YANDEX_METRIKA_ID (layout.tsx, strategy afterInteractive)
     — локально ключа нет → не грузится (осознанно: не загрязнять
     счётчик 111432662);
   - цели: add_to_cart, order_completed, user_registered,
     lead_submitted, ticket_created, search_performed,
     confectioner_profile_view (публичные функции-хелперы);
   - ecommerce dataLayer: trackCart, trackOrder, trackProductDetail;
   - SPA-хиты: trackPageView на смене маршрута (App Router: в
     клиентском провайдере на usePathname);
   - server-side: trackEventServer через Management API + OAuth-токен
     (env YANDEX_METRIKA_OAUTH_TOKEN), fail-open с debug-логом;
   - вызовы server-целей: заказ оплачен (S4B2 подпишется), регистрация,
     возврат средств.
3. PWA: ОДИН манифест app/manifest.webmanifest (имя CONDITERA, иконки
   192/512, theme-color малиновый); meta-теги в layout; свercе-воркер —
   НЕ подключать (решение: без офлайн-режима в MVP).
4. Метрика-гейт в /styleguide: показать статус «включена/выключена» и
   counter ID (без токена) для диагностики.
5. robots/sitemap проверить формат (валидный XML, канонические URL).

## 5. ЧТО ВЗЯТЬ ИЗ СТАРОГО ПРОЕКТА
- src/lib/yandex-metrika.ts — целиком (функции, дефолт 111432662,
  server-side Management API-контракт), адаптировав под safe-fetch;
- layout.tsx:107-120 — паттерн инжекта скрипта с env-гейтом.

## 6. ЗАПРЕТЫ
- НЕ задавать NEXT_PUBLIC_YANDEX_METRIKA_ID в .env локальной машины
  (dev-трафик не должен попадать в боевой счётчик).
- Не подключать второй аналитический сервис.
- Не логировать OAuth-токен.

## 7. КРИТАРИИ ПРИЁМКИ
- [ ] sitemap.xml и robots.txt отвечают валидно;
- [ ] Метрика: локально скрипта нет в HTML (проверка grep mc.yandex в
      fetch /), при подстановке тестового env-ID — появляется;
- [ ] trackPageView вызывается при смене маршрута (доказать в коде);
- [ ] manifest единственный, валидный;
- [ ] tsc 0, lint 0; коммит [S3B3]; worklog.

## 8. ВЕРИФИКАЦИЯ (agent-browser + curl)
- curl /sitemap.xml, /robots.txt; curl / | grep -c mc.yandex → 0
  (локально без ключа);
- agent-browser: навигация по 3 страницам → в Network нет запросов к
  mc.yandex (локально), консоль чистая.

## 9. АРТЕФАКТЫ И ОТЧЁТ
- Коммит [S3B3]; worklog (список целей Метрики, env-ключи).
- Отчёт: как включить Метрику на проде (env), что проверит владелец.
