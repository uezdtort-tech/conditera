import type { Metadata } from "next";
import { Geist, Geist_Mono, Neucha } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/query-provider";
// NEW v2.0 — глобальный AI-помощник (FAB внизу справа для авторизованных)
import { AIAssistantWidget } from "@/components/ai/ai-assistant-widget";
// П.24: Schema.org — Organization и WebSite на каждой странице
import { siteConfig } from "@/lib/site-config";
import { JsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/schema-org";

// Brokgauz & Efron Italic — фирменный шрифт заголовков «Уездного кондитера»
// (классическая русская энциклопедическая антиква, дарит аутентичный
// дореволюционный кондитерский колорит).
const brokgauz = localFont({
  src: "./fonts/Brokgauz_amp_Efron-Italic.ttf",
  variable: "--font-display",
  display: "swap",
  weight: "400",
  style: "italic",
});

// TriodPostnaja Medium — фирменный шрифт названия бренда «Уездный кондитер».
// Старославянская полунаклонная «постная» антиква — аутентичный православный
// книжный стиль, отлично ложится на дореволюционную тему проекта.
const triod = localFont({
  src: "./fonts/TriodPostnaja-Medium.ttf",
  variable: "--font-brand",
  display: "swap",
  weight: "500",
  style: "normal",
});

const neucha = Neucha({
  variable: "--font-script",
  subsets: ["latin", "cyrillic"],
  weight: ["400"],
  display: "swap",
});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  manifest: "/manifest.webmanifest",
  title: `${siteConfig.name} — маркетплейс кондитерских изделий`,
  description: siteConfig.description,
  keywords: [
    siteConfig.name,
    "маркетплейс тортов",
    "домашние кондитеры",
    "конструктор тортов",
    "заказ торта",
    "десерты на заказ",
  ],
  authors: [{ name: siteConfig.name }],
  robots: { index: true, follow: true },
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    type: "website",
    images: ["/logo.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: ["/logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${brokgauz.variable} ${triod.variable} ${neucha.variable} ${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* П.24: Schema.org Organization + WebSite — на каждой странице,
            чтобы Google показывал лого, контакты и sitelinks search box в выдаче */}
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />

        {/* Яндекс Метрика — счётчик 111432662 */}
        {process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID && (
          <>
            <Script id="yandex-metrika" strategy="afterInteractive">
              {`
                (function(m,e,t,r,i,k,a){
                    m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                    m[i].l=1*new Date();
                    for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
                    k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
                })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=${process.env.NEXT_PUBLIC_YANDEX_METRIKA}', 'ym');

                ym(${process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID}, 'init', {
                  ssr: true,
                  webvisor: true,
                  clickmap: true,
                  ecommerce: "dataLayer",
                  referrer: document.referrer,
                  url: location.href,
                  accurateTrackBounce: true,
                  trackLinks: true
                });
              `}
            </Script>
            <noscript>
              <div>
                <img
                  src={`https://mc.yandex.ru/watch/${process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID}`}
                  style={{ position: "absolute", left: "-9999px" }}
                  alt=""
                />
              </div>
            </noscript>
          </>
        )}

        <QueryProvider>
          {children}
          <Toaster />
          <SonnerToaster position="top-right" richColors />
          {/* NEW v2.0 — глобальный AI-помощник для авторизованных пользователей */}
          <AIAssistantWidget />
        </QueryProvider>
      </body>
    </html>
  );
}
