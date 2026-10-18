/**
 * Этап 10 §C1: per-user защита промокодов.
 *
 * promo_code_usages (миграция 0005) существовала, но кодом не читалась и не
 * писалась — один пользователь мог применять персональный маркетинг-код
 * многократно. Проверяются:
 *  • первый раз — валиден;
 *  • повторное применение тем же пользователем — отказ;
 *  • applies_to='first_order' при наличии прошлых заказов — отказ;
 *  • applies_to='first_order' без прошлых заказов — валиден;
 *  • другой пользователь тем же кодом — валиден;
 *  • запись журнала использования в applyPromoCodeToOrder (сумма в копейках).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const promoRow = {
  id: "promo-uuid-1",
  code: "WELCOME10",
  type: "percent",
  value: 10,
  min_order_amount: 0,
  max_uses: 100,
  used_count: 3,
  valid_from: null,
  valid_to: null,
  is_active: true,
  applies_to: "all",
};

let usageRows: Array<{ id: string; user_id?: string; promo_code_id?: string }> = [];
let priorOrderRows: unknown[] = [];
const usageInserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === "promo_codes") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { ...promoRow }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "promo_code_usages") {
        // эмулируем фильтры eq(col, value) для select-цепочек
        const makeSelect = () => {
          const filters: Record<string, unknown> = {};
          const b = {
            eq: (col: string, val: unknown) => {
              filters[col] = val;
              return b;
            },
            limit: () => {
              const filtered = usageRows.filter(
                (r) =>
                  (filters.user_id === undefined ||
                    (r as { user_id?: string }).user_id === filters.user_id) &&
                  (filters.promo_code_id === undefined ||
                    (r as { promo_code_id?: string }).promo_code_id === filters.promo_code_id)
              );
              return Promise.resolve({ data: filtered, error: null });
            },
          };
          return b;
        };
        return {
          select: makeSelect,
          insert: (payload: Record<string, unknown>) => {
            usageInserts.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "orders") {
        return {
          select: () => {
            const b = {
              eq: (_col: string, _val: unknown) => b,
              limit: () => Promise.resolve({ data: priorOrderRows, error: null }),
            };
            return b;
          },
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      return {
        select: () => Promise.resolve({ data: [], error: null }),
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
}));

import { validatePromoCode, applyPromoCodeToOrder } from "./promo-codes";

const BASE_PARAMS = {
  code: "WELCOME10",
  userId: "user-A",
  userRoles: ["CUSTOMER"],
  orderAmount: 5000,
};

beforeEach(() => {
  usageRows = [];
  priorOrderRows = [];
  usageInserts.length = 0;
  promoRow.applies_to = "all";
});

describe("validatePromoCode — per-user защита (Этап 10 §C1)", () => {
  it("первое применение пользователем валидно", async () => {
    const res = await validatePromoCode(BASE_PARAMS);
    expect(res.valid).toBe(true);
    expect(res.promoCodeId).toBe("promo-uuid-1");
    expect(res.discountRub).toBe(500); // 10% от 5000
  });

  it("повторное применение тем же пользователем — отказ", async () => {
    usageRows = [{ id: "usage-1", user_id: "user-A", promo_code_id: "promo-uuid-1" }];
    const res = await validatePromoCode(BASE_PARAMS);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("Этот промокод уже был использован");
  });

  it("другой пользователь тем же кодом — валиден", async () => {
    usageRows = [{ id: "usage-1", user_id: "user-A", promo_code_id: "promo-uuid-1" }];
    const res = await validatePromoCode({ ...BASE_PARAMS, userId: "user-B" });
    expect(res.valid).toBe(true);
  });

  it("applies_to=first_order при наличии прошлых заказов — отказ", async () => {
    promoRow.applies_to = "first_order";
    priorOrderRows = [{ id: "order-old" }];
    const res = await validatePromoCode(BASE_PARAMS);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("Промокод действует только на первый заказ");
  });

  it("applies_to=first_order без прошлых заказов — валиден", async () => {
    promoRow.applies_to = "first_order";
    priorOrderRows = [];
    const res = await validatePromoCode(BASE_PARAMS);
    expect(res.valid).toBe(true);
  });
});

describe("applyPromoCodeToOrder — журнал promo_code_usages (Этап 10 §C1)", () => {
  it("записывает использование (сумма в копейках, привязка к заказу и пользователю)", async () => {
    await applyPromoCodeToOrder({
      code: "WELCOME10",
      promoCodeId: "promo-uuid-1",
      orderId: "order-1",
      discountRub: 500,
      userId: "user-A",
    });
    expect(usageInserts).toHaveLength(1);
    expect(usageInserts[0]).toMatchObject({
      promo_code_id: "promo-uuid-1",
      user_id: "user-A",
      order_id: "order-1",
      discount_amount: 50000, // рубли → копейки (схема 0005)
    });
  });

  it("без userId журнал не пишется (совместимость со старыми вызовами)", async () => {
    await applyPromoCodeToOrder({
      code: "WELCOME10",
      promoCodeId: "promo-uuid-1",
      orderId: "order-1",
      discountRub: 500,
    });
    expect(usageInserts).toHaveLength(0);
  });
});
