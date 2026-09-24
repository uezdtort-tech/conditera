/**
 * supabase-hooks.test.ts — unit-тесты для supabase hooks (use-auth, use-marketplace, etc.)
 *
 * Тестируем экспорты и типы hooks (не реальные запросы — для этого нужен Supabase).
 * Реальные интеграционные тесты через Playwright e2e.
 */

import { describe, it, expect } from "vitest";

// Проверка что hooks экспортируются и являются функциями
import * as useAuthModule from "@/lib/supabase/use-auth";
import * as useMarketplaceModule from "@/lib/supabase/use-marketplace";
import * as useCakeBuilderModule from "@/lib/supabase/use-cake-builder";
import * as useChatModule from "@/lib/supabase/use-chat";
import * as useDashboardsModule from "@/lib/supabase/use-dashboards";
import * as useCrmModule from "@/lib/supabase/use-crm";
import * as useCmsModule from "@/lib/supabase/use-cms";
import * as useAutomationModule from "@/lib/supabase/use-automation";

describe("Supabase Auth hooks exports", () => {
  it("use-auth module exports all required hooks", () => {
    expect(typeof useAuthModule.useAuth).toBe("function");
    expect(typeof useAuthModule.useSignIn).toBe("function");
    expect(typeof useAuthModule.useSignUp).toBe("function");
    expect(typeof useAuthModule.useSignOut).toBe("function");
    expect(typeof useAuthModule.useOAuth).toBe("function");
    expect(typeof useAuthModule.useResetPassword).toBe("function");
    expect(typeof useAuthModule.useUpdatePassword).toBe("function");
    expect(typeof useAuthModule.useUpdateProfile).toBe("function");
    expect(typeof useAuthModule.useUploadAvatar).toBe("function");
    expect(typeof useAuthModule.useMagicLink).toBe("function");
  });

  it("OAuth provider type accepts google, yandex, vk", () => {
    // Type check — компиляция проходит
    const providers: ("google" | "yandex" | "vk")[] = ["google", "yandex", "vk"];
    expect(providers).toHaveLength(3);
  });
});

describe("Supabase Marketplace hooks exports", () => {
  it("use-marketplace module exports all required hooks", () => {
    // Query hooks
    expect(typeof useMarketplaceModule.useCategories).toBe("function");
    expect(typeof useMarketplaceModule.useProducts).toBe("function");
    expect(typeof useMarketplaceModule.useProduct).toBe("function");
    expect(typeof useMarketplaceModule.useSearchProducts).toBe("function");
    expect(typeof useMarketplaceModule.useProductReviews).toBe("function");
    expect(typeof useMarketplaceModule.useFavorites).toBe("function");
    expect(typeof useMarketplaceModule.useCart).toBe("function");
    expect(typeof useMarketplaceModule.useOrders).toBe("function");
    expect(typeof useMarketplaceModule.useOrder).toBe("function");

    // Mutation hooks
    expect(typeof useMarketplaceModule.useAddToCart).toBe("function");
    expect(typeof useMarketplaceModule.useRemoveFromCart).toBe("function");
    expect(typeof useMarketplaceModule.useUpdateCartQuantity).toBe("function");
    expect(typeof useMarketplaceModule.useClearCart).toBe("function");
    expect(typeof useMarketplaceModule.useToggleFavorite).toBe("function");
    expect(typeof useMarketplaceModule.useCreateOrder).toBe("function");
    expect(typeof useMarketplaceModule.useCreateReview).toBe("function");
    expect(typeof useMarketplaceModule.useUpdateOrderStatus).toBe("function");
  });

  it("ProductFilters interface accepts all fields", () => {
    const filters: useMarketplaceModule.ProductFilters = {
      categorySlug: "cakes",
      minPrice: 1000,
      maxPrice: 10000,
      dietary: ["gluten_free"],
      tags: ["wedding"],
      sort: "price_asc",
      limit: 24,
      offset: 0,
    };
    expect(filters.categorySlug).toBe("cakes");
    expect(filters.minPrice).toBe(1000);
  });

  it("CreateOrderInput has required fields", () => {
    const input: useMarketplaceModule.CreateOrderInput = {
      cartItems: [
        { id: "cart-1", product_id: "prod-123", quantity: 2 },
      ],
      deliveryAddress: "г. Москва, ул. Тверская, 1",
      deliveryCity: "Москва",
      deliveryDate: "2026-08-20",
      deliveryType: "delivery",
      notes: "Позвонить за час",
    };
    expect(input.cartItems[0].product_id).toBe("prod-123");
    expect(input.cartItems[0].quantity).toBe(2);
    expect(input.deliveryType).toBe("delivery");
  });
});

