/**
 * Этап 10 §D1: маппер реальных заявок (GET /api/inquiries?filter=available).
 *
 * Проверяются: выбор «своих» переговоров по confectioner_id, конвертация
 * estimated_price из копеек в рубли, статусы new/quoted/declined, дефолты
 * при неполных данных.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  getSessionAuthHeaders: vi.fn().mockResolvedValue({}),
  getCsrfToken: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/lib/store", () => ({
  useAppStore: vi.fn(() => null),
}));

import { mapApiInquiryToInquiry } from "./use-real-inquiries";

const CF_ID = "confectioner-uuid";

describe("mapApiInquiryToInquiry (Этап 10 §D1)", () => {
  it("новая заявка: свои переговоры найдены, копейки → рубли", () => {
    const res = mapApiInquiryToInquiry(
      {
        id: "inq-1",
        user_id: "buyer-1",
        event_type: "kids",
        base: "sponge",
        filling: "Крем-чиз",
        servings: 12,
        city: "Тула",
        estimated_price: 350000, // копейки
        delivery_date: "2026-11-01",
        comment: "Хочу торт с машинкой",
        status: "open",
        customer_name: "Ольга Иванова",
        negotiations: [{ id: "neg-1", confectioner_id: CF_ID, status: "pending_confectioner" }],
      },
      CF_ID
    );
    expect(res).toMatchObject({
      id: "inq-1",
      customerName: "Ольга Иванова",
      budget: 3500,
      status: "new",
      negotiationId: "neg-1",
      servings: 12,
      comment: "Хочу торт с машинкой",
    });
  });

  it("статус quoted, когда переговоры этого кондитера уже с предложением", () => {
    const res = mapApiInquiryToInquiry(
      {
        id: "inq-2",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        servings: null,
        city: null,
        estimated_price: null,
        delivery_date: null,
        comment: null,
        status: "open",
        negotiations: [
          { id: "neg-other", confectioner_id: "someone-else", status: "pending_confectioner" },
          { id: "neg-own", confectioner_id: CF_ID, status: "quoted" },
        ],
      },
      CF_ID
    );
    expect(res.status).toBe("quoted");
    expect(res.negotiationId).toBe("neg-own");
    expect(res.budget).toBe(0);
    expect(res.servings).toBe(8); // дефолт
  });

  it("declined статус и заявка без переговоров — negotiationId null", () => {
    const declined = mapApiInquiryToInquiry(
      {
        id: "inq-3",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        servings: 6,
        city: null,
        estimated_price: 100000,
        delivery_date: null,
        comment: null,
        status: "open",
        negotiations: [{ id: "neg-3", confectioner_id: CF_ID, status: "declined" }],
      },
      CF_ID
    );
    expect(declined.status).toBe("declined");

    const orphan = mapApiInquiryToInquiry(
      {
        id: "inq-4",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        servings: 6,
        city: null,
        estimated_price: 100000,
        delivery_date: null,
        comment: null,
        status: "open",
        negotiations: [],
      },
      CF_ID
    );
    expect(orphan.status).toBe("new");
    expect(orphan.negotiationId).toBeNull();
  });
});
