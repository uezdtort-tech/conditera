'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAppStore } from '@/lib/store';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { AuthModal } from '@/components/layout/auth-modal';
import { LiveProductsHydrator } from '@/components/marketplace/live-products-hydrator';
import { LiveServicesHydrator } from '@/components/marketplace/live-services-hydrator';
import { LiveDecorHydrator } from '@/components/marketplace/live-decor-hydrator';
import { PromoPopup } from '@/components/layout/promo-popup';
import { CartDrawer } from '@/components/marketplace/cart-drawer';
import { ChatWidget } from '@/components/chat/chat-widget';
import { CakeBuilderDialog } from '@/components/cake-builder/cake-builder-dialog';
import type { Role } from '@/lib/types';
import type { LegalPage as LegalPageName } from '@/components/pages/legal-page';

// П.18: SPA-view через lazy-чанки (зеркально app/page.tsx).
// Раньше страницы подключались require() прямо в рендере — из-за этого граф
// модулей КАЖДОГО stub-маршрута включал все страницы приложения и компиляция
// любого маршрута в dev стоила сотни МБ (главный источник OOM-kill в sandbox).
// dynamic() на уровне модуля + ssr по умолчанию (true): SSR активной view
// сохраняется, чанки компилируются лениво.
function PageSkeleton() {
  return (
    <div className="container mx-auto px-4 py-12">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-96 bg-muted/70 rounded" />
      </div>
    </div>
  );
}

const HomePage = dynamic(() => import('@/components/pages/home-page').then((m) => m.HomePage), { loading: () => <PageSkeleton /> });
const CatalogPage = dynamic(() => import('@/components/pages/catalog-page').then((m) => m.CatalogPage), { loading: () => <PageSkeleton /> });
const ProductPage = dynamic(() => import('@/components/pages/product-page').then((m) => m.ProductPage), { loading: () => <PageSkeleton /> });
const ConfectionersPage = dynamic(() => import('@/components/pages/confectioners-page').then((m) => m.ConfectionersPage), { loading: () => <PageSkeleton /> });
const ConfectionerProfilePage = dynamic(() => import('@/components/pages/confectioner-profile-page').then((m) => m.ConfectionerProfilePage), { loading: () => <PageSkeleton /> });
const RecipesPage = dynamic(() => import('@/components/pages/recipes-page').then((m) => m.RecipesPage), { loading: () => <PageSkeleton /> });
const RecipeDetailPage = dynamic(() => import('@/components/pages/recipe-detail-page').then((m) => m.RecipeDetailPage), { loading: () => <PageSkeleton /> });
const LegalPage = dynamic(() => import('@/components/pages/legal-page').then((m) => m.LegalPage), { loading: () => <PageSkeleton /> });
const VenuesPage = dynamic(() => import('@/components/pages/venues-page').then((m) => m.VenuesPage), { loading: () => <PageSkeleton /> });
const CakeBuilderPage = dynamic(() => import('@/components/cake-builder/cake-builder-page').then((m) => m.CakeBuilderPage), { loading: () => <PageSkeleton /> });
const AboutPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.AboutPage), { loading: () => <PageSkeleton /> });
const FaqPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.FaqPage), { loading: () => <PageSkeleton /> });
const ContactsPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.ContactsPage), { loading: () => <PageSkeleton /> });
const ReviewsPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.ReviewsPage), { loading: () => <PageSkeleton /> });
const BlogPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.BlogPage), { loading: () => <PageSkeleton /> });
const CheckoutPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.CheckoutPage), { loading: () => <PageSkeleton /> });
const PromotionsPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.PromotionsPage), { loading: () => <PageSkeleton /> });
const ReadyMadePage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.ReadyMadePage), { loading: () => <PageSkeleton /> });
const TendersPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.TendersPage), { loading: () => <PageSkeleton /> });
const CorporateEventsPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.CorporateEventsPage), { loading: () => <PageSkeleton /> });
const DecorShopPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.DecorShopPage), { loading: () => <PageSkeleton /> });
const ServicesShopPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.ServicesShopPage), { loading: () => <PageSkeleton /> });
const SupplierShopPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.SupplierShopPage), { loading: () => <PageSkeleton /> });
const GiftCertificatesPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.GiftCertificatesPage), { loading: () => <PageSkeleton /> });
const TelegramBotPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.TelegramBotPage), { loading: () => <PageSkeleton /> });
const ForConfectionersPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.ForConfectionersPage), { loading: () => <PageSkeleton /> });
const ForSuppliersPage = dynamic(() => import('@/components/pages/extra-pages').then((m) => m.ForSuppliersPage), { loading: () => <PageSkeleton /> });

