import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUserFromRequest: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => mocks.getUserFromRequest(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ update: mocks.update, eq: mocks.eq, select: mocks.select })),
  },
}));

import { PATCH } from "./route";

const request = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PATCH /api/profile — профиль только текущего пользователя", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserFromRequest.mockResolvedValue({
      id: "user-1",
      userId: "user-1",
      roles: ["CUSTOMER"],
    });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ single: mocks.single });
    mocks.single.mockResolvedValue({
      data: { id: "user-1", name: "Новое имя", city: "Москва" },
      error: null,
    });
  });

  it("возвращает 401 без сессии", async () => {
    mocks.getUserFromRequest.mockResolvedValue(null);
    const response = await PATCH(request({ name: "Тест" }));
    expect(response.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  const invalidBodies: Array<{ body: unknown; description: string }> = [
    { body: { name: { nested: true } }, description: "объект вместо строки" },
    { body: { phone: ["+79990000000"] }, description: "массив вместо строки" },
    { body: { name: "   " }, description: "пустое имя" },
    { body: { name: "x".repeat(101) }, description: "имя длиннее лимита" },
    { body: null, description: "null вместо объекта" },
    { body: ["name", "Алиса"], description: "массив вместо объекта" },
  ];

  it.each(invalidBodies)("отклоняет некорректный ввод: $description", async ({ body }) => {
    const response = await PATCH(request(body));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("игнорирует попытку mass-assignment и обновляет только разрешённые поля владельца", async () => {
    const response = await PATCH(request({
      name: "  Алиса  ",
      role: "ADMIN",
      id: "other-user",
      is_blocked: false,
    }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ name: "Алиса" });
    expect(mocks.eq).toHaveBeenCalledWith("id", "user-1");
    expect((await response.json()).profile).toMatchObject({ id: "user-1" });
  });

  it("разрешает очистить необязательное поле через null", async () => {
    const response = await PATCH(request({ bio: null }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ bio: null });
  });

  it("отклоняет запрос без разрешённых полей", async () => {
    const response = await PATCH(request({ role: "ADMIN", is_blocked: true }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
