"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Header } from "@/components/layout/header";
import { CommandPalette, useCommandPaletteShortcut } from "@/components/layout/command-palette";
import { Footer } from "@/components/layout/footer";
import { AuthModal } from "@/components/layout/auth-modal";
import { LiveProductsHydrator } from "@/components/marketplace/live-products-hydrator";
import { LiveServicesHydrator } from "@/components/marketplace/live-services-hydrator";
import { LiveDecorHydrator } from "@/components/marketplace/live-decor-hydrator";
import { PromoPopup } from "@/components/layout/promo-popup";
import { CartDrawer } from "@/components/marketplace/cart-drawer";
import { CartSyncHydrator } from "@/components/marketplace/cart-sync-hydrator";
import { ChatWidget } from "@/components/chat/chat-widget";
import { CakeBuilderDialog } from "@/components/cake-builder/cake-builder-dialog";
import dynamic from "next/dynamic";
import { useSeoMetadata } from "@/lib/use-seo-metadata";

// П.18: Code-splitting SPA-view (продолжение П.17 для дашбордов).
// Каждая view — отдельный чанк: Turbopack в dev компилирует его лениво при
// первом переключении view, а не весь граф приложения при компиляции маршрута
// `/` (замер до фикса: компиляция `/` стоила ~1 GB RSS и была главным
// источником OOM-kill в 4 GB sandbox). В prod это уменьшает initial JS.
// ssr не переопределяется (true по умолчанию) — SSR-HTML активной view
// сохраняется, поисковый робот видит тот же контент, что и до фикса.
const HomePage = dynamic(() => import("@/components/pages/home-page").then((m) => m.HomePage), { loading: () => <PageSkeleton /> });
const CatalogPage = dynamic(() => import("@/components/pages/catalog-page").then((m) => m.CatalogPage), { loading: () => <PageSkeleton /> });
const ProductPage = dynamic(() => import("@/components/pages/product-page").then((m) => m.ProductPage), { loading: () => <PageSkeleton /> });
const ConfectionersPage = dynamic(() => import("@/components/pages/confectioners-page").then((m) => m.ConfectionersPage), { loading: () => <PageSkeleton /> });
const ConfectionerProfilePage = dynamic(() => import("@/components/pages/confectioner-profile-page").then((m) => m.ConfectionerProfilePage), { loading: () => <PageSkeleton /> });
const SupplierShopPage = dynamic(() => import("@/components/pages/supplier-shop-page").then((m) => m.SupplierShopPage), { loading: () => <PageSkeleton /> });
const PromotionsPage = dynamic(() => import("@/components/pages/promotions-page").then((m) => m.PromotionsPage), { loading: () => <PageSkeleton /> });
const RecipesPage = dynamic(() => import("@/components/pages/recipes-page").then((m) => m.RecipesPage), { loading: () => <PageSkeleton /> });
const RecipeDetailPage = dynamic(() => import("@/components/pages/recipe-detail-page").then((m) => m.RecipeDetailPage), { loading: () => <PageSkeleton /> });
const CorporateEventsPage = dynamic(() => import("@/components/pages/corporate-events-page").then((m) => m.CorporateEventsPage), { loading: () => <PageSkeleton /> });
const DecorShopPage = dynamic(() => import("@/components/pages/decor-shop-page").then((m) => m.DecorShopPage), { loading: () => <PageSkeleton /> });
const ServicesShopPage = dynamic(() => import("@/components/pages/services-shop-page").then((m) => m.ServicesShopPage), { loading: () => <PageSkeleton /> });
const VenuesPage = dynamic(() => import("@/components/pages/venues-page").then((m) => m.VenuesPage), { loading: () => <PageSkeleton /> });
const GiftCertificatesPage = dynamic(() => import("@/components/pages/gift-certificates-page").then((m) => m.GiftCertificatesPage), { loading: () => <PageSkeleton /> });
const TelegramBotPage = dynamic(() => import("@/components/dashboard/customer-features-tabs").then((m) => m.TelegramBotPage), { loading: () => <PageSkeleton /> });
const CakeBuilderPage = dynamic(() => import("@/components/cake-builder/cake-builder-page").then((m) => m.CakeBuilderPage), { loading: () => <PageSkeleton /> });
const ReadyMadePage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.ReadyMadePage), { loading: () => <PageSkeleton /> });
const TendersPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.TendersPage), { loading: () => <PageSkeleton /> });
const BlogPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.BlogPage), { loading: () => <PageSkeleton /> });
const AboutPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.AboutPage), { loading: () => <PageSkeleton /> });
const FaqPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.FaqPage), { loading: () => <PageSkeleton /> });
const CheckoutPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.CheckoutPage), { loading: () => <PageSkeleton /> });
const ReviewsPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.ReviewsPage), { loading: () => <PageSkeleton /> });
const ForConfectionersPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.ForConfectionersPage), { loading: () => <PageSkeleton /> });
const ForSuppliersPage = dynamic(() => import("@/components/pages/extra-pages").then((m) => m.ForSuppliersPage), { loading: () => <PageSkeleton /> });
const LegalPage = dynamic(() => import("@/components/pages/legal-page").then((m) => m.LegalPage), { loading: () => <PageSkeleton /> });

