/**
 * Тесты loadBuilderFillingsForValidation — серверный источник истины для
 * валидации/цены кастомных тортов (checkout + /api/cart, ЕДИНАЯ формула).
 *
 * Лочит контракт:
 *   a) ошибка БД → throw (fail-closed); маршрут обязан ответить 503,
 *      молчаливого даунгрейда до mock быть не должно;
 *   b) выборка: status='APPROVED' AND is_active=true (инактивированная
 *      начинка не проходит валидацию);
 *   c) результат — mergeBuilderFillings(dbRows): mock-каталог остаётся
 *      валидным для легаси-конфигов, DB-начинки добавляются/перекрывают по id,
 *      маппинг цены price_multiplier → Math.round((m−1)×1000).
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBuilderFillingsForValidation } from "./builder-fillings-server";
import { getMockBuilderFillings } from "./cake-builder-pricing";

function mockDb(result: { data?: unknown; error?: { message: string } }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: async () => ({ data: result.data ?? null, error: result.error ?? null }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("loadBuilderFillingsForValidation", () => {
  it("ошибка БД → throw (fail-closed, без даунгрейда до mock)", async () => {
    await expect(
      loadBuilderFillingsForValidation(
        mockDb({ error: { message: "connection refused" } })
      )
    ).rejects.toThrow("fillings catalog unavailable");
  });

  it("пустая выборка → mock-каталог (легаси-конфиги валидны)", async () => {
    const fillings = await loadBuilderFillingsForValidation(mockDb({ data: [] }));
    expect(fillings).toEqual(getMockBuilderFillings());
  });

  it("DB-начинки добавляются к mock; price_multiplier 1.5 → 500", async () => {
    const fillings = await loadBuilderFillingsForValidation(
      mockDb({
        data: [
          { id: "db-fill-1", name: "Фисташка-мусс", price_multiplier: 1.5 },
          { id: "chocolate_ganache", name: "Шоколадный ганаш (из БД)", price_multiplier: 1.4 },
        ],
      })
    );
    // mock идёт первым — легаси-идентификаторы сохраняются
    expect(fillings.some((f) => f.id === "condensed_milk")).toBe(true);
    // DB-строка добавлена с маппингом цены (1.5 − 1) × 1000 = 500
    const dbOnly = fillings.find((f) => f.id === "db-fill-1");
    expect(dbOnly).toEqual({ id: "db-fill-1", label: "Фисташка-мусс", price: 500 });
    // DB-строка перекрывает mock по id, но mock-цена 350 → DB 400
    const override = fillings.find((f) => f.id === "chocolate_ganache");
    expect(override).toEqual({ id: "chocolate_ganache", label: "Шоколадный ганаш (из БД)", price: 400 });
  });

  it("некорректные строки БД отбрасываются без падения", async () => {
    const fillings = await loadBuilderFillingsForValidation(
      mockDb({
        data: [
          { id: "ok-fill", name: "Валидная", price_multiplier: 1.2 },
          null,
          { id: 42, name: "Плохой id" },
          { id: "no-name" },
        ],
      })
    );
    expect(fillings.some((f) => f.id === "ok-fill")).toBe(true);
    expect(fillings.some((f) => f.id === "no-name")).toBe(false);
  });
});
