/**
 * role-guards.test.ts — unit-тесты для серверной утилиты проверки ролей.
 *
 * Тесты запускаются без реального Supabase — мы мокаем env vars,
 * чтобы supabaseAdmin возвращал пустые ответы.
 *
 * Документация: см. src/lib/role-guards.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getUserRoles,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  isAdmin,
  isSuperAdmin,
  requireRole,
  requireAnyRole,
  getPrimaryRole,
  ROLE_LABELS,
} from "@/lib/role-guards";
import type { user_role } from "@/lib/supabase/types";

// Мокаем supabaseAdmin чтобы возвращать тестовые данные
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            // Возвращаем пустой ответ по умолчанию — env не сконфигурирован
            then: vi.fn(),
          })),
          then: vi.fn(),
        })),
      })),
    })),
  },
}));

// Гарантируем что env vars НЕ установлены — тогда getUserRoles возвращает []
beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("role-guards — базовые функции", () => {
  it("getUserRoles возвращает [] когда Supabase не сконфигурирован", async () => {
    const roles = await getUserRoles("user-123");
    expect(roles).toEqual([]);
  });

  it("hasRole возвращает false когда env не задан", async () => {
    const result = await hasRole("user-123", "ADMIN");
    expect(result).toBe(false);
  });

  it("hasAnyRole возвращает false для пустого массива ролей", async () => {
    const result = await hasAnyRole("user-123", []);
    expect(result).toBe(false);
  });

  it("hasAllRoles возвращает true для пустого массива ролей (нет требований)", async () => {
    const result = await hasAllRoles("user-123", []);
    expect(result).toBe(true);
  });

  it("isAdmin возвращает false без env", async () => {
    const result = await isAdmin("user-123");
    expect(result).toBe(false);
  });

  it("isSuperAdmin возвращает false без env", async () => {
    const result = await isSuperAdmin("user-123");
    expect(result).toBe(false);
  });
});

describe("role-guards — guard responses", () => {
  it("requireRole возвращает 401 если userId = null", async () => {
    const response = await requireRole(null, "ADMIN");
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    const body = await response!.json();
    expect(body.error).toContain("аутентифика");
  });

  it("requireRole возвращает 401 если userId = undefined", async () => {
    const response = await requireRole(undefined, "CONFECTIONER");
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
  });

  it("requireRole возвращает 403 если userId есть но роли нет (без env)", async () => {
    const response = await requireRole("user-123", "ADMIN");
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    const body = await response!.json();
    expect(body.required_role).toBe("ADMIN");
    expect(body.error).toContain("ADMIN");
  });

  it("requireAnyRole возвращает 403 для несоответствующих ролей", async () => {
    const response = await requireAnyRole("user-123", ["ADMIN", "SUPER_ADMIN"]);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    const body = await response!.json();
    expect(body.required_roles).toEqual(["ADMIN", "SUPER_ADMIN"]);
  });

  it("requireAnyRole возвращает null (доступ открыт) для пустого массива", async () => {
    const response = await requireAnyRole("user-123", []);
    expect(response).toBeNull();
  });

  it("requireAnyRole возвращает 401 для null userId даже с пустыми ролями", async () => {
    // Если userId нет — это 401 (не 200)
    const response = await requireAnyRole(null, []);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
  });
});

describe("role-guards — getPrimaryRole", () => {
  it("возвращает null когда нет ролей (без env)", async () => {
    const primary = await getPrimaryRole("user-123");
    expect(primary).toBeNull();
  });
});

describe("role-guards — ROLE_LABELS", () => {
  it("содержит все 30 ролей (27 из спецификации + 3 новые = FOOD_SERVICE, EVENT_ORGANIZER, PICKUP_POINT)", () => {
    const roleCount = Object.keys(ROLE_LABELS).length;
    expect(roleCount).toBe(30);
  });

  it("каждая роль имеет label, group и icon", () => {
    const entries = Object.entries(ROLE_LABELS) as Array<[user_role, { label: string; group: string; icon: string }]>;
    for (const [role, meta] of entries) {
      expect(meta.label).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(2);
      expect(meta.group).toBeTruthy();
      expect(meta.icon).toBeTruthy();
    }
  });

  it("роль ADMIN имеет label «Администратор»", () => {
    expect(ROLE_LABELS.ADMIN.label).toBe("Администратор");
  });

  it("роль RECIPE_DEVELOPER входит в группу «Новые роли»", () => {
    expect(ROLE_LABELS.RECIPE_DEVELOPER.group).toBe("Новые роли");
  });

  it("роль AI_ASSISTANT имеет иконку «bot»", () => {
    expect(ROLE_LABELS.AI_ASSISTANT.icon).toBe("bot");
  });

  it("роль CUSTOMER входит в группу «Покупатели»", () => {
    expect(ROLE_LABELS.CUSTOMER.group).toBe("Покупатели");
  });

  it("роль LOYALTY_PARTNER имеет непустой label", () => {
    expect(ROLE_LABELS.LOYALTY_PARTNER.label.length).toBeGreaterThan(0);
  });

  it("содержит все роли из группы ADMINISTRATION", () => {
    expect(ROLE_LABELS.ADMIN).toBeDefined();
    expect(ROLE_LABELS.SUPER_ADMIN).toBeDefined();
    expect(ROLE_LABELS.SUPPORT).toBeDefined();
  });

  it("содержит все роли из группы NEW_ROLES", () => {
    expect(ROLE_LABELS.RECIPE_DEVELOPER).toBeDefined();
    expect(ROLE_LABELS.LOYALTY_PARTNER).toBeDefined();
    expect(ROLE_LABELS.AI_ASSISTANT).toBeDefined();
  });
});

describe("role-guards — canEditUser", () => {
  it("возвращает true если редактируют свой профиль", async () => {
    const { canEditUser } = await import("@/lib/role-guards");
    const result = await canEditUser("user-1", "user-1");
    expect(result).toBe(true);
  });

  it("возвращает false если редактируют чужой профиль и нет admin роли (без env)", async () => {
    const { canEditUser } = await import("@/lib/role-guards");
    const result = await canEditUser("user-1", "user-2");
    expect(result).toBe(false);
  });
});
