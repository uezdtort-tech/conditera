/**
 * useSeoMetadata — клиентский хук для обновления <title>, meta description
 * и canonical URL в зависимости от текущего view SPA.
 *
 * Почему клиентский: приложение — SPA через Zustand store (один route /).
 * Серверный generateMetadata() не видит view, поэтому обновляем мета-теги
 * на лету в useEffect.
 *
 * Что делает хук:
 *  1. Устанавливает <title> (уникальный для каждой страницы)
 *  2. Устанавливает <meta name="description">
 *  3. Обновляет <link rel="canonical">
 *  4. Обновляет og:title, og:description, og:url
 *  5. На dashboard/* — добавляет noindex (приватные страницы)
 */
"use client";

import { useEffect } from "react";

export interface SeoMeta {
  title: string;
  description: string;
  /** Путь для canonical (например, "/catalog"). Если пусто — canonical не обновляется. */
  path?: string;
  /** Не индексировать (для dashboard, profile, checkout) */
  noindex?: boolean;
}

import { siteConfig } from "./site-config";

const APP_NAME = siteConfig.name;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Карта view → SEO-метаданные.
 *  Каждый view получает уникальный title (для Google) и описание. */
const VIEW_META: Record<string, SeoMeta> = {
  home: {
    title: `${APP_NAME} — маркетплейс кондитерских изделий от частных кондитеров`,
    description:
      "Заказывайте домашние торты и десерты напрямую у проверенных кондитеров России. Конструктор тортов, безопасные платежи с эскроу, доставка в ваш город.",
    path: "/",
  },
  catalog: {
    title: `Каталог тортов и десертов — ${APP_NAME}`,
    description:
      "Каталог домашних тортов, пирожных, макаронс, зефира и других кондитерских изделий от частных кондитеров России. Фильтры по цене, начинке, аллергенам.",
    path: "/catalog",
  },
  product: {
    title: `Карточка товара — ${APP_NAME}`,
    description: "Закажите кондитерское изделие напрямую у частного кондитера с безопасной оплатой через эскроу.",
    path: "/catalog",
  },
  confectioners: {
    title: `Кондитеры России — каталог мастеров — ${APP_NAME}`,
    description:
      "Каталог проверенных частных кондитеров России. Рейтинги, отзывы, портфолио, специализации. Выберите мастера для своего торта.",
    path: "/confectioners",
  },
  "confectioner-profile": {
    title: `Профиль кондитера — ${APP_NAME}`,
    description: "Профиль частного кондитера: портфолио, отзывы, тарифы, контактная информация.",
    path: "/confectioners",
  },
  promotions: {
    title: `Акции и скидки на торты — ${APP_NAME}`,
    description: "Акции, промокоды и скидки от кондитеров России. Выгодные предложения на торты и десерты.",
    path: "/promotions",
  },
  recipes: {
    title: `Рецепты тортов и десертов — ${APP_NAME}`,
    description: "Бесплатные и платные рецепты тортов, пирожных, печенья. Пошаговые инструкции, КБЖУ, советы от кондитеров.",
    path: "/recipes",
  },
  "recipe-detail": {
    title: `Рецепт — ${APP_NAME}`,
    description: "Пошаговый рецепт кондитерского изделия с фото и КБЖУ.",
    path: "/recipes",
  },
  "ready-made": {
    title: `Готовая продукция к доставке — ${APP_NAME}`,
    description: "Торты и десерты, готовые к отправке сегодня. Доставка по России.",
    path: "/ready-made",
  },
  "corporate-events": {
    title: `Корпоративные мероприятия — ${APP_NAME}`,
    description: "Торты и фуршетные десерты для корпоративов, конференций, юбилеев. Безналичная оплата, договор, НДС.",
    path: "/corporate-events",
  },
  "decor-shop": {
    title: `Декор для тортов — магазин — ${APP_NAME}`,
    description: "Кондитерский декор: фигурки, цветы, топперы, упаковка, сахарная бумага. От студий декора России.",
    path: "/decor-shop",
  },
  "services-shop": {
    title: `Кондитерские услуги — ${APP_NAME}`,
    description: "Аренда форм, дегустации, мастер-классы, доставка, упаковка — услуги от кондитеров и партнёров.",
    path: "/services-shop",
  },
  "venues": {
    title: `Площадки для праздников — ${APP_NAME}`,
    description: "Лофты, банкетные залы, детские студии и веранды для дня рождения и корпоратива. Бронирование площадок на платформе.",
    path: "/venues",
  },
  "supplier-shop": {
    title: `Поставщики ингредиентов и оборудования — ${APP_NAME}`,
    description: "Оптовые и розничные поставки муки, сахара, масла, шоколада, оборудования для кондитеров.",
    path: "/supplier-shop",
  },
  "gift-certificates": {
    title: `Подарочные сертификаты — ${APP_NAME}`,
    description: "Подарочный сертификат на торт или десерт от кондитеров России. Идеальный подарок на любой повод.",
    path: "/gift-certificates",
  },
  "for-confectioners": {
    title: `Кондитерам — присоединиться к платформе — ${APP_NAME}`,
    description: "Станьте кондитером на «Уездном кондитере»: витрина, конструктор тортов, безопасные платежи, выплаты, CRM.",
    path: "/for-confectioners",
  },
  "for-suppliers": {
    title: `Поставщикам — сотрудничество — ${APP_NAME}`,
    description: "Размещение товаров для кондитеров: ингредиенты, оборудование, декор. B2B-контракты, опт.",
    path: "/for-suppliers",
  },
  tenders: {
    title: `Тендеры на торты — ${APP_NAME}`,
    description: "Размещение тендеров на торты для свадеб, корпоративов, дней рождения. Конкурсные предложения от кондитеров.",
    path: "/tenders",
  },
  blog: {
    title: `Блог о кондитерском искусстве — ${APP_NAME}`,
    description: "Статьи о тортах, десертах, трендах, рецептах и бизнесе для кондитеров. Советы от экспертов.",
    path: "/blog",
  },
  about: {
    title: `О платформе — ${APP_NAME}`,
    description: `«${APP_NAME}» — маркетплейс частных кондитеров России. О проекте, команде, миссии.`,
    path: "/about",
  },
  contacts: {
    title: `Контакты — ${APP_NAME}`,
    description: "Свяжитесь с командой «Уездного кондитера»: чат, телефон, email, соцсети.",
    path: "/contacts",
  },
  help: {
    title: `Помощь и поддержка — ${APP_NAME}`,
    description: "Часто задаваемые вопросы, инструкции, поддержка покупателей и кондитеров.",
    path: "/help",
  },
  faq: {
    title: `Вопросы и ответы — ${APP_NAME}`,
    description: "FAQ: заказ, оплата, доставка, эскроу, программа лояльности, налоги кондитеров.",
    path: "/faq",
  },
  reviews: {
    title: `Отзывы покупателей — ${APP_NAME}`,
    description: "Реальные отзывы покупателей о тортах и кондитерах платформы.",
    path: "/reviews",
  },
  "telegram-bot": {
    title: `Telegram-бот — ${APP_NAME}`,
    description: "Заказывайте торты и отслеживайте заказы через Telegram-бот «Уездного кондитера».",
    path: "/telegram-bot",
  },
  legal: {
    title: `Правовая информация — ${APP_NAME}`,
    description: "Политика конфиденциальности, пользовательское соглашение, оферта, обработка персональных данных.",
    path: "/legal",
  },
  checkout: {
    title: `Оформление заказа — ${APP_NAME}`,
    description: "Оформление заказа: доставка, оплата, подтверждение.",
    path: "/checkout",
    noindex: true, // приватная страница
  },
  // Dashboard-ы — все noindex
  "dashboard-customer": {
    title: `Личный кабинет — ${APP_NAME}`,
    description: "Личный кабинет покупателя: заказы, бонусы, favourites, настройки.",
    path: "/dashboard",
    noindex: true,
  },
  "dashboard-confectioner": {
    title: `Кабинет кондитера — ${APP_NAME}`,
    description: "Кабинет кондитера: каталог, заказы, календарь, акции, финансы.",
    path: "/dashboard",
    noindex: true,
  },
  "dashboard-supplier": {
    title: `Кабинет поставщика — ${APP_NAME}`,
    description: "Кабинет поставщика: каталог, склад, B2B-контракты, финансы.",
    path: "/dashboard",
    noindex: true,
  },
  "dashboard-courier": {
    title: `Кабинет курьера — ${APP_NAME}`,
    description: "Кабинет курьера: активные доставки, заработок, расписание.",
    path: "/dashboard",
    noindex: true,
  },
  "dashboard-admin": {
    title: `Админ-панель — ${APP_NAME}`,
    description: "Административная панель: модерация, пользователи, настройки.",
    path: "/dashboard",
    noindex: true,
  },
  "dashboard-extra": {
    title: `Кабинет роли — ${APP_NAME}`,
    description: "Кабинет роли: dashboard для специализированных ролей платформы.",
    path: "/dashboard",
    noindex: true,
  },
};

