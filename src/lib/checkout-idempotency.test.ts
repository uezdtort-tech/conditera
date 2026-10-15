/**
 * checkout-idempotency.test.ts — стабильный Idempotency-Key checkout (U-07 fix).
 *
 * Контракт клиента («повтор той же логической отправки не создаёт дубль»):
 *   - та же сигнатура тела при неизвестном исходе → ТОТ ЖЕ ключ (retry,
 *     timeout-retry, повтор после перезагрузки страницы);
 *   - известный исход (success/rejected) → следующая отправка НОВЫЙ ключ
 *     (ложный replay повторного заказа невозможен);
 *   - неизвестный исход (unknown: сеть/5xx) → ключ живёт до replay;
 *   - ключ валиден для серверного extractIdempotencyKey (8..100, [A-Za-z0-9._-]).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  beginCheckoutIdempotencyAttempt,
  resolveCheckoutIdempotencyAttempt,
  computeCheckoutSubmissionSignature,
  makeCheckoutIdempotencyKey,
} from "./checkout-idempotency";

const BODY_A = {
  cartItems: [{ id: "ci1", product_id: "p1", quantity: 1 }],
  customerName: "Иван Тестов",
  customerPhone: "+7 999 123-45-67",
  deliveryType: "pickup",
  deliveryCity: "Москва",
  paymentMethod: "card",
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("beginCheckoutIdempotencyAttempt — один ключ на логическую отправку", () => {
  it("повтор той же отправки (тот же body) → ТОТ ЖЕ ключ, reused=true", () => {
    const first = beginCheckoutIdempotencyAttempt(BODY_A);
    const retry = beginCheckoutIdempotencyAttempt(BODY_A);
    expect(retry.key).toBe(first.key);
    expect(first.reused).toBe(false);
    expect(retry.reused).toBe(true);
  });

  it("порядок свойств в body не меняет сигнатуру → ключ переиспользуется", () => {
    const first = beginCheckoutIdempotencyAttempt(BODY_A);
    const reordered = {
      paymentMethod: "card",
      deliveryCity: "Москва",
      deliveryType: "pickup",
      customerPhone: "+7 999 123-45-67",
      customerName: "Иван Тестов",
      cartItems: [{ id: "ci1", product_id: "p1", quantity: 1 }],
    };
    const retry = beginCheckoutIdempotencyAttempt(reordered);
    expect(retry.key).toBe(first.key);
    expect(retry.reused).toBe(true);
  });

  it("изменённое body (другая логическая отправка) → НОВЫЙ ключ", () => {
    beginCheckoutIdempotencyAttempt(BODY_A);
    const changed = beginCheckoutIdempotencyAttempt({
      ...BODY_A,
      cartItems: [{ id: "ci1", product_id: "p1", quantity: 2 }],
    });
    expect(changed.reused).toBe(false);
  });

  it("undefined-поля не значимы (pickup без адреса === адрес undefined)", () => {
    const first = beginCheckoutIdempotencyAttempt({ ...BODY_A, deliveryAddress: undefined });
    const retry = beginCheckoutIdempotencyAttempt({ ...BODY_A });
    expect(retry.key).toBe(first.key);
  });
});

describe("resolveCheckoutIdempotencyAttempt — судьба ключа по исходу", () => {
  it("success → ключ закрыт: следующая та же отправка получает НОВЫЙ ключ (без ложного replay)", () => {
    const { key } = beginCheckoutIdempotencyAttempt(BODY_A);
    resolveCheckoutIdempotencyAttempt(key, "success");
    const next = beginCheckoutIdempotencyAttempt(BODY_A);
    expect(next.key).not.toBe(key);
    expect(next.reused).toBe(false);
  });

  it("rejected (4xx — сервер точно не создавал заказ) → ключ закрыт", () => {
    const { key } = beginCheckoutIdempotencyAttempt(BODY_A);
    resolveCheckoutIdempotencyAttempt(key, "rejected");
    const next = beginCheckoutIdempotencyAttempt(BODY_A);
    expect(next.key).not.toBe(key);
  });

  it("unknown (сеть/5xx — заказ мог создаться) → ключ ЖИВЁТ: повтор вернёт replay", () => {
    const { key } = beginCheckoutIdempotencyAttempt(BODY_A);
    resolveCheckoutIdempotencyAttempt(key, "unknown");
    const retry = beginCheckoutIdempotencyAttempt(BODY_A);
    expect(retry.key).toBe(key);
    expect(retry.reused).toBe(true);
  });

  it("resolve чужим ключом не трогает более новую попытку", () => {
    const a = beginCheckoutIdempotencyAttempt(BODY_A);
    const b = beginCheckoutIdempotencyAttempt({ ...BODY_A, deliveryCity: "Казань" });
    resolveCheckoutIdempotencyAttempt(a.key, "success");
    const retryB = beginCheckoutIdempotencyAttempt({ ...BODY_A, deliveryCity: "Казань" });
    expect(retryB.key).toBe(b.key);
    expect(retryB.reused).toBe(true);
  });
});

describe("переживание перезагрузки страницы (sessionStorage)", () => {
  it("после resetModules (новый модуль, тот же sessionStorage) → ТОТ ЖЕ ключ", async () => {
    const first = beginCheckoutIdempotencyAttempt(BODY_A);

    // Имитация reload: модульный стейт сброшен, sessionStorage сохранился
    vi.resetModules();
    const fresh = await import("./checkout-idempotency");
    const afterReload = fresh.beginCheckoutIdempotencyAttempt(BODY_A);

    expect(afterReload.key).toBe(first.key);
    expect(afterReload.reused).toBe(true);
  });

  it("sessionStorage недоступен → фолбэк в память держит контракт в рамках процесса", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    try {
      const first = beginCheckoutIdempotencyAttempt(BODY_A);
      const retry = beginCheckoutIdempotencyAttempt(BODY_A);
      expect(retry.key).toBe(first.key);
      resolveCheckoutIdempotencyAttempt(first.key, "success");
      const next = beginCheckoutIdempotencyAttempt(BODY_A);
      expect(next.key).not.toBe(first.key);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ключ и сигнатура совместимы с серверным контрактом", () => {
  it("makeCheckoutIdempotencyKey: 8..100 символов, [A-Za-z0-9._-], уникален", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const key = makeCheckoutIdempotencyKey();
      expect(key.length).toBeGreaterThanOrEqual(8);
      expect(key.length).toBeLessThanOrEqual(100);
      expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
      seen.add(key);
    }
    expect(seen.size).toBe(50);
  });

  it("computeCheckoutSubmissionSignature: стабилен к порядку ключей, чувствителен к данным", () => {
    const s1 = computeCheckoutSubmissionSignature(BODY_A);
    const s2 = computeCheckoutSubmissionSignature({
      paymentMethod: "card",
      deliveryCity: "Москва",
      deliveryType: "pickup",
      customerPhone: "+7 999 123-45-67",
      customerName: "Иван Тестов",
      cartItems: [{ id: "ci1", product_id: "p1", quantity: 1 }],
    });
    const s3 = computeCheckoutSubmissionSignature({ ...BODY_A, customerPhone: "+7 999 123-45-68" });
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
  });

  it("мусор в sessionStorage не ломает begin (трактуется как отсутствие попытки)", () => {
    sessionStorage.setItem("checkout_idempotency_attempt_v1", "{not json");
    const attempt = beginCheckoutIdempotencyAttempt(BODY_A);
    expect(attempt.reused).toBe(false);
    expect(attempt.key).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("мусор в sessionStorage с невалидной формой ключа → новый валидный ключ", () => {
    sessionStorage.setItem(
      "checkout_idempotency_attempt_v1",
      JSON.stringify({ key: "к", signature: "deadbeef:0" })
    );
    const attempt = beginCheckoutIdempotencyAttempt(BODY_A);
    expect(attempt.reused).toBe(false);
  });
});
