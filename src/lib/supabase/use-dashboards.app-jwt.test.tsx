/**
 * use-dashboards.app-jwt.test.tsx — кабинеты покупателя/поставщика/курьера/админа
 * на едином app-JWT (консолидация авторизации после 0a8de5d).
 *
 * Контракт:
 *   - источник истины — app-сессия (cd_access_token в sessionStorage, Bearer);
 *     GoTrue (supabaseBrowser.auth.getUser()) в локальном runtime всегда пуст,
 *     поэтому мёртвый GoTrue-гейт больше не используется ни в одном хуке;
 *   - GET-запросы идут через /rest/v1 (PostgREST-шим) с Bearer app-JWT:
 *     роль authenticated, sub=auth.uid() → RLS;
 *   - выборки ограничены владельцем (user_id/confectioner_id/courier_id/owner_id);
 *   - 401 → один авто-refresh (POST /api/auth/refresh) + один повтор;
 *   - без валидной app-сессии — «Не авторизован» и ни одного запроса.
 *
 * Регрессия: inventory_items не имеет колонки confectioner_id — склад
 * поставщика читается по owner_id (RLS inventory_own).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

import {
  useCustomerDashboard,
  useSupplierDashboard,
  useCourierDashboard,
  useAdminDashboard,
} from "./use-dashboards";
import { ACCESS_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const USER_ID = "11111111-1111-4111-8111-111111111106";

/** app-JWT (HS256-подобный формат): header.payload.signature — payload с userId. */
function makeAppJwt(userId: string): string {
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ userId, email: "u@demo.ru" })}.sig`;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/** Обёртка: queries без retry — сетевые сбои не маскируются. */
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function urlsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call: unknown[]) => String(call[0]));
}

function bearerOf(fetchMock: ReturnType<typeof vi.fn>): string {
  const call = fetchMock.mock.calls[0] as unknown[];
  const headers = (call[1] as { headers: Record<string, string> }).headers;
  return headers?.Authorization || "";
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCustomerDashboard — app-JWT вместо мёртвого GoTrue-гейта", () => {
  it("без app-сессии — «Не авторизован», ни одного запроса", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCustomerDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe("Не авторизован");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("с app-сессией — Bearer-запросы по своему user_id, статы посчитаны", async () => {
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, makeAppJwt(USER_ID));
    const fetchMock = vi.fn((url: string) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname.endsWith("/rest/v1/orders")) {
        if (u.searchParams.get("select") === "total,status") {
          return Promise.resolve(
            okResponse([
              { total: 3500, status: "COMPLETED" },
              { total: 1200, status: "PENDING" },
            ])
          );
        }
        return Promise.resolve(
          okResponse([
            {
              id: "o1",
              number: "UK-2026-985818",
              total: 1200,
              status: "PENDING",
              created_at: "2026-11-01T10:00:00Z",
              items: [{ product_title: "Торт", quantity: 1 }],
            },
          ])
        );
      }
      if (u.pathname.endsWith("/rest/v1/product_favorites")) {
        return Promise.resolve(
          okResponse([{ id: "f1", product_id: "p1", product: { id: "p1", title: "Эклер", price: 300 } }])
        );
      }
      if (u.pathname.endsWith("/rest/v1/inquiries")) {
        return Promise.resolve(okResponse([]));
      }
      if (u.pathname.endsWith("/rest/v1/negotiations")) {
        return Promise.resolve(okResponse([{ id: "n1", status: "quoted" }]));
      }
      if (u.pathname.endsWith("/rest/v1/profiles")) {
        return Promise.resolve(okResponse([{ bonus_balance: 150, loyalty_level: "SILVER" }]));
      }
      return Promise.resolve(errResponse(404, { message: "unexpected " + url }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCustomerDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Bearer app-JWT в заголовках
    expect(bearerOf(fetchMock)).toBe(`Bearer ${makeAppJwt(USER_ID)}`);
    // владелец-фильтр: единственный user_id в запросах — свой (нет чужих id)
    const urls = urlsOf(fetchMock);
    expect(urls.some((u) => u.includes(`user_id=eq.${USER_ID}`))).toBe(true);
    const userIds = urls.flatMap((u) => [...new URL(u, "http://localhost").searchParams.getAll("user_id")].map((v) => v.replace("eq.", "")));
    expect(userIds.length).toBeGreaterThan(0);
    expect(new Set(userIds)).toEqual(new Set([USER_ID]));
    // GoTrue-канал не используется
    expect(urls.join("")).not.toContain("auth/v1");
    // данные и статы
    expect(result.current.data?.stats.completedOrders).toBe(1);
    expect(result.current.data?.stats.totalSpent).toBe(3500);
    expect(result.current.data?.stats.activeOrders).toBe(1);
    expect(result.current.data?.stats.bonusBalance).toBe(150);
    expect(result.current.data?.stats.loyaltyLevel).toBe("SILVER");
    expect(result.current.data?.recentOrders[0]?.number).toBe("UK-2026-985818");
    expect(result.current.data?.favorites[0]?.product?.title).toBe("Эклер");
  });
});

describe("useSupplierDashboard — склад по owner_id (регрессия)", () => {
  it("inventory_items запрашивается по owner_id, а не по несуществующей confectioner_id", async () => {
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, makeAppJwt(USER_ID));
    const fetchMock = vi.fn((url: string) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname.endsWith("/rest/v1/inventory_items")) {
        return Promise.resolve(
          okResponse([{ id: "i1", quantity: 2, cost_per_unit: 100, min_quantity: 5 }])
        );
      }
      if (u.pathname.endsWith("/rest/v1/products")) return Promise.resolve(okResponse([]));
      if (u.pathname.endsWith("/rest/v1/orders")) return Promise.resolve(okResponse([]));
      return Promise.resolve(errResponse(404, { message: "unexpected " + url }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSupplierDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invUrl = urlsOf(fetchMock).find((u) => u.includes("/rest/v1/inventory_items")) || "";
    expect(invUrl).toContain(`owner_id=eq.${USER_ID}`);
    expect(invUrl).not.toContain("confectioner_id");
    // lowStockItems: quantity(2) <= min_quantity(5)
    expect(result.current.data?.stats.lowStockItems).toBe(1);
  });

  it("доход = сумма succeeded-платежей по заказам поставщика", async () => {
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, makeAppJwt(USER_ID));
    const fetchMock = vi.fn((url: string) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname.endsWith("/rest/v1/orders")) {
        return Promise.resolve(
          okResponse([
            { id: "o1", number: "N1", total: 900, status: "CONFIRMED", created_at: "2026-11-01", items: [{}] },
          ])
        );
      }
      if (u.pathname.endsWith("/rest/v1/payments")) {
        return Promise.resolve(okResponse([{ amount: 900 }]));
      }
      if (u.pathname.endsWith("/rest/v1/products")) return Promise.resolve(okResponse([]));
      if (u.pathname.endsWith("/rest/v1/inventory_items")) return Promise.resolve(okResponse([]));
      return Promise.resolve(errResponse(404, { message: "unexpected " + url }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSupplierDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(urlsOf(fetchMock).join("")).toContain("status=eq.succeeded");
    expect(result.current.data?.stats.revenue).toBe(900);
    expect(result.current.data?.stats.activeOrders).toBe(1);
  });
});

describe("useCourierDashboard — доставки только свои", () => {
  it("без app-сессии — «Не авторизован»", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCourierDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Не авторизован");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("загружает активные доставки через серверный app-session endpoint", async () => {
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, makeAppJwt(USER_ID));
    const todayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/courier/dashboard") {
        return Promise.resolve(okResponse({
          stats: {
            activeDeliveries: 1,
            completedToday: 1,
            earningsToday: 300,
            earningsMonth: 300,
            rating: 5,
          },
          activeDeliveries: [{
            id: "d1",
            orderId: "o1",
            address: "ул. Ленина, 1",
            status: "assigned",
            deliveryTime: null,
            cost: 400,
            earnings: 200,
          }],
          history: [{
            id: "d2",
            orderId: "o2",
            address: "ул. Мира, 2",
            completedAt: todayIso,
            earnings: 300,
          }],
        }));
      }
      return Promise.resolve(errResponse(404, { message: "unexpected " + url }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCourierDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(urlsOf(fetchMock)).toContain("/api/courier/dashboard");
    expect(result.current.data?.activeDeliveries).toHaveLength(1);
    expect(result.current.data?.activeDeliveries[0]?.order_id).toBe("o1");
    expect(result.current.data?.stats.completedToday).toBe(1);
    expect(result.current.data?.stats.earningsToday).toBe(300);
    expect(result.current.data?.recentCompleted[0]?.courier_earnings).toBe(300);
  });});

describe("useAdminDashboard — серверная проверка роли", () => {
  it("данные с /api/admin/dashboard, маппинг customer_email (fallback customer)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        stats: { totalUsers: 19, newUsersToday: 0, totalOrders: 2, revenueToday: 0, revenueMonth: 0, activeTickets: 0, pendingPayouts: 0, fraudAlerts: 0 },
        recentOrders: [
          { id: "o1", number: "N1", customer: "user@demo.ru", total: 1200, status: "PENDING", created_at: "2026-11-01" },
        ],
        platformGrowth: [],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/admin/dashboard");
    expect(result.current.data?.recentOrders[0]?.customer_email).toBe("user@demo.ru");
  });

  it("HTTP 403 (роль не админ) → ошибка, данные не рендерятся", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(403, { error: "Forbidden" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("403");
  });
});

describe("Истёкшая сессия — авто-refresh и повтор", () => {
  it("401 → POST /api/auth/refresh → повтор с новым Bearer", async () => {
    const NEW_TOKEN = makeAppJwt(USER_ID);
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, makeAppJwt(USER_ID));
    const fetchMock = vi.fn((url: string) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname === "/api/auth/refresh") {
        return Promise.resolve(okResponse({ accessToken: NEW_TOKEN }));
      }
      // GET /rest/v1/deliveries: до refresh — 401, после — 200
      const seenRefresh = fetchMock.mock.calls.some(
        (call: unknown[]) => String(call[0]).includes("/api/auth/refresh")
      );
      if (seenRefresh) return Promise.resolve(okResponse([]));
      return Promise.resolve(errResponse(401, { message: "JWT expired" }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCourierDashboard(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(urlsOf(fetchMock)).toContain("/api/auth/refresh");
    // после refresh повтор успешен
    expect(result.current.data?.activeDeliveries).toEqual([]);
  });
});
