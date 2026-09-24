/**
 * Lightweight i18n module for «Уездный кондитер».
 *
 * Поддерживает русский (RU) и английский (EN) языки.
 * Не требует сторонних пакетов (next-intl и т.п.) — работает на чистом React.
 *
 * Возможности:
 *  - Словарь переводов RU/EN (50+ ключевых строк)
 *  - Хук useTranslation (client-side), читающий язык из cookie/localStorage
 *  - Функция t(key, params) для подстановки параметров
 *  - Детект языка из URL (/en/ prefix) или заголовка Accept-Language
 *  - Функция setLanguage(lang), устанавливающая cookie на 1 год
 *
 * Файл НЕ помечен директивой "use client", поэтому чистые функции
 * (t, getLanguage, setLanguage, detectLanguage*) работают и на сервере,
 * и на клиенте. Хук useTranslation можно вызывать только из клиентских
 * компонентов (правила хуков React).
 */

import { useCallback, useEffect, useState } from "react";

/* ========================================================================== */
/*  Типы                                                                       */
/* ========================================================================== */

export type Language = "ru" | "en";

export type TranslationParams = Record<string, string | number>;

/** Карта переводов: ключ -> перевод для конкретного языка. */
type Dictionary = Record<string, Record<Language, string>>;

/* ========================================================================== */
/*  Конфигурация                                                               */
/* ========================================================================== */

export const LANGUAGES: Language[] = ["ru", "en"];
export const DEFAULT_LANGUAGE: Language = "ru";
export const LANG_COOKIE_NAME = "lang";
export const LANG_LOCAL_STORAGE_KEY = "uezd_lang";
/** Срок жизни cookie — 1 год (в секундах). */
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/* ========================================================================== */
/*  Словарь переводов (50+ строк)                                              */
/* ========================================================================== */

export const translations: Dictionary = {
  /* --- Навигация (12) --- */
  nav_home:           { ru: "Главная",            en: "Home" },
  nav_catalog:        { ru: "Каталог",            en: "Catalog" },
  nav_confectioners:  { ru: "Кондитеры",          en: "Confectioners" },
  nav_cake_builder:   { ru: "Конструктор торта",  en: "Cake Builder" },
  nav_checkout:       { ru: "Оформление заказа",  en: "Checkout" },
  nav_blog:           { ru: "Блог",               en: "Blog" },
  nav_about:          { ru: "О нас",              en: "About" },
  nav_contacts:       { ru: "Контакты",           en: "Contacts" },
  nav_faq:            { ru: "Вопросы и ответы",   en: "FAQ" },
  nav_help:           { ru: "Помощь",             en: "Help" },
  nav_promotions:     { ru: "Акции",              en: "Promotions" },
  nav_recipes:        { ru: "Рецепты",            en: "Recipes" },

  /* --- Действия (10) --- */
  action_add_to_cart: { ru: "Добавить в корзину", en: "Add to cart" },
  action_buy_now:     { ru: "Купить сейчас",      en: "Buy now" },
  action_order:       { ru: "Заказать",           en: "Order" },
  action_cancel:      { ru: "Отмена",             en: "Cancel" },
  action_save:        { ru: "Сохранить",          en: "Save" },
  action_edit:        { ru: "Редактировать",      en: "Edit" },
  action_delete:      { ru: "Удалить",            en: "Delete" },
  action_search:      { ru: "Поиск",              en: "Search" },
  action_filter:      { ru: "Фильтр",             en: "Filter" },
  action_sort:        { ru: "Сортировка",         en: "Sort" },

  /* --- Авторизация (7) --- */
  auth_login:         { ru: "Войти",              en: "Login" },
  auth_register:      { ru: "Регистрация",        en: "Register" },
  auth_logout:        { ru: "Выйти",              en: "Logout" },
  auth_email:         { ru: "Электронная почта",  en: "Email" },
  auth_password:      { ru: "Пароль",             en: "Password" },
  auth_name:          { ru: "Имя",                en: "Name" },
  auth_phone:         { ru: "Телефон",            en: "Phone" },

  /* --- Товар (6) --- */
  product_price:      { ru: "Цена",               en: "Price" },
  product_weight:     { ru: "Вес",                en: "Weight" },
  product_filling:    { ru: "Начинка",            en: "Filling" },
  product_coating:    { ru: "Покрытие",           en: "Coating" },
  product_decoration: { ru: "Декор",              en: "Decoration" },
  product_category:   { ru: "Категория",          en: "Category" },

  /* --- Статусы заказа (7) --- */
  order_status_pending:     { ru: "Ожидает подтверждения", en: "Pending" },
  order_status_confirmed:   { ru: "Подтверждён",           en: "Confirmed" },
  order_status_in_progress: { ru: "В работе",              en: "In progress" },
  order_status_ready:       { ru: "Готов",                 en: "Ready" },
  order_status_delivering:  { ru: "Доставляется",          en: "Delivering" },
  order_status_completed:   { ru: "Завершён",              en: "Completed" },
  order_status_cancelled:   { ru: "Отменён",               en: "Cancelled" },

  /* --- Ошибки (4) --- */
  error_auth:         { ru: "Ошибка авторизации",       en: "Authentication error" },
  error_not_found:    { ru: "Страница не найдена",      en: "Page not found" },
  error_server:       { ru: "Ошибка сервера",           en: "Server error" },
  error_rate_limit:   { ru: "Слишком много запросов",   en: "Too many requests" },

  /* --- Прочее (8) — для перевода 50+ строк --- */
  common_loading:     { ru: "Загрузка…",          en: "Loading…" },
  common_no_results:  { ru: "Ничего не найдено",  en: "No results" },
  common_yes:         { ru: "Да",                 en: "Yes" },
  common_no:          { ru: "Нет",                en: "No" },
  common_back:        { ru: "Назад",              en: "Back" },
  common_continue:    { ru: "Продолжить",         en: "Continue" },
  common_submit:      { ru: "Отправить",          en: "Submit" },
  common_close:       { ru: "Закрыть",            en: "Close" },
};

