/**
 * Тесты cron-auth.ts — R5/P1-3: timing-safe сверка X-Cron-Secret.
 *
 * Контракт:
 *   • CRON_SECRET не задан → отказ (false) — defensive default, не «разрешить всё»;
 *   • валидный секрет → true;
 *   • неверный секрет/пустой заголовок → false;
 *   • секрет другой длины (перебор байтов) → false;
 *   • сверка идёт через timingSafeEqualStr (crypto.timingSafeEqual) —
 *     unit-проверяем контракт secure-compare (constant-time, разные длины → false).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { timingSafeEqualStr } from "./secure-compare";
import {
  verifyCronSecret,
  cronUnauthorized,
} from "./cron-auth";

function makeRequest(secret?: string): Request {
  const headers = new Headers();
  if (secret !== undefined) headers.set("X-Cron-Secret", secret);
  return new Request("https://conditera.ru/api/cron/heartbeat", {
    method: "POST",
    headers,
  });
}

const ENV = process.env;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = ENV;
});

describe("verifyCronSecret — сверка секрета cron-эндпоинтов (R5)", () => {
  it("CRON_SECRET не задан → отказ (defensive default, fail-closed)", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret(makeRequest("anything"))).toBe(false);
    expect(verifyCronSecret(makeRequest())).toBe(false);
  });

  it("CRON_SECRET задан + валидный заголовок → доступ разрешён", () => {
    process.env.CRON_SECRET = "super-secret-cron-value";
    expect(verifyCronSecret(makeRequest("super-secret-cron-value"))).toBe(true);
  });

  it("невалидный секрет → отказ", () => {
    process.env.CRON_SECRET = "super-secret-cron-value";
    expect(verifyCronSecret(makeRequest("wrong-value"))).toBe(false);
    expect(verifyCronSecret(makeRequest("Super-Secret-Cron-Value"))).toBe(false); // регистр значим
  });

  it("секрет другой длины → отказ (без исключения)", () => {
    process.env.CRON_SECRET = "super-secret-cron-value";
    expect(verifyCronSecret(makeRequest("x"))).toBe(false);
    expect(
      verifyCronSecret(makeRequest("super-secret-cron-value-plus-extra"))
    ).toBe(false);
  });

  it("отсутствующий заголовок → отказ", () => {
    process.env.CRON_SECRET = "super-secret-cron-value";
    expect(verifyCronSecret(makeRequest())).toBe(false);
  });

  it("окружающие пробелы в заголовке обрезаются (trim), в секрете — тоже", () => {
    process.env.CRON_SECRET = "  super-secret-cron-value  ";
    expect(verifyCronSecret(makeRequest("super-secret-cron-value"))).toBe(true);
    expect(verifyCronSecret(makeRequest("  super-secret-cron-value  "))).toBe(true);
  });
});

describe("timingSafeEqualStr — контракт constant-time сравнения", () => {
  it("одинаковые строки → true (включая пустые)", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("", "")).toBe(true);
    expect(timingSafeEqualStr("секрет-с-кириллицей", "секрет-с-кириллицей")).toBe(true);
  });

  it("разные строки одной длины → false (сравнение по всем байтам)", () => {
    expect(timingSafeEqualStr("abcdef", "abcdeg")).toBe(false);
    expect(timingSafeEqualStr("a", "b")).toBe(false);
  });

  it("разные длины → false, без исключения", () => {
    expect(timingSafeEqualStr("short", "longer-string")).toBe(false);
    expect(timingSafeEqualStr("", "x")).toBe(false);
  });
});

describe("cronUnauthorized — контролируемый отказ", () => {
  it("возвращает 401 с JSON-ошибкой", () => {
    const res = cronUnauthorized();
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
