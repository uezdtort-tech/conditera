"use client";

/**
 * Переключатель языка RU/EN для шапки сайта.
 *
 * Особенности:
 *  - Показывает текущий язык (RU / EN)
 *  - По клику переключает между RU и EN
 *  - Записывает cookie `lang=ru|en` со сроком 1 год (через setLanguage)
 *  - Также пишет значение в localStorage для мгновенного чтения
 *  - Обновляет атрибут <html lang="..."> без полной перезагрузки
 *  - Синхронизируется с другими вкладками через событие storage
 *
 * Использует лёгкий i18n-модуль из @/lib/i18n.
 */

import { useCallback, useEffect, useState } from "react";
import { Languages } from "lucide-react";
import {
  getLanguage,
  isLanguage,
  LANG_COOKIE_MAX_AGE,
  LANG_COOKIE_NAME,
  LANG_LOCAL_STORAGE_KEY,
  setLanguage,
  type Language,
} from "@/lib/i18n";

export function LanguageSwitcher() {
  // SSR-рендер начинается с "ru", на клиенте — корректируется в useEffect.
  const [lang, setLang] = useState<Language>("ru");
  const [mounted, setMounted] = useState(false);

  // После монтирования определяем актуальный язык.
  useEffect(() => {
    setLang(getLanguage());
    setMounted(true);
  }, []);

  // Синхронизация между вкладками: если в другой вкладке сменили язык —
  // подтягиваем изменение сюда.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANG_LOCAL_STORAGE_KEY && isLanguage(e.newValue)) {
        setLang(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleToggle = useCallback(() => {
    const next: Language = lang === "ru" ? "en" : "ru";
    setLang(next);
    // setLanguage пишет cookie (1 год) + localStorage + обновляет <html lang>.
    setLanguage(next, { reload: false });
  }, [lang]);

  // До монтирования рендерим заглушку с теми же размерами — избегаем layout shift.
  if (!mounted) {
    return (
      <button
        type="button"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 px-2.5 text-sm font-medium text-muted-foreground opacity-0"
        aria-label="Переключить язык"
        disabled
      >
        <Languages className="h-4 w-4" />
        <span className="tabular-nums">RU</span>
      </button>
    );
  }

  const nextLang: Language = lang === "ru" ? "en" : "ru";

  return (
    <button
      type="button"
      onClick={handleToggle}
      className="group inline-flex h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-background/50 px-2.5 text-sm font-medium text-muted-foreground transition-all hover:border-amber-500/40 hover:bg-amber-500/5 hover:text-foreground"
      aria-label={`Сменить язык на ${nextLang === "en" ? "английский" : "русский"}`}
      title={`Переключить на ${nextLang === "en" ? "EN" : "RU"}`}
    >
      <Languages className="h-4 w-4 transition-colors group-hover:text-amber-600" />
      {/* Текущий язык подсвечен, следующий — приглушён. */}
      <span className="flex items-center gap-0.5 tabular-nums">
        <span className={lang === "ru" ? "text-foreground font-semibold" : "text-muted-foreground/60"}>
          RU
        </span>
        <span className="text-muted-foreground/40">/</span>
        <span className={lang === "en" ? "text-foreground font-semibold" : "text-muted-foreground/60"}>
          EN
        </span>
      </span>
      <span className="sr-only">
        Текущий язык: {lang === "ru" ? "русский" : "английский"}
      </span>
    </button>
  );
}

/**
 * Полезная константа для server-side рендеринга (если потребуется
 * выписать cookie в Set-Cookie ответе). Экспортируем, чтобы переиспользовать
 * в API-эндпоинтах.
 */
export { LANG_COOKIE_NAME, LANG_COOKIE_MAX_AGE };
