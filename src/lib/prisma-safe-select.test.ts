/**
 * Тесты для src/lib/prisma-safe-select.ts — type-safe строковые select'ы
 * и функции для удаления/проверки sensitive полей.
 *
 * Тестируем:
 *   1. USER_PUBLIC_FIELDS / USER_SELF_FIELDS / USER_ADMIN_FIELDS — строки, не содержат sensitive
 *   2. omitSensitive — корректно убирает sensitive поля из строки select
 *   3. assertNoSensitiveFields — бросает Error при обнаружении sensitive поля
 *   4. sanitizeResponse — удаляет sensitive из ЛЮБОГО объекта рекурсивно
 *   5. SENSITIVE_FIELDS — справочник чувствительных полей по моделям
 */
import { describe, it, expect } from "vitest";
import {
  USER_PUBLIC_FIELDS,
  USER_SELF_FIELDS,
  USER_ADMIN_FIELDS,
  REFRESH_TOKEN_METADATA_FIELDS,
  SENSITIVE_FIELDS,
  omitSensitive,
  assertNoSensitiveFields,
  sanitizeResponse,
} from "@/lib/prisma-safe-select";

// Helper: разбивает comma-separated string в Set
function fieldsSet(s: string): Set<string> {
  return new Set(s.split(",").map((x) => x.trim()));
}

describe("USER_PUBLIC_FIELDS", () => {
  it("это строка (а не объект)", () => {
    expect(typeof USER_PUBLIC_FIELDS).toBe("string");
  });

  it("включает id, email, name", () => {
    const fields = fieldsSet(USER_PUBLIC_FIELDS);
    expect(fields.has("id")).toBe(true);
    expect(fields.has("email")).toBe(true);
    expect(fields.has("name")).toBe(true);
  });

  it("НЕ включает password_hash", () => {
    expect(USER_PUBLIC_FIELDS).not.toContain("password_hash");
  });

  it("НЕ включает tfa_secret", () => {
    expect(USER_PUBLIC_FIELDS).not.toContain("tfa_secret");
  });

  it("НЕ включает tfa_backup_codes", () => {
    expect(USER_PUBLIC_FIELDS).not.toContain("tfa_backup_codes");
  });

  it("НЕ включает last_login_ip (PII)", () => {
    expect(USER_PUBLIC_FIELDS).not.toContain("last_login_ip");
  });

  it("включает tfa_enabled (boolean flag, не secret)", () => {
    expect(USER_PUBLIC_FIELDS).toContain("tfa_enabled");
  });

  it("включает loyalty_level и bonus_balance", () => {
    expect(USER_PUBLIC_FIELDS).toContain("loyalty_level");
    expect(USER_PUBLIC_FIELDS).toContain("bonus_balance");
  });
});

describe("USER_SELF_FIELDS", () => {
  it("включает всё из USER_PUBLIC_FIELDS", () => {
    const publicFields = fieldsSet(USER_PUBLIC_FIELDS);
    const selfFields = fieldsSet(USER_SELF_FIELDS);
    for (const f of publicFields) {
      expect(selfFields.has(f)).toBe(true);
    }
  });

  it("включает last_login_at (видно самому пользователю)", () => {
    expect(USER_SELF_FIELDS).toContain("last_login_at");
  });

  it("всё ещё исключает password_hash, tfa_secret", () => {
    expect(USER_SELF_FIELDS).not.toContain("password_hash");
    expect(USER_SELF_FIELDS).not.toContain("tfa_secret");
  });
});

describe("USER_ADMIN_FIELDS", () => {
  it("включает last_login_ip (админ видит IP для anti-fraud)", () => {
    expect(USER_ADMIN_FIELDS).toContain("last_login_ip");
  });

  it("всё ещё исключает password_hash, tfa_secret, tfa_backup_codes", () => {
    expect(USER_ADMIN_FIELDS).not.toContain("password_hash");
    expect(USER_ADMIN_FIELDS).not.toContain("tfa_secret");
    expect(USER_ADMIN_FIELDS).not.toContain("tfa_backup_codes");
  });
});

describe("REFRESH_TOKEN_METADATA_FIELDS", () => {
  it("включает id, user_id, device", () => {
    expect(REFRESH_TOKEN_METADATA_FIELDS).toContain("id");
    expect(REFRESH_TOKEN_METADATA_FIELDS).toContain("user_id");
    expect(REFRESH_TOKEN_METADATA_FIELDS).toContain("device");
  });

  it("НЕ включает refresh_token (сам токен)", () => {
    expect(REFRESH_TOKEN_METADATA_FIELDS).not.toContain("refresh_token");
  });
});

describe("SENSITIVE_FIELDS registry", () => {
  it("перечисляет User sensitive поля (snake_case)", () => {
    expect(SENSITIVE_FIELDS.User).toContain("password_hash");
    expect(SENSITIVE_FIELDS.User).toContain("tfa_secret");
    expect(SENSITIVE_FIELDS.User).toContain("tfa_backup_codes");
    expect(SENSITIVE_FIELDS.User).toContain("last_login_ip");
  });

  it("перечисляет RefreshToken sensitive field", () => {
    expect(SENSITIVE_FIELDS.RefreshToken).toContain("refresh_token");
  });

  it("содержит только snake_case поля", () => {
    // Все ключи и значения должны быть snake_case, не camelCase
    for (const [model, fields] of Object.entries(SENSITIVE_FIELDS)) {
      expect(model).toMatch(/^[A-Z][A-Za-z0-9]*$/); // PascalCase model name
      for (const f of fields) {
        expect(f).toMatch(/^[a-z][a-z0-9_]*$/); // snake_case field name
      }
    }
  });
});