/** Skeleton для SPA-view на время подгрузки чанка (аналог DashboardSkeleton) */
function PageSkeleton() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-96 bg-muted/70 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted/50 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

// П.17: Code-splitting дашбордов.
// Каждый дашборд — это отдельный чанк, который подгружается только когда
// пользователь открывает соответствующий раздел. Это уменьшает initial
// bundle публичных страниц (home/catalog/product) на ~150-200 KB JS.
// ssr: false — дашборды под защитой auth, нет смысла их рендерить на сервере.
const CustomerDashboard = dynamic(
  () => import("@/components/dashboard/customer-dashboard-v2").then((m) => m.CustomerDashboardV2),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const ConfectionerDashboard = dynamic(
  () => import("@/components/dashboard/confectioner-dashboard-v2").then((m) => m.ConfectionerDashboardV2),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const SupplierDashboard = dynamic(
  () => import("@/components/dashboard/other-dashboards").then((m) => m.SupplierDashboard),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const CourierDashboard = dynamic(
  () => import("@/components/dashboard/other-dashboards").then((m) => m.CourierDashboard),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const AdminDashboard = dynamic(
  () => import("@/components/dashboard/other-dashboards").then((m) => m.AdminDashboard),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const ExtraDashboards = dynamic(
  () => import("@/components/dashboard/extra-dashboards").then((m) => m.ExtraDashboards),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const VenueOwnerDashboard = dynamic(
  () => import("@/components/dashboard/venue-owner-dashboard").then((m) => m.VenueOwnerDashboard),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

/** Простой skeleton для дашбордов во время подгрузки чанка */
function DashboardSkeleton() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-96 bg-muted/70 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted/50 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const view = useAppStore((s) => s.nav.view);
  const navigate = useAppStore((s) => s.navigate);
  const navParams = useAppStore((s) => s.nav.params);
  const commandPalette = useCommandPaletteShortcut();

  // SEO: per-page title + canonical + og:tags + noindex для dashboard
  useSeoMetadata(view);

  // URL → Store sync: при прямой ссылке (например /about?legal=terms)
  // устанавливаем соответствующий view в store
  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    const search = new URLSearchParams(window.location.search);
    const viewFromUrl = path === "/" ? "home" : path.slice(1);
    const legalParam = search.get("legal");

    // Маппинг URL → view
    const urlToView: Record<string, string> = {
      "": "home",
      "catalog": "catalog",
      "confectioners": "confectioners",
      "recipes": "recipes",
      "recipe-detail": "recipe-detail",
      "blog": "blog",
      "faq": "faq",
      "help": "help",
      "about": "about",
      "contacts": "contacts",
      "checkout": "checkout",
      "dashboard": "dashboard-customer",
      "promotions": "promotions",
      "tenders": "tenders",
      "ready-made": "ready-made",
      "corporate-events": "corporate-events",
      "decor-shop": "decor-shop",
      "services-shop": "services-shop",
      "supplier-shop": "supplier-shop",
      "gift-certificates": "gift-certificates",
      "telegram-bot": "telegram-bot",
      "reviews": "reviews",
      "legal": "legal",
    };

    const targetView = urlToView[viewFromUrl];
    if (targetView && targetView !== view) {
      // Если есть legal параметр для about
      if (viewFromUrl === "about" && legalParam) {
        navigate("about", { legal: legalParam } as any);
      } else if (viewFromUrl === "recipe-detail") {
        navigate("recipe-detail", { id: search.get("id") || "" } as any);
      } else if (viewFromUrl === "product") {
        navigate("product", { id: search.get("id") || "" } as any);
      } else {
        navigate(targetView as any);
      }
    }
  }, []); // только при монтировании

  const renderView = () => {
    switch (view) {
      case "home":
        return <HomePage />;
      case "catalog":
        return <CatalogPage />;
      case "product":
        return <ProductPage />;
      case "confectioners":
        return <ConfectionersPage />;
      case "confectioner-profile":
        return <ConfectionerProfilePage />;
      case "supplier-shop":
        return <SupplierShopPage />;
      case "promotions":
        return <PromotionsPage />;
      case "recipes":
        return <RecipesPage />;
      case "recipe-detail":
        return <RecipeDetailPage />;
      case "corporate-events":
        return <CorporateEventsPage />;
      case "decor-shop":
        return <DecorShopPage />;
      case "services-shop":
        return <ServicesShopPage />;
      case "venues":
        return <VenuesPage />;
      case "gift-certificates":
        return <GiftCertificatesPage />;
      case "telegram-bot":
        return <TelegramBotPage />;
      case "cake-builder":
        return <CakeBuilderPage />;
      case "ready-made":
        return <ReadyMadePage />;
      case "tenders":
        return <TendersPage />;
      case "blog":
        return <BlogPage />;
      case "about":
        // Если есть параметр legal — показываем юридическую страницу
        if (navParams?.legal) {
          return <LegalPage page={navParams.legal as any} />;
        }
        return <AboutPage />;
      case "legal":
        return <LegalPage page={(navParams?.legal as any) || "consent"} />;
      case "contacts":
        return <AboutPage />;
      case "help":
        return <FaqPage />;
      case "reviews":
        return <ReviewsPage />;
      case "for-confectioners":
        return <ForConfectionersPage />;
      case "for-suppliers":
        return <ForSuppliersPage />;
      case "faq":
        return <FaqPage />;
      case "checkout":
        return <CheckoutPage />;
      case "dashboard-customer":
        return <CustomerDashboard />;
      case "dashboard-confectioner":
        return <ConfectionerDashboard />;
      case "dashboard-supplier":
        return <SupplierDashboard />;
      case "dashboard-courier":
        return <CourierDashboard />;
      case "dashboard-admin":
        return <AdminDashboard />;
      case "dashboard-extra":
        return <ExtraDashboards />;
      case "dashboard-venue-owner":
        return <VenueOwnerDashboard />;
      default:
        // Нераспознанные dashboard-view нишевых ролей → их дашборд через roleMap,
        // а не HomePage (раньше падали на главную без объяснений)
        if (view.startsWith("dashboard-")) return <ExtraDashboards />;
        return <HomePage />;
    }
  };

  // Dashboards обычно скрывают публичный header/footer
  const isDashboard = view.startsWith("dashboard-");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">{renderView()}</main>
      {!isDashboard && <Footer />}

      {/* Global overlays */}
      <LiveProductsHydrator />
      <LiveServicesHydrator />
      <LiveDecorHydrator />
      <AuthModal />
      <PromoPopup />
      <CartDrawer />
      <CartSyncHydrator />
      <ChatWidget />
      <CakeBuilderDialog />
      <CommandPalette open={commandPalette.open} onOpenChange={commandPalette.setOpen} />
    </div>
  );
}