const dashboardByRole: Partial<Record<Role, string>> = {
  GUEST: 'home',
  CUSTOMER: 'dashboard-customer',
  CONFECTIONER: 'dashboard-confectioner',
  STUDIO: 'dashboard-confectioner',
  SUPPLIER: 'dashboard-supplier',
  COURIER: 'dashboard-courier',
  ADMIN: 'dashboard-admin',
  SUPER_ADMIN: 'dashboard-admin',
  MODERATOR: 'dashboard-extra',
  SUPPORT: 'dashboard-extra',
  BLOGGER: 'dashboard-extra',
  TASTER: 'dashboard-extra',
  FRANCHISEE: 'dashboard-extra',
  NUTRITIONIST: 'dashboard-extra',
  CORPORATE_CLIENT: 'dashboard-extra',
  COPYWRITER: 'dashboard-extra',
  FOOD_SERVICE: 'dashboard-extra',
  EVENT_ORGANIZER: 'dashboard-extra',
  PICKUP_POINT: 'dashboard-extra',
  WHOLESALER: 'dashboard-extra',
  QUALITY_INSPECTOR: 'dashboard-extra',
  CERTIFICATION_AGENT: 'dashboard-extra',
  VENUE_OWNER: 'dashboard-extra',
  ANIMATOR_AGENCY: 'dashboard-extra',
  RECREATION_CENTER: 'dashboard-extra',
  KIDS_CLUB: 'dashboard-extra',
  INSPECTOR: 'dashboard-extra',
};

/**
 * RouteFallback — рендерит полный app shell + устанавливает view в store.
 *
 * ВАЖНО: этот компонент рендерит тот же контент что и app/page.tsx,
 * потому что Next.js App Router рендерит about/page.tsx отдельно от
 * app/page.tsx. Если показывать только спиннер, контент не появится.
 */
