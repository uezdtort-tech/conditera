/**
 * Site configuration — все контакты и настройки из .env.
 * Используется в footer, header, legal pages, email templates, etc.
 *
 * ВАЖНО: NEXT_PUBLIC_* переменные доступны на клиенте.
 * Обычные переменные — только на сервере.
 */

export const siteConfig = {
  // === Бренд ===
  // ⚠️ Правило №1 ТЗ: бренд — всегда «Уездный кондитер» (не «Кондитера», не «Уездный»)
  name: process.env.NEXT_PUBLIC_APP_NAME || "Уездный кондитер",
  fullName: process.env.NEXT_PUBLIC_APP_NAME || "Уездный кондитер",
  domain: process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, "") || "conditera.ru",
  url: process.env.NEXT_PUBLIC_APP_URL || "https://conditera.ru",

  // === Контакты ===
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@conditera.ru",
  infoEmail: process.env.NEXT_PUBLIC_INFO_EMAIL || "info@conditera.ru",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "privacy@conditera.ru",
  phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || "8 (800) 000-00-00",
  phoneHref: process.env.NEXT_PUBLIC_SUPPORT_PHONE_HREF || "+78000000000",
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || "",
  inn: process.env.NEXT_PUBLIC_COMPANY_INN || "",
  ogrn: process.env.NEXT_PUBLIC_COMPANY_OGRN || "",

  // === Соцсети ===
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_CHANNEL || "@conditera",
  telegramUrl: process.env.NEXT_PUBLIC_TELEGRAM_URL || "https://t.me/conditera",
  vkUrl: process.env.NEXT_PUBLIC_VK_URL || "",
  instagramUrl: process.env.NEXT_PUBLIC_INSTAGRAM_URL || "",

  // === Юр. лицо ===
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || "",
  legalAddress: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "",

  // === Реквизиты ===
  bankName: process.env.NEXT_PUBLIC_BANK_NAME || "",
  bankAccount: process.env.NEXT_PUBLIC_BANK_ACCOUNT || "",
  bankBik: process.env.NEXT_PUBLIC_BANK_BIK || "",
  bankCorrespondentAccount: process.env.NEXT_PUBLIC_BANK_CORRESPONDENT_ACCOUNT || "",

  // === Год запуска (для футера "© 2024—2026") ===
  foundedYear: process.env.NEXT_PUBLIC_FOUNDED_YEAR || "2024",

  // === Описание ===
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ||
    "Маркетплейс кондитерских изделий от домашних кондитеров по всей России",
};

/**
 * Получить год для футера: "© 2024—2026"
 */
export function getCopyrightYears(): string {
  const founded = siteConfig.foundedYear;
  const current = new Date().getFullYear().toString();
  return founded === current ? founded : `${founded}—${current}`;
}
