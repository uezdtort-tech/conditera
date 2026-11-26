/**
 * HTTP-контракт POST /api/payment/webhook — регрессии, требованные владельцем
 * (RELEASE-GATE-v4.5, P0 «webhook»):
 *
 *   1. Проверка webhook-секрета: провалившийся verifyWebhook → 401,
 *      БД не затрагивается (fail-closed аутентичность вызова).
 *   2. Ошибочные идентификаторы: non-UUID orderId (мусор в metadata.orderId)
 *      → 404, а не 500 (PostgREST 22P02 на uuid-колонке исключён) —
 *      контракт введён в candidate-диапазоне (49604e0), ранее 500.
 *   3. Отсутствующая конфигурация провайдера (RELEASE-02 §5, fail-closed):
 *      — production: re-fetch-сверка с YooKassa невозможна без кредов →
 *        500 «Provider verification failed» (YooKassa повторит доставку
 *        после настройки); БД не записывается.
 *      — не-production (E2E/staging/dev): skip-ветка «provider_not_configured»
 *        → 200 { success, skipped }, сверка не выполняется, обработка
 *        останавливается до чтения заказа. Бывший безусловный guard :83
 *        «!configured → ok:true» удалён (он мёртвил PAY-1a skip-ветку).
 *   4. Fail-closed при недоступности провайдера: getPaymentStatus неуспех
 *      → 500 (ослабления нет).
 *   5. Мусорное тело без event/object.id → 400.
 *   6-8. RELEASE-02 §5: legacy-фолбэк по metadata.orderId отключён
 *      в production — матчинг строго по yookassa_payment_id; платёж не
 *      найден + metadata.orderId есть → 404 (заказа нет), metadata нет →
 *      400 (orderId null); БД-записи не создаются, NPE нет.
 *
 * Это тесты ТОЛЬКО: route.ts не изменяется. Денежная логика (идемпотентность
 * статусов, бонусы, возвраты) не затрагивается — см. существующий
 * route.test.ts (типизация/идемпотентность) и E2E payment-webhook-idempotency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("3. YooKassa не сконфигурирована, не-production → skip «provider_not_configured» (регресс)", async () => {
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(false);

    const res = await POST(
      makeRequest({
        event: "payment.succeeded",
        object: { id: "pay-1", status: "succeeded", metadata: { orderId: UUID } },
      })
    );

    // RELEASE-02 §5: вне production сверка с провайдером не выполняется
    // (не с чем), событие НЕ применяется — skip-ответ до чтения заказа;
    // NOT 500 (допройбный режим для E2E/staging без кредитов сохранён).
    expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      skipped: "provider_not_configured",
    });
    // Обработка остановлена на skip-ветке: только поиск платежа (provider id +
    // dev-фолбэк по metadata.orderId — вне production он ещё жив), без чтения
    // заказа и записей.
    // Provider verification happens before any ledger read when credentials are absent.
    expect(mocks.from).not.toHaveBeenCalled();
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

  it("6. production + шлюз не настроен + payment.succeeded → 500 fail-closed, БД не записывается", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(false);

    const res = await POST(
      makeRequest({
        event: "payment.succeeded",
        object: { id: "pay-1", status: "succeeded", metadata: { orderId: UUID } },
      })
    );

    // RELEASE-02 §5: без кредов re-fetch-сверка невозможна → {ok:false} → 500
    // (YooKassa повторит доставку после настройки). БД только читалась
    // (поиск по provider id); до записи/чтения заказа дело не дошло.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "Provider verification failed" });
    expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
    // Fail-closed before touching the local financial ledger.
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("7. production: yookassa_payment_id не найден + metadata.orderId → фолбэк отключён, 404, БД-запись не создана", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(true);
    mocks.getPaymentStatus.mockResolvedValue({
      success: true,
      payment: { status: "succeeded", amount: { value: "2400.00", currency: "RUB" } },
    });

    const res = await POST(
      makeRequest({
        event: "payment.succeeded",
        object: { id: "pay-legacy", status: "succeeded", metadata: { orderId: UUID } },
      })
    );

    // Матчинг строго по yookassa_payment_id: платёж не найден → payment=null,
    // orderId из metadata → заказа нет → 404. Порядок from-вызовов доказывает,
    // что legacy-фолбэк (второй .from("payments")) не выполнялся, а вставок
    // нет: мок-builder без insert/update — любая запись упала бы в 500.
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Order not found" });
    expect(mocks.from.mock.calls.map((c) => c[0])).toEqual(["payments", "orders"]);
  });

  it("8. production: платёж не найден и metadata.orderId нет → orderId null → 400 (без NPE)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.verifyWebhook.mockReturnValue(true);
    mocks.isYookassaConfigured.mockReturnValue(true);

    const res = await POST(
      makeRequest({ event: "payment.succeeded", object: { id: "pay-1", status: "succeeded" } })
    );

    // Фолбэк отключён + metadata пуста → orderId=null → существующая ветка
    // «if (!orderId) return 400» срабатывает до сверки с провайдером.
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid webhook payload" });
    expect(mocks.getPaymentStatus).not.toHaveBeenCalled();
  });
});
