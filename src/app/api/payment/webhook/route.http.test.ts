/**
 * HTTP-контракт POST /api/payment/webhook — регрессии, требованные владельцем
 * (RELEASE-GATE-v4.5, P0 «webhook»):
 *
 *   1. Проверка webhook-секрета: провалившийся verifyWebhook → 401,
 *      БД не затрагивается (fail-closed аутентичность вызова).
 *   2. Ошибочные идентификаторы: non-UUID orderId (мусор в metadata.orderId)
 *      → 404, а не 500 (PostgREST 22P02 на uuid-колонке исключён) —
 *      контракт введён в candidate-диапазоне (49604e0), ранее 500.
 *   3. Отсутствующая конфигурация провайдера: сверка с YooKassa НЕ выполняется
 *      (getPaymentStatus не вызывается) и отказ fail-500 (допройбный режим до
 *      PAY-1a) не происходит; маршрут продолжает штатную обработку (при пустой
 *      мок-БД детерминированно 404 «order not found» — валидная ветка E2E
 *      контракта [200,404]). WEBHOOK-СЕКРЕТ при этом проверяется (тест 1).
 *      НАЙДЕННЫЙ ФАКТ (v4.5, не дефект поведения): г PAY-1a skip-ветка
 *      «provider_not_configured» (route.ts:126-131, 49604e0) — мёртвый код:
 *      безусловный guard :83 «if (!isYookassaConfigured()) return { ok: true }»
 *      перехватывает случай раньше и возвращает ok БЕЗ маркера skip. Поведение
 *      корректно (без верификации, без 500); чистка мёртвой ветки — только по
 *      отдельному согласованію владельца (правило: платежный код без согласования
 *      не изменяется).
 *   4. Fail-closed при недоступности провайдера: getPaymentStatus неуспех
 *      → 500 (ослабления нет).
 *   5. Мусорное тело без event/object.id → 400.
 *
 * Это тесты ТОЛЬКО: route.ts не изменяется. Денежная логика (идемпотентность
 * статусов, бонусы, возвраты) не затрагивается — см. существующий
 * route.test.ts (типизация/идемпотентность) и E2E payment-webhook-idempotency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  getPaymentStatus: vi.fn(),
  isYookassaConfigured: vi.fn(),
  getRefund: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/yookassa", () => ({
  verifyWebhook: mocks.verifyWebhook,
  getPaymentStatus: mocks.getPaymentStatus,
  isYookassaConfigured: mocks.isYookassaConfigured,
  getRefund: mocks.getRefund,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import { POST } from "@/app/api/payment/webhook/route";

/** Чит-цепочка PostgREST: select().eq().order().limit().maybeSingle() → { data } */
function mockFrom(data: unknown) {
  const terminal = Promise.resolve({ data });
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => terminal,
  };
  return builder;
}

function makeRequest(payload: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/payment/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const UUID = "123e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => mockFrom(null));
});

describe("payment/webhook: HTTP-контракт (регрессии владельца v4.5)", () => {
  it("1. провалившийся webhook-секрет → 401, БД не затрагивается", async () => {
    mocks.verifyWebhook.mockReturnValue(false);

    const res = await POST(makeRequest({ event: "payment.succeeded", object: { id: "pay-1", status: "succeeded" } }));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("2. non-UUID orderId → 404 (был 500 на 22P02)", async () => {
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(true);

    const res = await POST(
      makeRequest({
        event: "payment.succeeded",
        object: { id: "pay-1", status: "succeeded", metadata: { orderId: "garbage-not-a-uuid" } },
      })
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Order not found" });
    // Сверка с провайдером не выполняется: 404 отдаётся до PAY-1
    expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
  });

  it("3. YooKassa не сконфигурирована → без сверки с провайдером, без fail-500", async () => {
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(false);

    const res = await POST(
      makeRequest({
        event: "payment.succeeded",
        object: { id: "pay-1", status: "succeeded", metadata: { orderId: UUID } },
      })
    );

    // Ключевые контракты отсутствующей конфигурации (см. комментарий в шапке):
    //  — сверка с провайдером НЕ выполняется;
    //  — НЕ 500 (допройбный режим до PAY-1a);
    //  — при пустой мок-БД детерминированно 404 «Order not found»
    //    (guard route.ts:83 возвращает ok:true без маркера skip — PAY-1a
    //    skip-ветка :126 недостижима; чистка — по решению владельца).
    expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Order not found" });
  });

  it("4. провайдер недоступен → 500 fail-closed (ослабления нет)", async () => {
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(true);
    mocks.getPaymentStatus.mockResolvedValue({ success: false });

    const res = await POST(
      makeRequest({
        event: "payment.succeeded",
        object: { id: "pay-1", status: "succeeded", metadata: { orderId: UUID } },
      })
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Provider verification failed" });
  });

  it("5. тело без event/object.id → 400", async () => {
    mocks.verifyWebhook.mockReturnValue(true);

    const res = await POST(makeRequest({ garbage: true }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid webhook payload" });
  });
});
