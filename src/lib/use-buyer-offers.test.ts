/**
 * ZV33-4: тесты маппера покупательских предложений (use-buyer-offers.ts).
 *
 * Проверяются: статусы переговоров → UI-статусы, клиентское определение
 * истечения (valid_until < now), конвертация копеек → рубли, подстановка
 * имён кондитеров из справочника (negotiations.confectioner_id = auth UUID →
 * confectioners.userId), дефолты при неполных данных.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
  getSessionAuthHeaders: vi.fn().mockResolvedValue({}),
  getCsrfToken: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/lib/store", () => ({
  useAppStore: vi.fn(() => null),
}));

import { mapApiInquiryToBuyerInquiry } from "./use-buyer-offers";

const NOW = new Date("2026-11-26T12:00:00.000Z");
const NAMES = new Map([
  ["confectioner-uuid-1", { name: "Анна Сладкова", avatar: "/a.png" }],
]);

describe("mapApiInquiryToBuyerInquiry (ZV33-4 §B6)", () => {
  const baseInquiry = {
    id: "inq-1",
    user_id: "buyer-1",
    event_type: "kids",
    base: "sponge",
    filling: "Крем-чиз",
    coating: "chocolate",
    decorations: ["macarons"],
    dietary: [],
    servings: 12,
    city: "Тула",
    delivery_date: "2026-12-01",
    delivery_type: "delivery",
    inscription: null,
    comment: "Хочу торт с машинкой",
    estimated_price: 350000, // копейки
    status: "open",
    customer_name: "Ольга",
  };

  it("quoted: цена в копейках, имя кондитера по userId, срок действия", () => {
    const res = mapApiInquiryToBuyerInquiry(
      {
        ...baseInquiry,
        negotiations: [
          {
            id: "neg-1",
            inquiry_id: "inq-1",
            confectioner_id: "confectioner-uuid-1",
            status: "quoted",
            quoted_price: 420000,
            quoted_delivery_cost: 50000,
            quoted_prep_time: "3 дня",
            quoted_at: "2026-11-20T10:00:00.000Z",
            valid_until: "2026-12-04T10:00:00.000Z", // в будущем относительно NOW
          },
        ],
      },
      NAMES,
      NOW
    );
    expect(res.offers).toHaveLength(1);
    const offer = res.offers[0];
    expect(offer.status).toBe("quoted");
    expect(offer.isExpired).toBe(false);
    expect(offer.confectionerName).toBe("Анна Сладкова");
    expect(offer.confectionerAvatar).toBe("/a.png");
    expect(offer.quotedPriceKopecks).toBe(420000);
    expect(offer.quotedDeliveryCostKopecks).toBe(50000);
    expect(offer.quotedPrepTime).toBe("3 дня");
    expect(offer.validUntil).toBe("2026-12-04T10:00:00.000Z");
    // бюджет заявки: копейки → рубли
    expect(res.estimatedPriceRub).toBe(3500);
  });

  it("истёкшее по valid_until (серверный статус ещё quoted) → isExpired true", () => {
    const res = mapApiInquiryToBuyerInquiry(
      {
        ...baseInquiry,
        negotiations: [
          {
            id: "neg-2",
            inquiry_id: "inq-1",
            confectioner_id: "confectioner-uuid-1",
            status: "quoted",
            quoted_price: 420000,
            valid_until: "2026-11-26T11:59:59.000Z", // < NOW
          },
        ],
      },
      NAMES,
      NOW
    );
    expect(res.offers[0].isExpired).toBe(true);
    expect(res.offers[0].status).toBe("quoted"); // сырой статус не переписываем
  });

  it("серверный статус expired → isExpired true даже без валидного valid_until", () => {
    const res = mapApiInquiryToBuyerInquiry(
      {
        ...baseInquiry,
        negotiations: [
          {
            id: "neg-3",
            inquiry_id: "inq-1",
            confectioner_id: "confectioner-uuid-1",
            status: "expired",
            quoted_price: 420000,
          },
        ],
      },
      NAMES,
      NOW
    );
    expect(res.offers[0].status).toBe("expired");
    expect(res.offers[0].isExpired).toBe(true);
  });

  it("accepted: accepted_at surfacится; unknown кондитер → «Кондитер»", () => {
    const res = mapApiInquiryToBuyerInquiry(
      {
        ...baseInquiry,
        negotiations: [
          {
            id: "neg-4",
            inquiry_id: "inq-1",
            confectioner_id: "unknown-uuid",
            status: "accepted",
            quoted_price: 390000,
            accepted_at: "2026-11-25T09:00:00.000Z",
            valid_until: "2026-12-09T09:00:00.000Z",
          },
        ],
      },
      NAMES,
      NOW
    );
    expect(res.offers[0].status).toBe("accepted");
    expect(res.offers[0].acceptedAt).toBe("2026-11-25T09:00:00.000Z");
    expect(res.offers[0].confectionerName).toBe("Кондитер");
    expect(res.offers[0].isExpired).toBe(false);
  });

  it("pending/declined/counter_offered; несколько предложений на одну заявку", () => {
    const res = mapApiInquiryToBuyerInquiry(
      {
        ...baseInquiry,
        negotiations: [
          { id: "neg-5", inquiry_id: "inq-1", confectioner_id: "u5", status: "pending_confectioner" },
          { id: "neg-6", inquiry_id: "inq-1", confectioner_id: "u6", status: "declined" },
          { id: "neg-7", inquiry_id: "inq-1", confectioner_id: "u7", status: "counter_offered" },
        ],
      },
      NAMES,
      NOW
    );
    expect(res.offers.map((o) => o.status)).toEqual([
      "pending",
      "declined",
      "counter_offered",
    ]);
    // у pending нет цены/доставки
    expect(res.offers[0].quotedPriceKopecks).toBeNull();
    expect(res.offers[0].quotedDeliveryCostKopecks).toBeNull();
  });

  it("заявка без переговоров → offers [] и дефолты", () => {
    const res = mapApiInquiryToBuyerInquiry(
      {
        id: "inq-9",
        user_id: "buyer-1",
        event_type: null,
        base: null,
        filling: null,
        coating: null,
        servings: null,
        city: null,
        delivery_date: null,
        comment: null,
        estimated_price: null,
        status: "open",
      },
      NAMES,
      NOW
    );
    expect(res.offers).toEqual([]);
    expect(res.servings).toBe(8); // дефолт
    expect(res.estimatedPriceRub).toBeNull();
    expect(res.decorations).toEqual([]);
  });
});
