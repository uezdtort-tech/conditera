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

  // ===== ZV33-4: surfaced raw status / valid_until / accepted_at / quoted_price =====

  it("ZV33-4: accepted больше не сваливается в quoted — accepted_at surfacится", () => {
    const res = mapApiInquiryToInquiry(
      {
        id: "inq-5",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        servings: 10,
        city: null,
        estimated_price: 200000,
        delivery_date: null,
        comment: null,
        status: "converted", // inquiry закрыт при accept
        negotiations: [
          {
            id: "neg-5",
            confectioner_id: CF_ID,
            status: "accepted",
            quoted_price: 2550000,
            quoted_prep_time: "3 дня",
            valid_until: "2026-11-20T10:00:00.000Z",
            accepted_at: "2026-11-10T09:30:00.000Z",
          },
        ],
      },
      CF_ID
    );
    expect(res.status).toBe("accepted");
    expect(res.rawStatus).toBe("accepted");
    expect(res.quotedPriceKopecks).toBe(2550000);
    expect(res.quotedPriceRub).toBe(25500);
    expect(res.validUntil).toBe("2026-11-20T10:00:00.000Z");
    expect(res.acceptedAt).toBe("2026-11-10T09:30:00.000Z");
    expect(res.quotedPrepTime).toBe("3 дня");
  });

  it("ZV33-4: expired статус surfacится как expired", () => {
    const res = mapApiInquiryToInquiry(
      {
        id: "inq-6",
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
        negotiations: [
          {
            id: "neg-6",
            confectioner_id: CF_ID,
            status: "expired",
            quoted_price: 150000,
            valid_until: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      CF_ID
    );
    expect(res.status).toBe("expired");
    expect(res.rawStatus).toBe("expired");
    expect(res.validUntil).toBe("2026-01-01T00:00:00.000Z");
  });

  it("ZV33-4: counter_offered surfacится, у new нет цены и срока", () => {
    const counter = mapApiInquiryToInquiry(
      {
        id: "inq-7",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        servings: 6,
        city: null,
        estimated_price: null,
        delivery_date: null,
        comment: null,
        status: "open",
        negotiations: [{ id: "neg-7", confectioner_id: CF_ID, status: "counter_offered" }],
      },
      CF_ID
    );
    expect(counter.status).toBe("counter_offered");

    const fresh = mapApiInquiryToInquiry(
      {
        id: "inq-8",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        servings: 6,
        city: null,
        estimated_price: null,
        delivery_date: null,
        comment: null,
        status: "open",
        negotiations: [{ id: "neg-8", confectioner_id: CF_ID, status: "pending_confectioner" }],
      },
      CF_ID
    );
    expect(fresh.status).toBe("new");
    expect(fresh.rawStatus).toBe("pending_confectioner");
    expect(fresh.quotedPriceKopecks).toBeNull();
    expect(fresh.quotedPriceRub).toBeNull();
    expect(fresh.validUntil).toBeNull();
    expect(fresh.acceptedAt).toBeNull();
  });
});