export function RouteFallback({ view, params }: { view: string; params?: Record<string, string> }) {
  const navigate = useAppStore((s) => s.navigate);
  const currentView = useAppStore((s) => s.nav.view);
  const navParams = useAppStore((s) => s.nav.params);

  // Фикс «/recipes показывает главную»: store изначально в дефолтном view 'home',
  // а navigate() вызывается только в useEffect (на клиенте) — из-за этого SSR
  // и первый кадр до гидрации рендерили HomePage для ЛЮБОГО stub-маршрута.
  // Пока store не синхронизирован с URL — рендерим запрошенный view из пропса;
  // после синхронизации следуем за store (SPA-переходы внутри страницы работают).
  const [syncedWithStore, setSyncedWithStore] = useState(false);

  useEffect(() => {
    // Читаем URL params на клиенте
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      const urlParams: Record<string, string> = {};
      search.forEach((value, key) => { urlParams[key] = value; });
      const finalParams = Object.keys(urlParams).length > 0 ? urlParams : params;
      navigate(view as never, finalParams);
    } else {
      navigate(view as never, params);
    }
    setSyncedWithStore(true);
  }, [view, navigate, params]);

  // Активный view: до синхронизации — запрошенный из URL, после — из store.
  const activeView = syncedWithStore ? currentView : view;
  const isDashboard = activeView.startsWith('dashboard-');

  // Используем navParams из store (устанавливается navigate)
  const effectiveParams = navParams || params;

  // Рендерим полный app shell — тот же что и в app/page.tsx
  // Контент берётся из store (currentView)
  const { useSeoMetadata } = require('@/lib/use-seo-metadata');
  useSeoMetadata(activeView as never);

  // Lazy import дашбордов
  const dynamic = require('next/dynamic').default;
  const DashboardSkeleton = () => (
    <div className="container mx-auto px-4 py-12">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-4 w-96 bg-muted/70 rounded" />
      </div>
    </div>
  );

  const CustomerDashboard = dynamic(() => import('@/components/dashboard/customer-dashboard-v2').then((m: any) => m.CustomerDashboardV2), { ssr: false, loading: () => <DashboardSkeleton /> });
  const ConfectionerDashboard = dynamic(() => import('@/components/dashboard/confectioner-dashboard-v2').then((m: any) => m.ConfectionerDashboardV2), { ssr: false, loading: () => <DashboardSkeleton /> });
  const SupplierDashboard = dynamic(() => import('@/components/dashboard/other-dashboards').then((m: any) => m.SupplierDashboard), { ssr: false, loading: () => <DashboardSkeleton /> });
  const CourierDashboard = dynamic(() => import('@/components/dashboard/other-dashboards').then((m: any) => m.CourierDashboard), { ssr: false, loading: () => <DashboardSkeleton /> });
  const AdminDashboard = dynamic(() => import('@/components/dashboard/other-dashboards').then((m: any) => m.AdminDashboard), { ssr: false, loading: () => <DashboardSkeleton /> });
  const ExtraDashboards = dynamic(() => import('@/components/dashboard/extra-dashboards').then((m: any) => m.ExtraDashboards), { ssr: false, loading: () => <DashboardSkeleton /> });

  const renderView = () => {
    switch (activeView) {
      case 'home': return <HomePage />;
      case 'catalog': return <CatalogPage />;
      case 'product': return <ProductPage />;
      case 'confectioners': return <ConfectionersPage />;
      case 'confectioner-profile': return <ConfectionerProfilePage />;
      case 'recipes': return <RecipesPage />;
      case 'recipe-detail': return <RecipeDetailPage />;
      case 'about':
        return effectiveParams?.legal ? <LegalPage page={effectiveParams.legal as LegalPageName} /> : <AboutPage />;
      case 'legal': return <LegalPage page={(effectiveParams?.legal || 'consent') as LegalPageName} />;
      case 'help': return <FaqPage />;
      case 'faq': return <FaqPage />;
      case 'contacts': return <ContactsPage />;
      case 'reviews': return <ReviewsPage />;
      case 'blog': return <BlogPage />;
      case 'checkout': return <CheckoutPage />;
      case 'promotions': return <PromotionsPage />;
      case 'ready-made': return <ReadyMadePage />;
      case 'tenders': return <TendersPage />;
      case 'corporate-events': return <CorporateEventsPage />;
      case 'decor-shop': return <DecorShopPage />;
      case 'services-shop': return <ServicesShopPage />;
      case 'venues': return <VenuesPage />;
      case 'supplier-shop': return <SupplierShopPage />;
      case 'gift-certificates': return <GiftCertificatesPage />;
      case 'telegram-bot': return <TelegramBotPage />;
      case 'cake-builder': return <CakeBuilderPage />;
      case 'for-confectioners': return <ForConfectionersPage />;
      case 'for-suppliers': return <ForSuppliersPage />;
      case 'dashboard-customer': return <CustomerDashboard />;
      case 'dashboard-confectioner': return <ConfectionerDashboard />;
      case 'dashboard-supplier': return <SupplierDashboard />;
      case 'dashboard-courier': return <CourierDashboard />;
      case 'dashboard-admin': return <AdminDashboard />;
      case 'dashboard-extra': return <ExtraDashboards />;
      default:
        // Нераспознанные dashboard-view нишевых ролей → их дашборд (roleMap),
        // а не HomePage
        if (activeView.startsWith('dashboard-')) return <ExtraDashboards />;
        return <HomePage />;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">{renderView()}</main>
      {!isDashboard && <Footer />}
      <LiveProductsHydrator />
      <LiveServicesHydrator />
      <LiveDecorHydrator />
      <AuthModal />
      <PromoPopup />
      <CartDrawer />
      <ChatWidget />
      <CakeBuilderDialog />
    </div>
  );
}

export function DashboardFallback() {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const activeRole = useAppStore((s) => s.activeRole);

  useEffect(() => {
    const role = activeRole || user?.roles?.[0];
    const view = (role && dashboardByRole[role]) || 'dashboard-customer';
    navigate(view as never);
  }, [navigate, user, activeRole]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 p-8">
      <div className="w-16 h-16 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
      <p className="text-sm text-muted-foreground">Открываем личный кабинет…</p>
    </div>
  );
}