describe("omitSensitive", () => {
  it("убирает sensitive поля из строки select", () => {
    const select = "id, email, password_hash, tfa_secret";
    const safe = omitSensitive("User", select);
    const fields = fieldsSet(safe);
    expect(fields.has("id")).toBe(true);
    expect(fields.has("email")).toBe(true);
    expect(fields.has("password_hash")).toBe(false);
    expect(fields.has("tfa_secret")).toBe(false);
  });

  it("сохраняет non-sensitive поля", () => {
    const select = "id, name, email";
    const safe = omitSensitive("User", select);
    const fields = fieldsSet(safe);
    expect(fields.has("id")).toBe(true);
    expect(fields.has("name")).toBe(true);
    expect(fields.has("email")).toBe(true);
  });

  it("обрабатывает неизвестную модель (не убирает ничего)", () => {
    const select = "id, password_hash";
    const safe = omitSensitive("UnknownModel" as keyof typeof SENSITIVE_FIELDS, select);
    expect(safe).toContain("id");
    expect(safe).toContain("password_hash"); // не убрано, т.к. модель неизвестна
  });

  it("обрабатывает extra whitespace в select", () => {
    const select = "  id  ,  email  ,  password_hash  ";
    const safe = omitSensitive("User", select);
    expect(safe).toContain("id");
    expect(safe).not.toContain("password_hash");
  });
});

describe("assertNoSensitiveFields", () => {
  it("проходит для объекта без sensitive полей", () => {
    expect(() =>
      assertNoSensitiveFields({ id: "1", email: "test@test.ru" }, "User")
    ).not.toThrow();
  });

  it("бросает Error для password_hash", () => {
    expect(() =>
      assertNoSensitiveFields(
        { id: "1", password_hash: "hashed-secret" },
        "User"
      )
    ).toThrow(/password_hash/);
  });

  it("бросает Error для tfa_secret", () => {
    expect(() =>
      assertNoSensitiveFields({ id: "1", tfa_secret: "base32" }, "User")
    ).toThrow(/tfa_secret/);
  });

  it("работает с вложенными объектами", () => {
    expect(() =>
      assertNoSensitiveFields(
        { user: { id: "1", password_hash: "leaked" } },
        "User"
      )
    ).toThrow(/password_hash/);
  });

  it("работает с массивами", () => {
    expect(() =>
      assertNoSensitiveFields(
        [{ id: "1" }, { id: "2", tfa_secret: "leaked" }],
        "User"
      )
    ).toThrow(/tfa_secret/);
  });

  it("не бросает для non-sensitive объектов", () => {
    expect(() =>
      assertNoSensitiveFields(
        {
          id: "1",
          name: "John",
          email: "john@test.ru",
          loyalty_level: "BRONZE",
        },
        "User"
      )
    ).not.toThrow();
  });

  it("возвращает undefined (void) при успехе", () => {
    const result = assertNoSensitiveFields({ id: "1" }, "User");
    expect(result).toBeUndefined();
  });

  it("не падает на null/undefined/primitives", () => {
    expect(() => assertNoSensitiveFields(null, "User")).not.toThrow();
    expect(() => assertNoSensitiveFields(undefined, "User")).not.toThrow();
    expect(() => assertNoSensitiveFields("string", "User")).not.toThrow();
    expect(() => assertNoSensitiveFields(42, "User")).not.toThrow();
  });
});

describe("sanitizeResponse", () => {
  it("удаляет password_hash из ответа", () => {
    const input = { id: "1", name: "John", password_hash: "secret-hash" };
    const result = sanitizeResponse(input) as Record<string, unknown>;
    expect(result.id).toBe("1");
    expect(result.name).toBe("John");
    expect(result.password_hash).toBeUndefined();
  });

  it("удаляет tfa_secret и tfa_backup_codes", () => {
    const input = {
      id: "1",
      tfa_secret: "base32",
      tfa_backup_codes: ["hash1", "hash2"],
    };
    const result = sanitizeResponse(input) as Record<string, unknown>;
    expect(result.id).toBe("1");
    expect(result.tfa_secret).toBeUndefined();
    expect(result.tfa_backup_codes).toBeUndefined();
  });

  it("удаляет refresh_token", () => {
    const input = {
      id: "1",
      refresh_token: "token-abc",
      device: "Chrome",
    };
    const result = sanitizeResponse(input) as Record<string, unknown>;
    expect(result.id).toBe("1");
    expect(result.device).toBe("Chrome");
    expect(result.refresh_token).toBeUndefined();
  });

  it("обрабатывает массивы объектов", () => {
    const input = [
      { id: "1", password_hash: "hash1" },
      { id: "2", password_hash: "hash2" },
    ];
    const result = sanitizeResponse(input) as Array<Record<string, unknown>>;
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("1");
    expect(result[0].password_hash).toBeUndefined();
    expect(result[1].id).toBe("2");
    expect(result[1].password_hash).toBeUndefined();
  });

  it("обрабатывает вложенные объекты рекурсивно", () => {
    const input = {
      user: { id: "1", password_hash: "leaked" },
      confectioner: { id: "2", business_name: "Test" },
    };
    const result = sanitizeResponse(input) as {
      user: Record<string, unknown>;
      confectioner: Record<string, unknown>;
    };
    expect(result.user.id).toBe("1");
    expect(result.user.password_hash).toBeUndefined();
    expect(result.confectioner.business_name).toBe("Test");
  });

  it("пропускает primitive значения", () => {
    expect(sanitizeResponse("string")).toBe("string");
    expect(sanitizeResponse(42)).toBe(42);
    expect(sanitizeResponse(null)).toBe(null);
    expect(sanitizeResponse(undefined)).toBe(undefined);
  });
});
