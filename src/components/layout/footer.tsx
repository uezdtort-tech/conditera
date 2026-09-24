"use client";

import { useAppStore } from "@/lib/store";
import { siteConfig, getCopyrightYears } from "@/lib/site-config";
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

  return (
    <footer className="mt-auto border-t border-border bg-secondary/40">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <button
              onClick={() => navigate("home")}
              className="flex items-center gap-2 mb-4"
            >
              <img src="/logo.png" alt={siteConfig.name} className="h-12 w-12 rounded-full object-cover shadow-md" />
              <div className="text-left leading-tight">
                <div className="logo-text text-lg">{siteConfig.name}</div>
              </div>
            </button>
            <p className="text-sm text-muted-foreground mb-4 max-w-xs">
              {siteConfig.description}
            </p>
            <div className="space-y-2 text-sm">
              <a
                href={`mailto:${siteConfig.supportEmail}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
              >
                <Mail className="h-4 w-4" />
                {siteConfig.supportEmail}
              </a>
              <a
                href={`tel:${siteConfig.phoneHref}`}
                className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors"
              >
                <Phone className="h-4 w-4" />
                {siteConfig.phone}
              </a>
              {siteConfig.address && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  {siteConfig.address}
                </div>
              )}
            </div>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h3 className="font-semibold text-sm mb-3 text-foreground">
                {col.title}
              </h3>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <button
                      onClick={() => link.view && navigate(link.view)}
                      className="text-sm text-muted-foreground hover:text-primary transition-colors text-left"
                    >
                      {link.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Payment & social */}
        <div className="mt-10 pt-6 border-t border-border flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium">Принимаем:</span>
            {["Visa", "Mastercard", "Мир", "СБП", "YooKassa"].map((p) => (
              <span
                key={p}
                className="px-2 py-1 bg-background border border-border rounded text-[11px] font-medium"
              >
                {p}
              </span>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            © {getCopyrightYears()} {siteConfig.name}. Все права защищены.
            {siteConfig.inn && ` ИНН ${siteConfig.inn}.`}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button onClick={() => navigate("legal", { legal: "privacy" })} className="text-muted-foreground hover:text-primary transition">Политика конфиденциальности</button>
            <button onClick={() => navigate("legal", { legal: "terms" })} className="text-muted-foreground hover:text-primary transition">Пользовательское соглашение</button>
            <button onClick={() => navigate("legal", { legal: "offer" })} className="text-muted-foreground hover:text-primary transition">Договор-оферта</button>
            <button onClick={() => navigate("legal", { legal: "consent" })} className="text-muted-foreground hover:text-primary transition">Согласие на обработку ПД</button>
            <button onClick={() => navigate("legal", { legal: "cookies" })} className="text-muted-foreground hover:text-primary transition">Cookies</button>
          </div>
        </div>
      </div>
    </footer>
  );
}
