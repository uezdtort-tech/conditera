/**
 * Тесты для src/lib/confectioner-gate.ts — проверка статуса модерации кондитера.
 *
 * Тестируем:
 *   1. Профиль не найден → allowed=false, status=pending
 *   2. approved → allowed=true
 *   3. verified=true даже при pending → allowed=true
 *   4. pending/rejected/needs_revision → allowed=false с понятной причиной
 *   5. Отсутствующий rejectionReason → "причина не указана"
 *   6. canPublishProducts/canAcceptOrders/canRequestPayout — делегирование
 *
 * Мокаем supabaseAdmin.from("confectioners").select().eq("user_id").maybeSingle()
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, setMockData } = vi.hoisted(() => {
  let _mockData: { data: unknown; error: unknown } | null = null;
  const setMockData = (data: unknown, error: unknown = null) => {
    _mockData = { data, error };
  };

  const mockFrom = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(() => Promise.resolve(_mockData || { data: null, error: null })),
      })),
    })),
  }));

  return { mockFrom, setMockData };
});

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mockFrom,
  },
}));

import {
  checkConfectionerGate,
  canPublishProducts,
  canAcceptOrders,
  canRequestPayout,
} from "@/lib/confectioner-gate";

describe("checkConfectionerGate", () => {
  beforeEach(() => {
    setMockData(null, null);
    vi.clearAllMocks();
  });

  it("возвращает not allowed, когда confectioner не найден", async () => {
    setMockData(null);
    const result = await checkConfectionerGate("nonexistent-user");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.reason).toContain("не найден");
  });

  it("возвращает not allowed при ошибке БД (fail-closed)", async () => {
    setMockData(null, { message: "Connection refused" });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.reason).toContain("Не удалось проверить");
  });

  it("возвращает allowed, когда verification_status = approved", async () => {
    setMockData({
      id: "c1",
      business_name: "Сладкая уездная",
      verified: true,
      verification_status: "approved",
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(true);
    expect(result.status).toBe("approved");
    expect(result.confectioner?.businessName).toBe("Сладкая уездная");
  });

  it("возвращает allowed, когда verified=true даже при pending", async () => {
    setMockData({
      id: "c1",
      business_name: "Test Conf",
      verified: true,
      verification_status: "pending",
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(true);
    expect(result.status).toBe("approved");
  });

  it("возвращает not allowed, когда status = pending", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "pending",
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("pending");
    expect(result.reason).toContain("ожидает модерации");
  });

  it("возвращает not allowed, когда status = rejected", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "rejected",
      rejection_reason: "Документы не в порядке",
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("rejected");
    expect(result.reason).toContain("отклонён");
    expect(result.reason).toContain("Документы не в порядке");
  });

  it("возвращает not allowed, когда status = needs_revision", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "needs_revision",
      rejection_reason: "Уточните ИНН",
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("needs_revision");
    expect(result.reason).toContain("правки");
    expect(result.reason).toContain("Уточните ИНН");
  });

  it("обрабатывает отсутствующий rejection_reason в rejected статусе", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "rejected",
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("причина не указана");
  });

  it("нормализует неизвестный status к pending", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "unknown_status_value",
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("обрабатывает null verification_status как pending", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: null,
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("pending");
  });

  it("обрабатывает null verified как false", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: null,
      verification_status: "approved",
      rejection_reason: null,
    });
    const result = await checkConfectionerGate("u1");
    // approved status должен пройти даже если verified=null
    expect(result.allowed).toBe(true);
    expect(result.status).toBe("approved");
  });
});

describe("canPublishProducts", () => {
  beforeEach(() => {
    setMockData(null, null);
    vi.clearAllMocks();
  });

  it("делегирует checkConfectionerGate — allowed", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: true,
      verification_status: "approved",
      rejection_reason: null,
    });
    const result = await canPublishProducts("u1");
    expect(result.allowed).toBe(true);
  });

  it("блокирует, когда не approved", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "pending",
      rejection_reason: null,
    });
    const result = await canPublishProducts("u1");
    expect(result.allowed).toBe(false);
  });
});

describe("canAcceptOrders", () => {
  beforeEach(() => {
    setMockData(null, null);
    vi.clearAllMocks();
  });

  it("разрешает, когда approved", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: true,
      verification_status: "approved",
      rejection_reason: null,
    });
    const result = await canAcceptOrders("u1");
    expect(result.allowed).toBe(true);
  });

  it("блокирует, когда rejected", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "rejected",
      rejection_reason: "Bad docs",
    });
    const result = await canAcceptOrders("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("rejected");
  });
});

describe("canRequestPayout", () => {
  beforeEach(() => {
    setMockData(null, null);
    vi.clearAllMocks();
  });

  it("разрешает, когда approved", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: true,
      verification_status: "approved",
      rejection_reason: null,
    });
    const result = await canRequestPayout("u1");
    expect(result.allowed).toBe(true);
  });

  it("блокирует, когда pending", async () => {
    setMockData({
      id: "c1",
      business_name: "Test",
      verified: false,
      verification_status: "pending",
      rejection_reason: null,
    });
    const result = await canRequestPayout("u1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe("pending");
  });
});