/* ========================================================================== */
/*  Детект языка                                                               */
/* ========================================================================== */

/**
 * Проверяет, является ли строка валидным языком из supported-списка.
 */
export function isLanguage(value: unknown): value is Language {
  return value === "ru" || value === "en";
}

/**
 * Детект языка из URL по префиксу /en/ (или path === "/en").
 * Работает и на сервере, и на клиенте.
 *
 * @param pathname — путь (например, "/en/catalog" или "/catalog")
 * @returns "en" если путь начинается с "/en", иначе null
 */
export function detectLanguageFromUrl(pathname?: string): Language | null {
  if (!pathname) {
    return null;
  }
  // Нормализуем: убираем trailing slash, кроме корня
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/en" || path.startsWith("/en/")) {
    return "en";
  }
  if (path === "/ru" || path.startsWith("/ru/")) {
    return "ru";
  }
  return null;
}

/**
 * Парсит заголовок Accept-Language и возвращает наиболее подходящий язык.
 * Работает только на сервере (или в middleware).
 *
 * Пример заголовка: "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7"
 *
 * @param header — значение заголовка Accept-Language
 * @returns "ru" | "en" | null (null если не удалось определить)
 */
export function detectLanguageFromHeader(header: string | null | undefined): Language | null {
  if (!header) {
    return null;
  }

  // Парсим заголовок в массив { lang, q }
  const parts = header
    .split(",")
    .map((part) => {
      const [tag, qStr] = part.trim().split(";");
      const q = qStr && qStr.startsWith("q=") ? parseFloat(qStr.slice(2)) : 1;
      return { tag: tag.toLowerCase(), q: isNaN(q) ? 1 : q };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of parts) {
    // Точное совпадение "ru" / "en"
    if (tag === "ru" || tag === "en") {
      return tag;
    }
    // Префиксное совпадение "ru-ru" / "en-us"
    if (tag.startsWith("ru-") || tag.startsWith("ru_")) return "ru";
    if (tag.startsWith("en-") || tag.startsWith("en_")) return "en";
  }

  return null;
}

/**
 * Читает значение cookie по имени из document.cookie (browser only).
 */
function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Определяет текущий язык на клиенте.
 * Приоритет:
 *   1. URL (/en/ prefix)
 *   2. cookie `lang`
 *   3. localStorage `uezd_lang`
 *   4. navigator.language (browser)
 *   5. DEFAULT_LANGUAGE
 *
 * На сервере возвращает DEFAULT_LANGUAGE (нет доступа к cookie/document).
 */
export function getLanguage(): Language {
  // --- URL (работает и на сервере, если передать pathname, но без аргументов —
  //     читаем из window.location на клиенте) ---
  if (typeof window !== "undefined") {
    const fromUrl = detectLanguageFromUrl(window.location.pathname);
    if (fromUrl) return fromUrl;

    // --- Cookie ---
    const fromCookie = readCookie(LANG_COOKIE_NAME);
    if (isLanguage(fromCookie)) return fromCookie;

    // --- localStorage ---
    try {
      const fromLs = window.localStorage.getItem(LANG_LOCAL_STORAGE_KEY);
      if (isLanguage(fromLs)) return fromLs;
    } catch {
      // localStorage может быть недоступен (private mode, SSR)
    }

    // --- navigator.language ---
    const navLang = window.navigator?.language;
    if (navLang) {
      const detected = detectLanguageFromHeader(navLang);
      if (detected) return detected;
    }
  }

  return DEFAULT_LANGUAGE;
}

/* ========================================================================== */
/*  Установка языка                                                            */
/* ========================================================================== */

/**
 * Устанавливает язык: пишет cookie (1 год), localStorage и опционально
 * перезагружает страницу, чтобы применить новый язык.
 *
 * Browser only — вызывает document.cookie и localStorage.
 *
 * @param lang — целевой язык ("ru" | "en")
 * @param options.reload — перезагрузить страницу после установки (по умолчанию true)
 */
export function setLanguage(
  lang: Language,
  options: { reload?: boolean } = {},
): void {
  if (!isLanguage(lang)) {
    return;
  }

  const { reload = true } = options;

  if (typeof document !== "undefined") {
    // Cookie на 1 год, path=/, SameSite=Lax
    const expires = new Date(Date.now() + LANG_COOKIE_MAX_AGE * 1000).toUTCString();
    document.cookie = `${LANG_COOKIE_NAME}=${lang}; expires=${expires}; path=/; SameSite=Lax`;
  }

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANG_LOCAL_STORAGE_KEY, lang);
    } catch {
      // игнорируем ошибки localStorage
    }

    // Обновляем lang у <html> для accessibility/SEO
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }

    if (reload) {
      window.location.reload();
    }
  }
}