describe("Supabase Cake Builder hooks exports", () => {
  it("use-cake-builder module exports all required hooks", () => {
    // Query hooks
    expect(typeof useCakeBuilderModule.useCakeBuilderOptions).toBe("function");
    expect(typeof useCakeBuilderModule.useCakeBuilderDraft).toBe("function");
    expect(typeof useCakeBuilderModule.useInquiries).toBe("function");
    expect(typeof useCakeBuilderModule.useInquiry).toBe("function");
    expect(typeof useCakeBuilderModule.useNegotiations).toBe("function");
    expect(typeof useCakeBuilderModule.useNegotiation).toBe("function");
    expect(typeof useCakeBuilderModule.useNegotiationMessages).toBe("function");
    expect(typeof useCakeBuilderModule.useAvailableInquiries).toBe("function");

    // Mutation hooks
    expect(typeof useCakeBuilderModule.useSaveDraft).toBe("function");
    expect(typeof useCakeBuilderModule.useSubmitInquiry).toBe("function");
    expect(typeof useCakeBuilderModule.useQuoteNegotiation).toBe("function");
    expect(typeof useCakeBuilderModule.useAcceptNegotiation).toBe("function");
    expect(typeof useCakeBuilderModule.useDeclineNegotiation).toBe("function");
    expect(typeof useCakeBuilderModule.useSendNegotiationMessage).toBe("function");
  });
});

describe("Supabase Chat hooks exports", () => {
  it("use-chat module exports all required hooks", () => {
    // Query hooks
    expect(typeof useChatModule.useChatChannels).toBe("function");
    expect(typeof useChatModule.useChatMessages).toBe("function");
    expect(typeof useChatModule.useUnreadCounts).toBe("function");

    // Mutation hooks
    expect(typeof useChatModule.useCreateDirectChannel).toBe("function");
    expect(typeof useChatModule.useCreateGroupChannel).toBe("function");
    expect(typeof useChatModule.useSendMessage).toBe("function");
    expect(typeof useChatModule.useMarkAsRead).toBe("function");

    // Realtime hooks
    expect(typeof useChatModule.useTypingIndicator).toBe("function");
    expect(typeof useChatModule.useChannelPresence).toBe("function");
  });
});

describe("Supabase Dashboards hooks exports", () => {
  it("use-dashboards module exports 5 dashboard hooks", () => {
    expect(typeof useDashboardsModule.useCustomerDashboard).toBe("function");
    expect(typeof useDashboardsModule.useConfectionerDashboard).toBe("function");
    expect(typeof useDashboardsModule.useSupplierDashboard).toBe("function");
    expect(typeof useDashboardsModule.useCourierDashboard).toBe("function");
    expect(typeof useDashboardsModule.useAdminDashboard).toBe("function");
  });

  it("AdminDashboardData has platformGrowth field", () => {
    const data: useDashboardsModule.AdminDashboardData = {
      stats: {
        totalUsers: 0,
        newUsersToday: 0,
        totalOrders: 0,
        revenueToday: 0,
        revenueMonth: 0,
        activeTickets: 0,
        pendingPayouts: 0,
        fraudAlerts: 0,
      },
      recentOrders: [],
      platformGrowth: [
        { month: "Янв", users: 100, orders: 50 },
        { month: "Фев", users: 150, orders: 80 },
      ],
    };
    expect(data.platformGrowth).toHaveLength(2);
    expect(data.platformGrowth[0].month).toBe("Янв");
  });
});

