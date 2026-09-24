'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { AuthModal } from '@/components/layout/auth-modal';
import { LiveProductsHydrator } from '@/components/marketplace/live-products-hydrator';
import { LiveServicesHydrator } from '@/components/marketplace/live-services-hydrator';
import { PromoPopup } from '@/components/layout/promo-popup';
import { CartDrawer } from '@/components/marketplace/cart-drawer';
import { ChatWidget } from '@/components/chat/chat-widget';
import { CakeBuilderDialog } from '@/components/cake-builder/cake-builder-dialog';
import { CakeBuilderPage } from '@/components/cake-builder/cake-builder-page';
import type { Role } from '@/lib/types';

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
  const isDashboard = currentView.startsWith('dashboard-');

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
  }, [view, navigate, params]);

  // Используем navParams из store (устанавливается navigate)
  const effectiveParams = navParams || params;

  // Рендерим полный app shell — тот же что и в app/page.tsx
  // Контент берётся из store (currentView)
  const { useSeoMetadata } = require('@/lib/use-seo-metadata');
  useSeoMetadata(currentView);

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

  // Импортируем страницы
  const pages = require('@/components/pages/extra-pages');
  const { HomePage } = require('@/components/pages/home-page');
  const { CatalogPage } = require('@/components/pages/catalog-page');
  const { VenuesPage } = require('@/components/pages/venues-page');
  const { ProductPage } = require('@/components/pages/product-page');
  const { ConfectionersPage } = require('@/components/pages/confectioners-page');
  const { ConfectionerProfilePage } = require('@/components/pages/confectioner-profile-page');
  const { RecipesPage } = require('@/components/pages/recipes-page');
  const { RecipeDetailPage } = require('@/components/pages/recipe-detail-page');
  const { LegalPage } = require('@/components/pages/legal-page');

  const renderView = () => {
    switch (currentView) {
      case 'home': return <HomePage />;
      case 'catalog': return <CatalogPage />;
      case 'product': return <ProductPage />;
      case 'confectioners': return <ConfectionersPage />;
      case 'confectioner-profile': return <ConfectionerProfilePage />;
      case 'recipes': return <RecipesPage />;
      case 'recipe-detail': return <RecipeDetailPage />;
      case 'about':
        return effectiveParams?.legal ? <LegalPage page={effectiveParams.legal} /> : <pages.AboutPage />;
      case 'legal': return <LegalPage page={effectiveParams?.legal || 'consent'} />;
      case 'help': return <pages.FaqPage />;
      case 'faq': return <pages.FaqPage />;
      case 'contacts': return <pages.ContactsPage />;
      case 'reviews': return <pages.ReviewsPage />;
      case 'blog': return <pages.BlogPage />;
      case 'checkout': return <pages.CheckoutPage />;
      case 'promotions': return <pages.PromotionsPage />;
      case 'ready-made': return <pages.ReadyMadePage />;
      case 'tenders': return <pages.TendersPage />;
      case 'corporate-events': return <pages.CorporateEventsPage />;
      case 'decor-shop': return <pages.DecorShopPage />;
      case 'services-shop': return <pages.ServicesShopPage />;
      case 'venues': return <VenuesPage />;
      case 'supplier-shop': return <pages.SupplierShopPage />;
      case 'gift-certificates': return <pages.GiftCertificatesPage />;
      case 'telegram-bot': return <pages.TelegramBotPage />;
      case 'cake-builder': return <CakeBuilderPage />;
      case 'for-confectioners': return <pages.ForConfectionersPage />;
      case 'for-suppliers': return <pages.ForSuppliersPage />;
      case 'dashboard-customer': return <CustomerDashboard />;
      case 'dashboard-confectioner': return <ConfectionerDashboard />;
      case 'dashboard-supplier': return <SupplierDashboard />;
      case 'dashboard-courier': return <CourierDashboard />;
      case 'dashboard-admin': return <AdminDashboard />;
      case 'dashboard-extra': return <ExtraDashboards />;
      default:
        // Нераспознанные dashboard-view нишевых ролей → их дашборд (roleMap),
        // а не HomePage
        if (view.startsWith('dashboard-')) return <ExtraDashboards />;
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
