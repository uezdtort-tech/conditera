/**
 * P1.1 §2 — ЗАПРЕТ dev-stub в production.
 *
 * Критерий ТЗ: «production + stub configuration → FAIL» — в production
 * невозможна «видимость успешной оплаты» через dev-механизм:
 *   - createPayment при незарегистрированном шлюзе в production возвращает
 *     ошибку (mock отключён), а вне production — mock допустим;
 *   - stub-ключи test_shop/test_secret (дефолты) не считаются настроенными;
 *   - mock_* идентификаторы в production отклоняются webhook-контуром
 *     (fail-closed защищён на уровне lib — см. pay4).
 *
 * YooKassa-ключи читаются на уровне модуля — в тесте они НЕ заданы, т.е.
 * модуль загружается ровно в «stub-конфигурации» (test_shop/test_secret).
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import { isYookassaConfigured, createPayment } from "@/lib/yookassa";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("P1.1 payment guard: production + stub configuration", () => {
  it("stub-ключи test_shop/test_secret не считаются настроенными", () => {
    expect(isYookassaConfigured()).toBe(false);
  });

  it("production + stub-конфигурация → создание платежа ЗАПРЕЩЕНО (FAIL, mock отключён)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await createPayment({
      amount: 3700,
      description: "Заказ DEMO-1048",
      orderId: "test-order-id",
      returnUrl: "https://example.com/checkout/success",
    });
    // Ключевой инвариант: НЕТ фиктивного «успешного» платежа
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.payment).toBeUndefined();
    // В ответе не мог появиться mock-идентификатор
    expect(JSON.stringify(result)).not.toContain("mock_");
  });

  it("development + stub-конфигурация → mock-платёж ДОПУСТИМ (stub только вне production)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const result = await createPayment({
      amount: 3700,
      description: "Заказ DEMO-1048",
      orderId: "test-order-id",
      returnUrl: "http://localhost:3000/checkout/success",
    });
    expect(result.success).toBe(true);
    expect(result.payment?.id).toMatch(/^mock_/);
    expect(result.payment?.confirmation?.confirmation_url).toBeTruthy();
  });

  it("production + настроенный шлюз → реальный запрос к провайдеру (не mock)", async () => {
    // Ключи читаются на import — перезагружаем модуль с настроенными env
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("YOOKASSA_SHOP_ID", "real-shop-1");
    vi.stubEnv("YOOKASSA_SECRET_KEY", "real-secret-1");
    vi.resetModules();
    const mod = await import("@/lib/yookassa");
    expect(mod.isYookassaConfigured()).toBe(true);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "pay_real_1", status: "pending" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await mod.createPayment({
      amount: 3700,
      description: "Заказ",
      orderId: "test-order-id",
      returnUrl: "https://example.com/success",
    });
    expect(result.success).toBe(true);
    expect(result.payment?.id).toBe("pay_real_1");
    // Реальный вызов провайдера, детерминированный Idempotence-Key от заказа
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Idempotence-Key"]).toBe("uezd_konditer:create:test-order-id");
  });

  it("повторная оплата после отмены — новое поколение Idempotence-Key (P1.1)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("YOOKASSA_SHOP_ID", "real-shop-1");
    vi.stubEnv("YOOKASSA_SECRET_KEY", "real-secret-1");
    vi.resetModules();
    const mod = await import("@/lib/yookassa");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "pay_gen2", status: "pending" }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await mod.createPayment({
      amount: 3700,
      description: "Заказ",
      orderId: "order-x",
      returnUrl: "https://example.com/success",
      idempotenceKeySuffix: ":2",
    });
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    // Ретрай той же попытки идемпотентен, новая попытка — новый ключ
    expect(headers["Idempotence-Key"]).toBe("uezd_konditer:create:order-x:2");
  });
});
