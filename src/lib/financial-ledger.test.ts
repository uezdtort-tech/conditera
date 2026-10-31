/**
 * financial-ledger.test.ts — PAY-2 регрессия журнала финансовых операций.
 *
 * Лочит контракт lib/financial-ledger.ts:
 *   • идемпотентность: повторная вставка с тем же idempotency_key (23505 по
 *     uq_financial_ledger_idem_key) → ok:true, duplicate:true (НЕ ошибка);
 *   • нечисловой amount → отказ БЕЗ обращения к БД;
 *   • успешная вставка возвращает id записи;
 *   • знаковая конвенция записывается как передана (+: платёж платформе,
 *     −: возврат клиенту) — проверяется на payload'е;
 *   • прочая ошибка БД → ok:false (Safe-обёртка логирует, не бросает).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const selectMock = vi.fn();
const singleMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      insert: insertMock,
    })),
  },
}));

// Цепочка insert(...).select("id").single()
insertMock.mockReturnValue({ select: selectMock });
selectMock.mockReturnValue({ single: singleMock });

import {
  recordFinancialEntry,
  recordFinancialEntrySafe,
  type FinancialEntryInput,
} from "./financial-ledger";

function baseEntry(partial: Partial<FinancialEntryInput> = {}): FinancialEntryInput {
  return {
    entryType: "payment_succeeded",
    amount: 2400,
    paymentId: "pay-1",
    orderId: "order-1",
    idempotencyKey: "pay-succeeded:pay-1",
    ...partial,
  };
}

beforeEach(() => {
  insertMock.mockClear();
  selectMock.mockClear();
  singleMock.mockClear();
  insertMock.mockReturnValue({ select: selectMock });
  selectMock.mockReturnValue({ single: singleMock });
});

describe("recordFinancialEntry", () => {
  it("успешная вставка → ok:true, id записи, payload со знаковым amount", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "entry-1" }, error: null });

    const res = await recordFinancialEntry(baseEntry({ amount: 2400 }));

    expect(res).toEqual({ ok: true, duplicate: false, id: "entry-1" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: "payment_succeeded",
        amount: 2400,
        currency: "RUB",
        payment_id: "pay-1",
        order_id: "order-1",
        idempotency_key: "pay-succeeded:pay-1",
      })
    );
  });

  it("возврат — отрицательный amount сохраняется как передан (−возврат клиенту)", async () => {
    singleMock.mockResolvedValueOnce({ data: { id: "entry-2" }, error: null });

    await recordFinancialEntry(
      baseEntry({ entryType: "refund_confirmed", amount: -800, idempotencyKey: "refund-confirmed:ref-1" })
    );

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entry_type: "refund_confirmed",
        amount: -800,
      })
    );
  });

  it("23505 (дубликат idempotency_key) → ok:true, duplicate:true — НЕ ошибка", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const res = await recordFinancialEntry(baseEntry());

    expect(res).toEqual({ ok: true, duplicate: true });
  });

  it("не-конечный amount → отказ без обращения к БД", async () => {
    const res = await recordFinancialEntry(baseEntry({ amount: Number.NaN }));

    expect(res.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("прочая ошибка БД → ok:false с ошибкой", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "connection refused" } });

    const res = await recordFinancialEntry(baseEntry());

    expect(res).toEqual({ ok: false, duplicate: false, error: "connection refused" });
  });
});

describe("recordFinancialEntrySafe", () => {
  it("не бросает при ошибке БД (fail-safe: журнал не ломает платёжный поток)", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordFinancialEntrySafe(baseEntry())).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("дубликат — тихий успех (без error-логов)", async () => {
    singleMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordFinancialEntrySafe(baseEntry())).resolves.toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
