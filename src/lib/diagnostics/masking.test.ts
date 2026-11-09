/**
 * Тесты masking.ts — DEPLOY-01 §3.2 (защита персональных данных и секретов).
 * Регрессия: секреты/PII не должны попадать в диагностические события даже
 * через стек, сообщения и метаданные.
 */
import { describe, it, expect } from "vitest";
import {
  maskString,
  maskStackTrace,
  scrub,
  stripControlChars,
  truncate,
  isSensitiveKey,
  safeJsonStringify,
  MAX_METADATA_CHARS,
  REDACTED,
} from "./masking";

describe("maskString — паттерны секретов", () => {
  it("маскирует JWT", () => {
    const input =
      "auth failed for eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = maskString(input);
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiIs");
    expect(out).toContain(REDACTED);
  });

  it("маскирует Bearer-токен", () => {
    const out = maskString("GET /api with Bearer abcdefghijklmnopqrst1234 rejected");
    expect(out).not.toContain("abcdefghijklmnopqrst1234");
  });

  it("маскирует пароль в URL", () => {
    const out = maskString("connect failed: postgresql://admin:s3cretpw@127.0.0.1:5432/db");
    expect(out).not.toContain("s3cretpw");
  });

  it("маскирует длинный supabase-подобный ключ", () => {
    const key =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz0123456789abcdefghij.0123456789abcdefghij0123456789abcdefghij012345";
    const out = maskString(`service key ${key} invalid`);
    expect(out).not.toContain("abcdefghij0123456789abcdefghij012345");
  });

  it("маскирует банковскую карту", () => {
    const out = maskString("payment error for card 4111 1111 1111 1111");
    expect(out).not.toContain("4111");
  });

  it("вырезает управляющие символы (log injection)", () => {
    const out = maskString("line1\nline2\r\nFAKE LOG LINE\u0000\u001B[31m");
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\u0000");
    expect(out).not.toContain("FAKE\nLOG");
  });

  it("обрезает длинную строку до MAX_STRING с пометкой", () => {
    const out = maskString("x".repeat(1000));
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).toContain("truncated");
  });
});

describe("stripControlChars / truncate / isSensitiveKey", () => {
  it("stripControlChars делает строку однострочной", () => {
    expect(stripControlChars("a\nb\nc")).toBe("a b c");
    expect(stripControlChars("a\u0007b")).toBe("ab");
  });

  it("truncate помечает обрезку", () => {
    expect(truncate("abcdef", 3)).toBe("abc…[truncated 3 chars]");
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("isSensitiveKey ловит варианты написания", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("userPassword")).toBe(true);
    expect(isSensitiveKey("AUTHORIZATION")).toBe(true);
    expect(isSensitiveKey("session_cookie")).toBe(true);
    expect(isSensitiveKey("cardNumber")).toBe(true);
    expect(isSensitiveKey("customer_email")).toBe(true);
    expect(isSensitiveKey("orderTitle")).toBe(false);
    expect(isSensitiveKey("route")).toBe(false);
  });
});

describe("scrub — глубокая очистка", () => {
  it("маскирует значения чувствительных ключей целиком", () => {
    const out = scrub({
      title: "order failed",
      password: "super-secret-value",
      nested: { apiKey: "AKIA123", note: "ok" },
    }) as Record<string, unknown>;
    expect(out.title).toBe("order failed");
    expect(out.password).toBe(REDACTED);
    const nested = out.nested as Record<string, unknown>;
    expect(nested.apiKey).toBe(REDACTED);
    expect(nested.note).toBe("ok");
  });

  it("защищён от циклических ссылок", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const out = scrub(a) as Record<string, unknown>;
    expect(out.name).toBe("a");
    expect(out.self).toBe("[circular]");
  });

  it("ограничивает глубину", () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: "deep" } } } } } } };
    const out = scrub(deep) as Record<string, unknown>;
    expect(JSON.stringify(out)).toContain("[max-depth]");
  });

  it("ограничивает суммарный размер метаданных", () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) big[`k${i}`] = "y".repeat(200);
    const str = safeJsonStringify(big);
    expect(str.length).toBeLessThan(MAX_METADATA_CHARS + 200);
    expect(str).toContain("[metadata-size-limit]");
  });

  it("Error сериализуется в name+message", () => {
    const out = scrub(new Error("boom with token Bearer abcdefghijklmno123456"));
    expect(out).toEqual({
      name: "Error",
      message: expect.stringContaining("boom"),
    });
    expect(JSON.stringify(out)).not.toContain("abcdefghijklmno123456");
  });

  it("не мутирует вход", () => {
    const input = { password: "keep-me-original", note: "x" };
    scrub(input);
    expect(input.password).toBe("keep-me-original");
  });
});

describe("maskStackTrace", () => {
  it("маскирует секреты в стеке и ограничивает размер", () => {
    const stack = [
      "Error: payment webhook failed",
      "    at handler (/app/api/payment/webhook/route.ts:42:13)",
      "  Authorization: Bearer verylongsecrettoken123456789",
    ].join("\n");
    const out = maskStackTrace(stack);
    expect(out).not.toContain("verylongsecrettoken123456789");
    expect(out).not.toContain("\u0000");
  });

  it("null/undefined → null", () => {
    expect(maskStackTrace(null)).toBeNull();
    expect(maskStackTrace(undefined)).toBeNull();
  });
});
