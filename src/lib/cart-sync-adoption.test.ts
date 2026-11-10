/**
 * Тесты cart-sync.ts — клиентский слой серверной корзины (актуальная
 * бизнес-функциональность; Z-v19 §7).
 *
 * История: старый cart-sync.test.ts (9e6a516) импортировал функции
 * (mergeServerCart, serverToCartItem, CART_SYNC_CAP…), которые НЕ существовали
 * ни в одной версии cart-sync.ts — тест родился сломанным и был удалён в
 * cd0f0e7. Сценарии, которые он ЗАДУМЫВАЛ проверять, сегодня реализованы
 * иначе: server-side merge — planCartMerge (cart-merge.test.ts), клиентский
 * слой — этот файл. Здесь проверяется РЕАЛЬНЫЙ контракт cart-sync:
 *
 *   • восстановление корзины с сервера (adopt: client_ref → itemId);
 *   • custom_config-строка → builder-позиция; битая строка отбрасывается;
 *   • UNION-reconcile: локальная корзина уходит PUT'ом, серверный merged-
 *     результат принимается как канонический;
 *   • diff-синхронизация: upsert (POST, state-абсолютный), setQty (PATCH),
 *     remove (DELETE; 404 = идемпотентный успех);
 *   • анти-утечка корзины между аккаунтами (cart-owner в localStorage);
 *   • cap 50 позиций (CartMergeInputSchema — серверная граница, сценарий
 *     "cap 50" из удалённого теста).
 */
// @vitest-environment jsdom — cart-sync активируется только в браузерном
// рантайме (window/localStorage), тестируем именно его.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  getCsrfToken: async () => "csrf-test-token",
  getSessionAuthHeaders: async () => ({ "X-CSRF-Token": "csrf-test-token" }),
}));

import { useAppStore } from "@/lib/store";
import { startCartSync, stopCartSyncForTests } from "./cart-sync";
import { CartMergeInputSchema, MAX_CART_ITEMS } from "./cart-merge";
import type { CartItem } from "@/lib/types";

const PID = "22222222-2222-4222-8222-222222222222";
const UID = "user-aaaa-1111";
const UID2 = "user-bbbb-2222";

function localItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    itemId: `ci_local_${Math.random().toString(36).slice(2, 8)}`,
    productId: PID,
    title: "Медовик",
    image: "/img.jpg",
    price: 1500,
    quantity: 1,
    confectionerId: "c1",
    ...overrides,
  };
}

function serverRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `row-${Math.random().toString(36).slice(2, 8)}`,
    client_ref: `ci_srv_${Math.random().toString(36).slice(2, 8)}`,
    product_id: PID,
    quantity: 2,
    selected_attributes: { filling: "Сгущёнка" },
    custom_config: null,
    notes: null,
    product: { id: PID, title: "Медовик (сервер)", price: 1500, images: ["/srv.jpg"] },
    ...overrides,
  };
}

function testUser(id: string) {
  return {
    id,
    email: `${id}@test.local`,
    name: "Test",
    roles: ["CLIENT"] as never[],
    createdAt: new Date().toISOString(),
  };
}

/** Дождаться, пока condition станет истинным (real timers). */
async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Ответ fetch по умолчанию: csrf OK, cart пуст, PUT эхо-merge. */
function defaultFetchRouting() {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (url === "/api/csrf-token") {
      return { ok: true, status: 200, json: async () => ({ token: "t" }) };
    }
    if (url === "/api/cart") {
      if (method === "GET") return { ok: true, status: 200, json: async () => ({ items: [] }) };
      if (method === "PUT") return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  defaultFetchRouting();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  localStorage.clear();
  localStorage.setItem("conditera:cart-owner", UID); // владелец текущей сессии
  useAppStore.setState({
    user: testUser(UID),
    cart: [],
    isAuthenticated: true,
  } as never);
});

afterEach(() => {
  stopCartSyncForTests();
  vi.restoreAllMocks();
});