function setOrUpdateTag(selector: string, attr: string, attrValue: string, content: string) {
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement(selector.split("[")[0]);
    document.head.appendChild(tag);
  }
  tag.setAttribute(attr, attrValue);
  tag.setAttribute("content", content);
}

function setOrUpdateLink(rel: string, href: string) {
  let link = document.head.querySelector(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", rel);
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

function setOrUpdateMetaRobots(content: string) {
  let meta = document.head.querySelector('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", content);
}

/**
 * Хук: обновляет SEO-теги при смене view.
 * Используется в корневом page.tsx.
 */
export function useSeoMetadata(view: string) {
  useEffect(() => {
    const meta = VIEW_META[view] || VIEW_META.home;

    // 1. <title>
    document.title = meta.title;

    // 2. <meta name="description">
    setOrUpdateTag('meta[name="description"]', "name", "description", meta.description);

    // 3. <link rel="canonical">
    if (meta.path) {
      setOrUpdateLink("canonical", `${APP_URL}${meta.path}`);
    }

    // 4. OpenGraph update
    setOrUpdateTag('meta[property="og:title"]', "property", "og:title", meta.title);
    setOrUpdateTag('meta[property="og:description"]', "property", "og:description", meta.description);
    setOrUpdateTag('meta[property="og:url"]', "property", "og:url", `${APP_URL}${meta.path || "/"}`);

    // 5. Twitter Card update
    setOrUpdateTag('meta[name="twitter:title"]', "name", "twitter:title", meta.title);
    setOrUpdateTag('meta[name="twitter:description"]', "name", "twitter:description", meta.description);

    // 6. robots meta — noindex для приватных страниц
    if (meta.noindex) {
      setOrUpdateMetaRobots("noindex, nofollow");
    } else {
      setOrUpdateMetaRobots("index, follow");
    }
  }, [view]);
}
