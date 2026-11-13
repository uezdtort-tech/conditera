/**
 * ZV33-7b FIX 2 (ZV33-6 C-1): GET /api/recipes/[id]/acceptances — живой
 * endpoint больше НЕ подставляет MOCK_ACCEPTANCES.
 *
 * Лочит контракт:
 *   a) 0 подтверждений в БД → 200 { acceptances: [], total: 0 } — ЧЕСТНО
 *      пусто, никаких fabricated-кондитеров (никаких «mock-*» id,
 *      pravatar/unsplash-заглушек);
 *   b) реальные строки БД мапятся 1:1 (acceptanceId/confectionerId/цены);
 *   c) при сбое recipe_acceptances — fallback на audit_logs (РЕАЛЬНЫЕ записи
 *      действий «recipe_acceptance»), по-прежнему без mock;
 *   d) пустой recipeId → 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

// Очередь результатов по таблицам: recipe_acceptances → confectioners → audit_logs
let resultsByTable: Record<string, Result[]>;

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const resultFor = (): Result => {
        const q = resultsByTable[table];
        return q && q.length > 0 ? q.shift()! : { data: [], error: null };
      };
      const b: Record<string, unknown> = {
        select: vi.fn(() => b),
        eq: vi.fn(() => b),
        in: vi.fn(() => b),
        order: vi.fn(() => b),
        then: (
          res?: (v: unknown) => unknown,
          rej?: (e: unknown) => unknown
        ) => Promise.resolve(resultFor()).then(res as never, rej as never),
      };
      return b;
    }),
  },
}));

vi.mock("@/lib/geocoder", () => ({
  resolveCoords: vi.fn().mockResolvedValue(null),
  haversineKm: vi.fn().mockReturnValue(null),
}));

import { GET } from "./route";

const RECIPE_ID = "a34e0fb9-4b4c-4431-aebb-87691fb8df46";

function resetResults(): void {
  resultsByTable = {
    recipe_acceptances: [],
    confectioners: [],
    audit_logs: [],
  };
}

async function callGet(recipeId: string = RECIPE_ID): Promise<Response> {
  const req = new NextRequest(
    `http://localhost:3000/api/recipes/${recipeId}/acceptances`
  );
  return GET(req, { params: Promise.resolve({ id: recipeId }) });
}

/** Гард от регрессии: в теле не должно быть fabricated-контента. */
function expectNoMockPayload(json: unknown): void {
  const s = JSON.stringify(json);
  expect(s).not.toContain("mock-");
  expect(s).not.toContain("pravatar");
  expect(s).not.toContain("Сладкая уездная");
  expect(s).not.toContain("Мастерская сладких искусств");
  expect(s).not.toContain("test-streams.mux.dev");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetResults();
});

describe("GET /api/recipes/[id]/acceptances — no-mock контракт (ZV33-7b FIX 2)", () => {
  it("0 подтверждений в БД → 200 { acceptances: [], total: 0 }, без mock-данных", async () => {
    resultsByTable.recipe_acceptances = [{ data: [], error: null }];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { acceptances: unknown[]; total: number };
    expect(json.acceptances).toEqual([]);
    expect(json.total).toBe(0);
    expectNoMockPayload(json);
  });

  it("реальные строки БД → маппинг 1:1 + кондитер из confectioners", async () => {
    resultsByTable.recipe_acceptances = [
      {
        data: [
          {
            id: "acc-1",
            recipe_id: RECIPE_ID,
            confectioner_id: "conf-uuid-1",
            price_from: 2000,
            price_to: 4000,
            prep_days: 3,
            delivery: true,
            self_pickup: false,
            notes: "Реальная запись",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
    ];
    resultsByTable.confectioners = [
      {
        data: [
          {
            id: "conf-uuid-1",
            userId: "user-uuid-1",
            businessName: "Реальная кондитерская",
            avatar: null,
            city: "Тула",
            rating: 4.8,
            reviewsCount: 10,
            verified: true,
            trustLevel: "TRUSTED",
            location: { lat: 54.1961, lng: 37.6182, serviceRadiusKm: 25 },
          },
        ],
        error: null,
      },
    ];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      acceptances: Array<{ acceptanceId: string; confectionerId: string; priceFrom: number | null; confectioner: { businessName: string } | null }>;
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.acceptances[0].acceptanceId).toBe("acc-1");
    expect(json.acceptances[0].confectionerId).toBe("conf-uuid-1");
    expect(json.acceptances[0].priceFrom).toBe(2000);
    expect(json.acceptances[0].confectioner?.businessName).toBe("Реальная кондитерская");
    expectNoMockPayload(json);
  });

  it("сбой recipe_acceptances → fallback на audit_logs (реальные записи), всё ещё без mock", async () => {
    resultsByTable.recipe_acceptances = [
      { data: null, error: { message: "relation does not exist" } },
    ];
    resultsByTable.audit_logs = [
      {
        data: [
          {
            id: "log-1",
            userId: "user-uuid-9",
            entityId: RECIPE_ID,
            metadata: {
              priceFrom: 1800,
              priceTo: 3500,
              prepDays: 2,
              delivery: true,
              selfPickup: true,
              notes: "Из журнала аудита",
            },
            createdAt: "2026-01-02T00:00:00Z",
          },
        ],
        error: null,
      },
    ];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      acceptances: Array<{ acceptanceId: string; priceFrom: number | null; notes: string | null }>;
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.acceptances[0].acceptanceId).toBe("log-1");
    expect(json.acceptances[0].priceFrom).toBe(1800);
    expect(json.acceptances[0].notes).toBe("Из журнала аудита");
    expectNoMockPayload(json);
  });

  it("пустой recipeId → 400", async () => {
    const res = await callGet("");
    expect(res.status).toBe(400);
  });
});