/* ========================================================================== */
/*  Функция перевода                                                           */
/* ========================================================================== */

/**
 * Возвращает перевод строки по ключу для указанного языка.
 *
 * Поддерживает подстановку параметров через плейсхолдеры {name}:
 *   t("greeting", { name: "Иван" }) для "Здравствуйте, {name}!"
 *
 * Если ключ не найден — возвращает сам ключ (fallback).
 *
 * @param key — ключ перевода (например, "nav_home")
 * @param params — параметры для подстановки (опционально)
 * @param lang — язык (по умолчанию getLanguage())
 */
export function t(
  key: string,
  params?: TranslationParams,
  lang: Language = getLanguage(),
): string {
  const entry = translations[key];
  if (!entry) {
    return key;
  }

  let value = entry[lang] ?? entry[DEFAULT_LANGUAGE] ?? key;

  if (params) {
    for (const [paramName, paramValue] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${paramName}\\}`, "g"), String(paramValue));
    }
  }

  return value;
}

/* ========================================================================== */
/*  Хук useTranslation (client-side)                                           */
/* ========================================================================== */

/**
 * React-хук для доступа к переводам из клиентских компонентов.
 *
 * Возвращает:
 *  - t: функция перевода, привязанная к текущему языку
 *  - lang: текущий язык ("ru" | "en")
 *  - setLang: функция смены языка (обёртка над setLanguage)
 *  - toggleLang: переключатель RU <-> EN
 *
 * Читает язык из cookie/localStorage/URL при монтировании.
 *
 * @example
 * const { t, lang, setLang } = useTranslation();
 * return <h1>{t("nav_home")}</h1>;
 */
export function useTranslation() {
  // На SSR используем DEFAULT_LANGUAGE, на клиенте — детектим после mount.
  const [lang, setLangState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    setLangState(getLanguage());
  }, []);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
    setLanguage(next, { reload: false });
  }, []);

  const toggleLang = useCallback(() => {
    const next: Language = lang === "ru" ? "en" : "ru";
    setLang(next);
  }, [lang, setLang]);

  // Стабильная ссылка на t, привязанную к текущему языку
  const boundT = useCallback(
    (key: string, params?: TranslationParams) => t(key, params, lang),
    [lang],
  );

  return {
    t: boundT,
    lang,
    setLang,
    toggleLang,
    /** Список поддерживаемых языков (для UI-переключателей). */
    languages: LANGUAGES,
  };
}