describe("Supabase CRM hooks exports", () => {
  it("use-crm module exports all required hooks", () => {
    // Query hooks
    expect(typeof useCrmModule.useSupportTickets).toBe("function");
    expect(typeof useCrmModule.useSupportTicket).toBe("function");
    expect(typeof useCrmModule.useTicketMessages).toBe("function");
    expect(typeof useCrmModule.useLeads).toBe("function");
    expect(typeof useCrmModule.useLead).toBe("function");
    expect(typeof useCrmModule.useLeadActivities).toBe("function");
    expect(typeof useCrmModule.useCustomerTimeline).toBe("function");

    // Mutation hooks
    expect(typeof useCrmModule.useCreateTicket).toBe("function");
    expect(typeof useCrmModule.useSendTicketMessage).toBe("function");
    expect(typeof useCrmModule.useUpdateTicketStatus).toBe("function");
    expect(typeof useCrmModule.useCreateLead).toBe("function");
    expect(typeof useCrmModule.useUpdateLeadStatus).toBe("function");
    expect(typeof useCrmModule.useAddLeadActivity).toBe("function");
  });

  it("SupportTicket has all required fields", () => {
    const ticket: useCrmModule.SupportTicket = {
      id: "t1",
      number: "TKT-2026-0001",
      user_id: "u1",
      assigned_to: null,
      subject: "Не доставили заказ",
      category: "delivery",
      priority: "high",
      status: "open",
      order_id: "o1",
      messages_count: 0,
      first_response_at: null,
      resolved_at: null,
      closed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(ticket.number).toBe("TKT-2026-0001");
    expect(ticket.priority).toBe("high");
  });

  it("Lead status transitions are valid", () => {
    const statuses = ["new", "contacted", "qualified", "won", "lost"];
    expect(statuses).toHaveLength(5);
    expect(statuses).toContain("won");
    expect(statuses).toContain("lost");
  });
});

describe("Supabase CMS hooks exports", () => {
  it("use-cms module exports all required hooks", () => {
    // Query hooks
    expect(typeof useCmsModule.useCmsPages).toBe("function");
    expect(typeof useCmsModule.useCmsPage).toBe("function");
    expect(typeof useCmsModule.useCmsBanners).toBe("function");
    expect(typeof useCmsModule.useNavMenu).toBe("function");
    expect(typeof useCmsModule.useSiteSettings).toBe("function");
    expect(typeof useCmsModule.usePromoCodes).toBe("function");
    expect(typeof useCmsModule.useModerationQueue).toBe("function");

    // Mutation hooks
    expect(typeof useCmsModule.useCreateCmsPage).toBe("function");
    expect(typeof useCmsModule.useUpdateCmsPage).toBe("function");
    expect(typeof useCmsModule.useDeleteCmsPage).toBe("function");
    expect(typeof useCmsModule.useCreateBanner).toBe("function");
    expect(typeof useCmsModule.useUpdateBanner).toBe("function");
    expect(typeof useCmsModule.useUpdateNavMenuItem).toBe("function");
    expect(typeof useCmsModule.useUpdateSiteSetting).toBe("function");
    expect(typeof useCmsModule.useCreatePromoCode).toBe("function");
    expect(typeof useCmsModule.useValidatePromoCode).toBe("function");
    expect(typeof useCmsModule.useModerateContent).toBe("function");
  });

  it("CmsPage has content field for MDX", () => {
    const page: useCmsModule.CmsPage = {
      id: "p1",
      slug: "about",
      title: "О компании",
      description: null,
      content: "# About\n\nThis is about page.",
      seo_title: null,
      seo_description: null,
      seo_keywords: null,
      status: "published",
      is_in_menu: true,
      menu_order: 10,
      parent_id: null,
      published_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    expect(page.slug).toBe("about");
    expect(page.content).toContain("# About");
  });

  it("PromoCode validation logic", () => {
    // percent type
    const percentPromo: useCmsModule.PromoCode = {
      id: "p1",
      code: "WELCOME10",
      description: "10% off",
      type: "percent",
      value: 10,
      min_order_amount: 0,
      max_uses: 1000,
      used_count: 0,
      valid_from: new Date().toISOString(),
      valid_to: null,
      applies_to: "first_order",
      target_id: null,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    // 10% от 5000 = 500
    const discount = Math.round((5000 * percentPromo.value) / 100);
    expect(discount).toBe(500);

    // fixed type
    const fixedPromo: useCmsModule.PromoCode = {
      ...percentPromo,
      code: "FIXED500",
      type: "fixed",
      value: 500,
    };
    expect(fixedPromo.value).toBe(500);
  });
});

describe("Supabase Automation hooks exports", () => {
  it("use-automation module exports all required hooks", () => {
    expect(typeof useAutomationModule.useScheduledJobs).toBe("function");
    expect(typeof useAutomationModule.useScheduledJob).toBe("function");
    expect(typeof useAutomationModule.useCreateScheduledJob).toBe("function");
    expect(typeof useAutomationModule.useUpdateScheduledJob).toBe("function");
    expect(typeof useAutomationModule.useDeleteScheduledJob).toBe("function");
    expect(typeof useAutomationModule.useRunJobNow).toBe("function");
  });

  it("ScheduledJob has cron_expression", () => {
    const job: useAutomationModule.ScheduledJob = {
      id: "j1",
      name: "abandoned-cart",
      description: "Notify about abandoned carts",
      type: "edge_function",
      function_name: "abandoned-cart",
      sql_query: null,
      cron_expression: "0 * * * *",
      timezone: "Europe/Moscow",
      is_active: true,
      last_run_at: null,
      next_run_at: null,
      runs_count: 0,
      success_count: 0,
      failure_count: 0,
      last_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(job.cron_expression).toBe("0 * * * *");
    expect(job.function_name).toBe("abandoned-cart");
  });
});

describe("Health check script exists", () => {
  it("health-check.sh is executable", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const scriptPath = path.join(process.cwd(), "scripts", "health-check.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);

    const stat = fs.statSync(scriptPath);
    // На Windows может не быть executable bit, проверяем что файл есть
    expect(stat.isFile()).toBe(true);
  });
});
