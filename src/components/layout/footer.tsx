"use client";

import { useAppStore } from "@/lib/store";
import { siteConfig, getCopyrightYears } from "@/lib/site-config";
import { usePublishedNavMenu } from "@/hooks/use-published-nav-menu";
import { isExternalCmsHref, cmsInternalView } from "@/hooks/use-published-cms";
import { Cake, Mail, Phone, MapPin, Sparkles } from "lucide-react";
import type { ViewKey } from "@/lib/types";

const FOOTER_COLUMNS: {
  title: string;
  links: { label: string; view?: ViewKey; href?: string }[];
}[] = [
  {
    title: "Покупателям",
    links: [
      { label: "Каталог", view: "catalog" },
      { label: "Конструктор тортов", view: "cake-builder" },
      { label: "Кондитеры", view: "confectioners" },
      { label: "Готовые изделия", view: "ready-made" },
      { label: "Акции и скидки", view: "promotions" },
      { label: "Подарочные сертификаты", view: "gift-certificates" },
      { label: "Программа лояльности", view: "dashboard-customer" },
    ],
  },
  {
    title: "B2B и услуги",
    links: [
      { label: "Корпоративам", view: "corporate-events" },
      { label: "Магазин декора", view: "decor-shop" },
      { label: "Услуги и площадки", view: "services-shop" },
      { label: "Ингредиенты (B2B)", view: "supplier-shop" },
      { label: "Тендеры", view: "tenders" },
    ],
  },
  {
    title: "Кондитерам",
    links: [
      { label: "Стать кондитером", view: "for-confectioners" },
      { label: "Кабинет кондитера", view: "dashboard-confectioner" },
      { label: "Тарифы", view: "about" },
      { label: "Поставщикам", view: "for-suppliers" },
      { label: "Курьерам", view: "auth" },
    ],
  },
  {
    title: "О платформе",
    links: [
      { label: "О нас", view: "about" },
      { label: "Отзывы", view: "reviews" },
      { label: "Блог", view: "blog" },
      { label: "Рецепты", view: "recipes" },
      { label: "Контакты", view: "contacts" },
      { label: "Помощь", view: "help" },
      { label: "FAQ", view: "faq" },
    ],
  },
];

export function Footer() {
  const navigate = useAppStore((s) => s.navigate);
  // Z-brand/CMS: опубликованные пункты меню футера (cms_nav_menu, location=footer).
  // Нет пунктов → колонка не рендерится, хардкод-колонки без изменений.
  const cmsFooterItems = usePublishedNavMenu("footer");

  const goToCmsFooterItem = (url: string) => {
    if (isExternalCmsHref(url)) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    navigate(cmsInternalView(url) as never);
  };

  return (
    <footer className="footer-dark relative mt-auto">
      {/* Лёгкое зерно поверх тёмного шоколада (V2) */}
      <div className="grain-overlay absolute inset-0" aria-hidden="true" />
      <div className="container mx-auto px-4 py-14 relative">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <button
              onClick={() => navigate("home")}
              className="flex items-center gap-2 mb-4"
            >
              <img src="/logo.png" alt={siteConfig.name} className="h-12 w-12 rounded-full object-cover shadow-md ring-1 ring-white/15" />
              <div className="text-left leading-tight">
                <div className="logo-text text-lg text-[oklch(0.92_0.012_80)]">{siteConfig.name}</div>
              </div>
            </button>
            <p className="text-sm text-[oklch(0.70_0.02_65)] mb-4 max-w-xs">
              {siteConfig.description}
            </p>
            <div className="space-y-2.5 text-sm">
              <a
                href={`mailto:${siteConfig.supportEmail}`}
                className="footer-link flex items-center gap-2"
              >
                <Mail className="h-4 w-4" />
                {siteConfig.supportEmail}
              </a>
              <a
                href={`tel:${siteConfig.phoneHref}`}
                className="footer-link flex items-center gap-2"
              >
                <Phone className="h-4 w-4" />
                {siteConfig.phone}
              </a>
              {siteConfig.address && (
                <div className="flex items-center gap-2 text-[oklch(0.70_0.02_65)]">
                  <MapPin className="h-4 w-4" />
                  {siteConfig.address}
                </div>
              )}
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em]! text-[oklch(0.92_0.012_80)] mb-4">
                {col.title}
              </h3>
              <ul className="space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <button
                      onClick={() => link.view && navigate(link.view)}
                      className="footer-link text-sm text-left"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {/* Z-brand/CMS: колонка из опубликованных пунктов (location=footer) */}
          {cmsFooterItems.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-[0.18em]! text-[oklch(0.92_0.012_80)] mb-4">
                Меню
              </h3>
              <ul className="space-y-2.5">
                {cmsFooterItems.map((item) => (
                  <li key={item.id}>
                    {isExternalCmsHref(item.url) ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="footer-link text-sm"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <button
                        onClick={() => goToCmsFooterItem(item.url)}
                        className="footer-link text-sm text-left"
                      >
                        {item.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Payment & social */}
        <div className="mt-10 pt-6 border-t border-white/10 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[oklch(0.70_0.02_65)]">
            <span className="font-medium text-[oklch(0.80_0.02_70)]">Принимаем:</span>
            {["Visa", "Mastercard", "Мир", "СБП", "YooKassa"].map((p) => (
              <span
                key={p}
                className="px-2.5 py-1 bg-white/10 border border-white/15 rounded-md text-[11px] font-medium text-[oklch(0.85_0.02_75)]"
              >
                {p}
              </span>
            ))}
          </div>
          <div className="text-xs text-[oklch(0.70_0.02_65)]">
            © {getCopyrightYears()} {siteConfig.name}. Все права защищены.
            {siteConfig.inn && ` ИНН ${siteConfig.inn}.`}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button onClick={() => navigate("legal", { legal: "privacy" })} className="footer-link">Политика конфиденциальности</button>
            <button onClick={() => navigate("legal", { legal: "terms" })} className="footer-link">Пользовательское соглашение</button>
            <button onClick={() => navigate("legal", { legal: "offer" })} className="footer-link">Договор-оферта</button>
            <button onClick={() => navigate("legal", { legal: "consent" })} className="footer-link">Согласие на обработку ПД</button>
            <button onClick={() => navigate("legal", { legal: "cookies" })} className="footer-link">Cookies</button>
          </div>
        </div>
      </div>
    </footer>
  );
}
