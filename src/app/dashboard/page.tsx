"use client";

/**
 * dashboard/page.tsx — main dashboard entry point.
 *
 * Рендерит дашборд в зависимости от роли пользователя (через view в store):
 *   CUSTOMER                → CustomerDashboard
 *   CONFECTIONER, STUDIO    → ConfectionerDashboard
 *   SUPPLIER                → SupplierDashboard
 *   COURIER                 → CourierDashboard
 *   ADMIN, SUPER_ADMIN      → AdminDashboard
 *   RECIPE_DEVELOPER        → RecipeDeveloperDashboard  ← NEW v2.0
 *   LOYALTY_PARTNER         → LoyaltyPartnerDashboard   ← NEW v2.0
 *   Все остальные роли      → ExtraDashboards
 *
 * Использует dynamic imports для code-splitting — каждый дашборд грузится
 * отдельным chunk'ом, что уменьшает initial bundle size.
 */

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SupabaseAuthModal } from "@/components/layout/supabase-auth-modal";
import { SupabaseAuthSync } from "@/components/layout/supabase-auth-sync";
import { PromoPopup } from "@/components/layout/promo-popup";
import { CartDrawer } from "@/components/marketplace/cart-drawer";
import { ChatWidget } from "@/components/chat/chat-widget";
import { CakeBuilderDialog } from "@/components/cake-builder/cake-builder-dialog";
import { useSeoMetadata } from "@/lib/use-seo-metadata";
import dynamic from "next/dynamic";
import type { user_role } from "@/lib/supabase/types";

// Code-split дашборды — каждый грузится отдельным чанком
const CustomerDashboard = dynamic(
  () => import("@/components/dashboard/customer-dashboard").then((m) => m.CustomerDashboard),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const ConfectionerDashboard = dynamic(
  () => import("@/components/dashboard/confectioner-dashboard").then((m) => m.ConfectionerDashboard),
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

// NEW v2.0 — дашборды для новых ролей из PDF-спецификации «Архитектура ролевой экосистемы»
const RecipeDeveloperDashboard = dynamic(
  () =>
    import("@/components/dashboard/recipe-developer-dashboard").then(
      (m) => m.RecipeDeveloperDashboard
    ),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);
const LoyaltyPartnerDashboard = dynamic(
  () =>
    import("@/components/dashboard/loyalty-partner-dashboard").then(
      (m) => m.LoyaltyPartnerDashboard
    ),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

function DashboardSkeleton(): React.JSX.Element {
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

/**
 * Маппинг роли пользователя → view id (используется в store.navigate).
 * Добавлены 2 новые роли v2.0 (RECIPE_DEVELOPER, LOYALTY_PARTNER).
 */
const dashboardByRole: Record<user_role, string> = {
  CUSTOMER: "dashboard-customer",
  CONFECTIONER: "dashboard-confectioner",
  STUDIO: "dashboard-confectioner",
  SUPPLIER: "dashboard-supplier",
  COURIER: "dashboard-courier",
  ADMIN: "dashboard-admin",
  SUPER_ADMIN: "dashboard-admin",
  // NEW v2.0 — отдельные дашборды для новых ролей
  RECIPE_DEVELOPER: "dashboard-recipe-developer",
  LOYALTY_PARTNER: "dashboard-loyalty-partner",
  // Все расширенные и нишевые роли → через ExtraDashboards
  MODERATOR: "dashboard-extra",
  SUPPORT: "dashboard-extra",
  BLOGGER: "dashboard-extra",
  TASTER: "dashboard-extra",
  FRANCHISEE: "dashboard-extra",
  NUTRITIONIST: "dashboard-extra",
  CORPORATE_CLIENT: "dashboard-extra",
  COPYWRITER: "dashboard-extra",
  FOOD_SERVICE: "dashboard-extra",
  EVENT_ORGANIZER: "dashboard-extra",
  PICKUP_POINT: "dashboard-extra",
  WHOLESALER: "dashboard-extra",
  QUALITY_INSPECTOR: "dashboard-extra",
  CERTIFICATION_AGENT: "dashboard-extra",
  VENUE_OWNER: "dashboard-extra",
  ANIMATOR_AGENCY: "dashboard-extra",
  RECREATION_CENTER: "dashboard-extra",
  KIDS_CLUB: "dashboard-extra",
  INSPECTOR: "dashboard-extra",
  GUEST: "dashboard-customer",
  AI_ASSISTANT: "dashboard-extra",
};

export default function DashboardPage(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate);
  const user = useAppStore((s) => s.user);
  const activeRole = useAppStore((s) => s.activeRole);
  const authModalOpen = useAppStore((s) => s.authModalOpen);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const view = useAppStore((s) => s.nav.view);

  useSeoMetadata(view || "dashboard-customer");

  useEffect(() => {
    // Если пользователь не авторизован — открываем модалку логина
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    // Если view ещё не установлен на дашборд — выставляем по роли
    if (!view || !view.startsWith("dashboard-")) {
      const role = (activeRole || user?.roles?.[0] || "CUSTOMER") as user_role;
      const targetView = dashboardByRole[role] || "dashboard-customer";
      navigate(targetView as never);
    }
  }, [user, activeRole, view, navigate, setAuthModalOpen]);

  const renderDashboard = (): React.JSX.Element => {
    switch (view) {
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
      case "dashboard-recipe-developer":
        return <RecipeDeveloperDashboard />;
      case "dashboard-loyalty-partner":
        return <LoyaltyPartnerDashboard />;
      case "dashboard-extra":
        return <ExtraDashboards />;
      default:
        // Если пользователь авторизован, но view ещё не установлен — показываем skeleton
        return <DashboardSkeleton />;
    }
  };

  // Если не залогинен — показываем приглашение войти
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center space-y-6 max-w-md">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <svg
                className="h-10 w-10 text-primary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold mb-2">
                Войдите в личный кабинет
              </h1>
              <p className="text-muted-foreground">
                Личный кабинет доступен только авторизованным пользователям.
                Войдите или зарегистрируйтесь, чтобы получить доступ к заказам,
                профилю и личным кабинетам разных ролей.
              </p>
            </div>
            <button
              onClick={() => setAuthModalOpen(true)}
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Войти / Зарегистрироваться
            </button>
          </div>
        </main>
        <Footer />
        <SupabaseAuthSync />
        <SupabaseAuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
        <PromoPopup />
        <CartDrawer />
        <ChatWidget />
        <CakeBuilderDialog />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1">{renderDashboard()}</main>
      <SupabaseAuthSync />
        <SupabaseAuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      <PromoPopup />
      <CartDrawer />
      <ChatWidget />
      <CakeBuilderDialog />
    </div>
  );
}