describe("cart-sync: восстановление с сервера (adopt)", () => {
  it("локально пусто → серверные строки принимаются, client_ref становится itemId", async () => {
    const row = serverRow({ client_ref: "ci_srv_fixed_ref" });
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/csrf-token") {
        return { ok: true, status: 200, json: async () => ({ token: "t" }) };
      }
      if (url === "/api/cart" && (init?.method ?? "GET") === "GET") {
        return { ok: true, status: 200, json: async () => ({ items: [row] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    startCartSync();
    await waitFor(() => useAppStore.getState().cart.length === 1);

    const item = useAppStore.getState().cart[0];
    // «dbId propagation» из старого теста: серверный client_ref = идентичность позиции
    expect(item.itemId).toBe("ci_srv_fixed_ref");
    expect(item.productId).toBe(PID);
    expect(item.quantity).toBe(2);
    expect(item.customization?.filling).toBe("Сгущёнка");
    expect(item.title).toBe("Медовик (сервер)");
  });

  it("custom_config-строка → builder-позиция (productId пуст, есть custom.config)", async () => {
    const config = {
      productType: "cake",
      levels: [{ diameterCm: 16, heightCm: 8, flavorId: "f1", fillingId: "ff1" }],
    };
    const row = serverRow({
      product_id: null,
      selected_attributes: null,
      custom_config: config,
      client_ref: "ci_srv_custom",
    });
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/cart" && (init?.method ?? "GET") === "GET") {
        return { ok: true, status: 200, json: async () => ({ items: [row] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    startCartSync();
    await waitFor(() => useAppStore.getState().cart.length === 1);

    const item = useAppStore.getState().cart[0];
    expect(item.itemId).toBe("ci_srv_custom");
    expect(item.productId).toBe("");
    expect(item.custom?.config).toEqual(config);
    // цена строится по конфигу (calculateBuilderPrice), не падает
    expect(typeof item.price).toBe("number");
    expect(Number.isFinite(item.price)).toBe(true);
  });

  it("битая строка (нет product_id и custom_config) отбрасывается, не падая", async () => {
    const broken = serverRow({ product_id: null, custom_config: null });
    const good = serverRow({ client_ref: "ci_srv_good" });
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/cart" && (init?.method ?? "GET") === "GET") {
        return { ok: true, status: 200, json: async () => ({ items: [broken, good] }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    startCartSync();
    await waitFor(() => useAppStore.getState().cart.length === 1);
    expect(useAppStore.getState().cart[0].itemId).toBe("ci_srv_good");
  });
});

describe("cart-sync: UNION-reconcile и diff-синхронизация", () => {
  it("локальная корзина не пуста при старте → PUT-merge, серверный ответ каноничен", async () => {
    const local = localItem({ itemId: "ci_local_1", quantity: 3 });
    useAppStore.setState({ cart: [local] } as never);
    const merged = [serverRow({ client_ref: "ci_local_1", quantity: 5 })];
    let putBody: unknown = null;
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === "/api/cart" && init?.method === "PUT") {
        putBody = JSON.parse(init.body ?? "{}");
        return { ok: true, status: 200, json: async () => ({ items: merged }) };
      }
      if (url === "/api/csrf-token") {
        return { ok: true, status: 200, json: async () => ({ token: "t" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    startCartSync();
    await waitFor(() => putBody !== null);
    // UNION: локальная позиция уходит на сервер с client_ref и полным снимком
    const body = putBody as { items: Array<{ client_ref: string; quantity: number }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].client_ref).toBe("ci_local_1");
    expect(body.items[0].quantity).toBe(3);
    // серверный merged-ответ принят как канонический (quantity 5)
    await waitFor(() => useAppStore.getState().cart[0]?.quantity === 5);
  });

  it("добавление позиции → POST /api/cart с client_ref (state-абсолютный upsert)", async () => {
    startCartSync();
    await new Promise((r) => setTimeout(r, 450)); // стартовый reconcile уходит
    fetchMock.mockClear();
    defaultFetchRouting();

    const item = localItem({ itemId: "ci_new_1" });
    useAppStore.setState({ cart: [item] } as never);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(
        ([u, i]) => u === "/api/cart" && (i as { method?: string })?.method === "POST"
      );
      return calls.length > 0;
    });
    const post = fetchMock.mock.calls.find(
      ([u, i]) => u === "/api/cart" && (i as { method?: string })?.method === "POST"
    );
    const body = JSON.parse((post?.[1] as { body: string }).body);
    expect(body.client_ref).toBe("ci_new_1");
    expect(body.quantity).toBe(1);
  });

  it("изменение количества → PATCH /api/cart/[ref] с итоговым значением", async () => {
    startCartSync();
    await new Promise((r) => setTimeout(r, 450));
    fetchMock.mockClear();
    defaultFetchRouting();

    useAppStore.setState({
      cart: [localItem({ itemId: "ci_q_1", quantity: 1 })],
    } as never);
    await waitFor(() => {
      return fetchMock.mock.calls.some(
        ([u, i]) => u === "/api/cart" && (i as { method?: string })?.method === "POST"
      );
    });
    fetchMock.mockClear();
    defaultFetchRouting();

    useAppStore.setState({
      cart: [localItem({ itemId: "ci_q_1", quantity: 7 })],
    } as never);
    await waitFor(() => {
      return fetchMock.mock.calls.some(
        ([u]) => u === "/api/cart/ci_q_1"
      );
    });
    const patch = fetchMock.mock.calls.find(([u]) => u === "/api/cart/ci_q_1");
    const body = JSON.parse((patch?.[1] as { body: string }).body);
    expect((patch?.[1] as { method: string }).method).toBe("PATCH");
    expect(body.quantity).toBe(7);
  });

  it("удаление одной из двух позиций → DELETE по ref; 404 = идемпотентный успех", async () => {
    startCartSync();
    await new Promise((r) => setTimeout(r, 450));
    fetchMock.mockClear();
    defaultFetchRouting();

    useAppStore.setState({
      cart: [localItem({ itemId: "ci_del_1" }), localItem({ itemId: "ci_del_2" })],
    } as never);
    await waitFor(() =>
      fetchMock.mock.calls.filter(
        ([u, i]) => u === "/api/cart" && (i as { method?: string })?.method === "POST"
      ).length >= 2
    );
    fetchMock.mockClear();
    // сервер «не знает» позицию → 404
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/csrf-token") {
        return { ok: true, status: 200, json: async () => ({ token: "t" }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // остаётся только ci_del_2 → ci_del_1 удаляется
    useAppStore.setState({
      cart: [localItem({ itemId: "ci_del_2" })],
    } as never);
    await waitFor(() =>
      fetchMock.mock.calls.some(([u]) => u === "/api/cart/ci_del_1")
    );
    const del = fetchMock.mock.calls.find(([u]) => u === "/api/cart/ci_del_1");
    expect((del?.[1] as { method: string }).method).toBe("DELETE");
    // 404 не должен вызвать ретраев (идемпотентный успех) — ровно один DELETE
    await new Promise((r) => setTimeout(r, 100));
    const deleteCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/cart/ci_del_1");
    expect(deleteCalls.length).toBe(1);
  });

  it("очистка корзины → DELETE /api/cart (clear), а не per-ref удаления", async () => {
    startCartSync();
    await new Promise((r) => setTimeout(r, 450));
    fetchMock.mockClear();
    defaultFetchRouting();

    useAppStore.setState({ cart: [localItem({ itemId: "ci_clr_1" })] } as never);
    await waitFor(() =>
      fetchMock.mock.calls.some(
        ([u, i]) => u === "/api/cart" && (i as { method?: string })?.method === "POST"
      )
    );
    fetchMock.mockClear();
    defaultFetchRouting();

    useAppStore.setState({ cart: [] } as never);
    await waitFor(() =>
      fetchMock.mock.calls.some(
        ([u, i]) => u === "/api/cart" && (i as { method?: string })?.method === "DELETE"
      )
    );
    expect(fetchMock.mock.calls.some(([u]) => u === "/api/cart/ci_clr_1")).toBe(false);
  });
});

describe("cart-sync: анти-утечка корзины между аккаунтами", () => {
  it("смена пользователя на ДРУГОГО владельца localStorage → локальная корзина очищается", async () => {
    startCartSync();
    await new Promise((r) => setTimeout(r, 450));
    useAppStore.setState({ cart: [localItem({ itemId: "ci_priv_1" })] } as never);

    // login ДРУГОГО аккаунта: prevOwner=UID в localStorage, новый UID2
    useAppStore.setState({ user: testUser(UID2) } as never);

    await waitFor(() => useAppStore.getState().cart.length === 0);
    expect(localStorage.getItem("conditera:cart-owner")).toBe(UID2);
  });

  it("logout → очередь сброшена, локальная корзина гостя сохраняется", async () => {
    startCartSync();
    await new Promise((r) => setTimeout(r, 450));
    useAppStore.setState({ cart: [localItem({ itemId: "ci_guest_1" })] } as never);

    useAppStore.setState({ user: null } as never);
    // корзина остаётся (гостевое поведение), не очищается
    await new Promise((r) => setTimeout(r, 150));
    expect(useAppStore.getState().cart).toHaveLength(1);
  });
});

describe("cap 50 позиций (сценарий удалённого теста, серверная граница)", () => {
  it("CartMergeInputSchema: 50 позиций валидно, 51 — отказ", () => {
    const mk = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        client_ref: `ref_${i}`,
        product_id: PID,
        quantity: 1,
      }));
    expect(MAX_CART_ITEMS).toBe(50);
    const ok = CartMergeInputSchema.safeParse({ items: mk(50) });
    const bad = CartMergeInputSchema.safeParse({ items: mk(51) });
    expect(ok.success).toBe(true);
    expect(bad.success).toBe(false);
  });
});
