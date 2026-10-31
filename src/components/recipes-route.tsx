"use client";

/**
 * recipes-route.tsx — серверно-корректная оболочка маршрута /recipes.
 *
 * Проблема, которую решает: RouteFallback рендерит SPA-view из zustand-store,
 * а store на сервере всегда в дефолтном 'home' (navigate() — клиентский
 * useEffect). Из-за этого SSR ЛЮБОГО stub-маршрута отдавал HomePage —
 * /recipes выглядел «главной» для краулеров и до гидрации.
 *
 * Решение: /recipes рендерит оболочку приложения (Header/Footer/гидраторы/
 * модалки — тот же состав, что у RouteFallback), но рецептурные view
 * («recipes» / «recipe-detail») — НАПРЯМУЮ, без store-косвенности:
 *   - SSR отдаёт контент рецептов сразу (каталог из /api/recipes/marketplace);
 *   - после монтирования view синхронизируется с store (SPA-навигация из
 *     хедера/футера внутри URL /recipes продолжает работать);
 *   - уход на чужие SPA-view делегируется общему RouteFallback.
 */

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { AuthModal } from "@/components/layout/auth-modal";
import { LiveProductsHydrator } from "@/components/marketplace/live-products-hydrator";
import { LiveServicesHydrator } from "@/components/marketplace/live-services-hydrator";
import { LiveDecorHydrator } from "@/components/marketplace/live-decor-hydrator";
import { PromoPopup } from "@/components/layout/promo-popup";
import { CartDrawer } from "@/components/marketplace/cart-drawer";
import { ChatWidget } from "@/components/chat/chat-widget";
import { CakeBuilderDialog } from "@/components/cake-builder/cake-builder-dialog";
import { RouteFallback } from "@/components/route-fallback";
import { RecipesPage } from "@/components/pages/recipes-catalog";
import { RecipeDetailPage } from "@/components/pages/recipe-detail-page";
import { useSeoMetadata } from "@/lib/use-seo-metadata";

export function RecipesRoute({
  view,
  params,
}: {
  view: "recipes" | "recipe-detail";
  params?: Record<string, string>;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const currentView = useAppStore((s) => s.nav.view);
  const navParams = useAppStore((s) => s.nav.params);

  // Синхронизация store-view с URL (как в RouteFallback) — чтобы SPA-переходы
  // из хедера/футера внутри /recipes работали, и SEO-хук видел актуальный view.
  const [syncedWithStore, setSyncedWithStore] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const search = new URLSearchParams(window.location.search);
      const urlParams: Record<string, string> = {};
      search.forEach((value, key) => {
        urlParams[key] = value;
      });
      navigate(view as never, Object.keys(urlParams).length > 0 ? urlParams : params);
    } else {
      navigate(view as never, params);
    }
    setSyncedWithStore(true);
  }, [view, navigate, params]);

  // До синхронизации (включая SSR) — рецептурный view из пропса (URL-истина),
  // после — следуем за store (SPA-навигация).
  const activeView = syncedWithStore ? currentView : view;
  const effectiveParams = navParams || params;
  const isDashboard = activeView.startsWith("dashboard-");

  useSeoMetadata(activeView);

  const renderView = () => {
    if (!syncedWithStore || activeView === "recipes" || activeView === "recipe-detail") {
      return activeView === "recipe-detail" ? <RecipeDetailPage /> : <RecipesPage />;
    }
    // SPA-переход на чужой view в пределах URL /recipes — общий app shell.
    return <RouteFallback view={activeView as never} params={effectiveParams} />;
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
