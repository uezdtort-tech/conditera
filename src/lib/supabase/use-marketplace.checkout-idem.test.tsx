/**
 * use-marketplace.checkout-idem.test.ts — useCreateOrder шлёт стабильный
 * Idempotency-Key (U-07 fix, hook-level).
 *
 * Регрессия U-07 (клиентская точка 2): хук POST /api/checkout раньше вообще
 * не отправлял Idempotency-Key → каждый resubmit создавал дубликат-заказ.
 *
 * Контракт (lib/checkout-idempotency.ts):
 *   - повтор mutate с тем же payload при неизвестном исходе (сеть/5xx) →
 *     ТОТ ЖЕ ключ в заголовке (сервер вернёт replay, не новый заказ);
 *   - после известного исхода (2xx success / 4xx rejected) → НОВЫЙ ключ;
 *   - другой payload → другой ключ (другая логическая отправка).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useCreateOrder } from "./use-marketplace";

const PAYLOAD_A = {
  cartItems: [{ id: "ci-1", product_id: "prod-1", quantity: 1 }],
  deliveryAddress: "ул. Тестовая, 1",
  deliveryCity: "Москва",
  deliveryType: "delivery" as const,
  notes: undefined,
};

const PAYLOAD_B = {
  ...PAYLOAD_A,
  cartItems: [{ id: "ci-2", product_id: "prod-2", quantity: 2 }],
};

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}
function errResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body };
}

/** Обёртка с QueryClient (mutations без retry — сеть не дублируем). */
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function runMutation(
  mutation: ReturnType<typeof useCreateOrder>,
  payload: unknown
): Promise<{ ok: boolean; data?: unknown; error?: unknown }> {
  let outcome!: { ok: boolean; data?: unknown; error?: unknown };
  await act(async () => {
    try {
      outcome = { ok: true, data: await mutation.mutateAsync(payload as never) };
    } catch (e) {
      outcome = { ok: false, error: e };
    }
  });
  return outcome;
}

function sentKeys(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(
    (call: unknown[]) => (call[1] as { headers: Record<string, string> }).headers["Idempotency-Key"]
  );
}

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCreateOrder — стабильный Idempotency-Key (регрессия U-07)", () => {
  it("ключ отправляется в заголовке Idempotency-Key (раньше не отправлялся вовсе)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      okResponse({ orderId: "ord-h1", paymentUrl: "/pay" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateOrder(), { wrapper: Wrapper });
    const outcome = await runMutation(result.current, PAYLOAD_A);

    expect(outcome.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("retry той же логической отправки после сетевого сбоя → ТОТ ЖЕ ключ", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed: network lost"))
      .mockResolvedValueOnce(okResponse({ orderId: "ord-h2", paymentUrl: "/pay" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateOrder(), { wrapper: Wrapper });

    const first = await runMutation(result.current, PAYLOAD_A);
    expect(first.ok).toBe(false); // сеть потеряна — исход неизвестен

    const retry = await runMutation(result.current, PAYLOAD_A);
    expect(retry.ok).toBe(true);

    const keys = sentKeys(fetchMock);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("retry после 5xx (заказ мог создаться) → ТОТ ЖЕ ключ", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(500, { error: "Внутренняя ошибка" }))
      .mockResolvedValueOnce(okResponse({ orderId: "ord-h3", paymentUrl: "/pay" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateOrder(), { wrapper: Wrapper });
    await runMutation(result.current, PAYLOAD_A);
    const retry = await runMutation(result.current, PAYLOAD_A);

    const keys = sentKeys(fetchMock);
    expect(retry.ok).toBe(true);
    expect(keys[1]).toBe(keys[0]);
  });

  it("после успеха следующая та же отправка → НОВЫЙ ключ (ложный replay второго заказа невозможен)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ orderId: "ord-h4", paymentUrl: "/pay" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateOrder(), { wrapper: Wrapper });
    await runMutation(result.current, PAYLOAD_A);
    const second = await runMutation(result.current, PAYLOAD_A);

    const keys = sentKeys(fetchMock);
    expect(second.ok).toBe(true);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("после 4xx (сервер точно не создавал заказ) → НОВЫЙ ключ", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(400, { error: "Некорректные данные" }))
      .mockResolvedValueOnce(okResponse({ orderId: "ord-h5", paymentUrl: "/pay" }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateOrder(), { wrapper: Wrapper });
    await runMutation(result.current, PAYLOAD_A);
    await runMutation(result.current, PAYLOAD_A);

    const keys = sentKeys(fetchMock);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("другой payload → другой ключ (другая логическая отправка)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ orderId: "ord-h6", paymentUrl: "/pay" })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCreateOrder(), { wrapper: Wrapper });
    await runMutation(result.current, PAYLOAD_A);
    await runMutation(result.current, PAYLOAD_B);

    const keys = sentKeys(fetchMock);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
