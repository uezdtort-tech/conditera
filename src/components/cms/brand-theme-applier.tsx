"use client";

/**
 * brand-theme-applier.tsx — применяет бренд-настройки из опубликованного
 * документа site_settings (ключи brand_accent_color / brand_logo_url)
 * к документу: inline CSS-переменные на <html> имеют приоритет над
 * токенами globals.css (в т.ч. над .dark — inline всегда выигрывает).
 *
 * Контракт: никогда не бросает, при null-значениях ничего не меняет
 * (системная тема остаётся). Логотип не трогается здесь — шапка читает
 * usePublishedBrand() напрямую.
 */

import { useEffect } from "react";
import { usePublishedBrand } from "@/hooks/use-published-cms";

/** Относительная светимость HEX (BT.601-приближение достаточно для контраста). */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function BrandThemeApplier() {
  const brand = usePublishedBrand();

  useEffect(() => {
    const root = document.documentElement;
    if (!brand.accentColor) {
      // Фолбэк: снимаем предыдущее переопределение (SPA-переходы/смена настроек).
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
      root.style.removeProperty("--ring");
      root.style.removeProperty("--sidebar-primary");
      return;
    }
    const accent = brand.accentColor;
    const fg = luminance(accent) > 0.55 ? "#0a0a0a" : "#ffffff";
    root.style.setProperty("--primary", accent);
    root.style.setProperty("--primary-foreground", fg);
    root.style.setProperty("--ring", accent);
    root.style.setProperty("--sidebar-primary", accent);
  }, [brand.accentColor]);

  // Компонент ничего не рендерит — только side-effect применения темы.
  return null;
}
