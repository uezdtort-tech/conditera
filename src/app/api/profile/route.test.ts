import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserFromRequest = vi.fn();
const update = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const single = vi.fn();

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ update, eq, select })),
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
    getUserFromRequest.mockResolvedValue({
      id: "user-1",
      userId: "user-1",
      roles: ["CUSTOMER"],
    });
    update.mockReturnValue({ eq });
    eq.mockReturnValue({ select });
    select.mockReturnValue({ single });
    single.mockResolvedValue({
      data: { id: "user-1", name: "Новое имя", city: "Москва" },
      error: null,
    });
  });

  it("возвращает 401 без сессии", async () => {
    getUserFromRequest.mockResolvedValue(null);
    const response = await PATCH(request({ name: "Тест" }));
    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: { nested: true } }, "объект вместо строки"],
    [{ phone: ["+79990000000"] }, "массив вместо строки"],
    [{ name: "   " }, "пустое имя"],
    [{ name: "x".repeat(101) }, "имя длиннее лимита"],
    [null, "null вместо объекта"],
    [["name", "Алиса"], "массив вместо объекта"],
  ])("отклоняет некорректный ввод (%s)", async (body) => {
    const response = await PATCH(request(body));
    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("игнорирует попытку mass-assignment и обновляет только разрешённые поля владельца", async () => {
    const response = await PATCH(request({
      name: "  Алиса  ",
      role: "ADMIN",
      id: "other-user",
      is_blocked: false,
    }));
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ name: "Алиса" });
    expect(eq).toHaveBeenCalledWith("id", "user-1");
    expect((await response.json()).profile).toMatchObject({ id: "user-1" });
  });

  it("разрешает очистить необязательное поле через null", async () => {
    const response = await PATCH(request({ bio: null }));
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ bio: null });
  });

  it("отклоняет запрос без разрешённых полей", async () => {
    const response = await PATCH(request({ role: "ADMIN", is_blocked: true }));
    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
