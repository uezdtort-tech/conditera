/**
 * Тесты для src/lib/http-helpers.ts — утилиты для API route handlers.
 *
 * Покрывает:
 *   1. safeJsonBody — парсинг валидного/невалидного JSON
 *   2. HttpError — конструкторы (badRequest, unauthorized, forbidden, ...)
 *   3. handleRouteError — преобразование ошибок в NextResponse
 *   4. requireField, readStringField, readEnumField — валидация полей
 */
import { describe, it, expect } from "vitest";
import {
  safeJsonBody,
  HttpError,
  handleRouteError,
  requireField,
  readStringField,
  readEnumField,
} from "@/lib/http-helpers";

// Helper: создать NextRequest с заданным телом.
function makeRequest(body: unknown, init?: RequestInit): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://example.com/api/test", {
    method: "POST",
    body: text,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("safeJsonBody", () => {
  it("парсит валидный JSON", async () => {
    const req = makeRequest({ foo: "bar", num: 42 });
    const { data, error } = await safeJsonBody<{ foo: string; num: number }>(req);
    expect(error).toBeNull();
    expect(data).toEqual({ foo: "bar", num: 42 });
  });

  it("возвращает ошибку при невалидном JSON", async () => {
    const req = makeRequest("not-json-content", {
      method: "POST",
      body: "not-json-content",
    });
    const { data, error } = await safeJsonBody(req);
    expect(data).toBeNull();
    expect(error).toContain("Невалидный JSON");
  });

  it("возвращает ошибку при пустом теле", async () => {
    const req = new Request("https://example.com/api/test", { method: "POST" });
    const { data, error } = await safeJsonBody(req);
    expect(data).toBeNull();
    expect(error).toContain("пусто");
  });

  it("возвращает ошибку при невалидном JSON через string init", async () => {
    const req = new Request("https://example.com/api/test", {
      method: "POST",
      body: "{ not valid json",
    });
    const { data, error } = await safeJsonBody(req);
    expect(data).toBeNull();
    expect(error).toContain("Невалидный JSON");
  });
});

describe("HttpError", () => {
  it("создаёт ошибку с status и message", () => {
    const err = new HttpError(400, "Bad request", "details");
    expect(err.status).toBe(400);
    expect(err.message).toBe("Bad request");
    expect(err.detail).toBe("details");
    expect(err.name).toBe("HttpError");
  });

  it("создаёт badRequest", () => {
    const err = HttpError.badRequest("Bad");
    expect(err.status).toBe(400);
    expect(err.message).toBe("Bad");
  });

  it("создаёт unauthorized с дефолтным сообщением", () => {
    const err = HttpError.unauthorized();
    expect(err.status).toBe(401);
    expect(err.message).toBe("Не авторизован");
  });

  it("создаёт forbidden с дефолтным сообщением", () => {
    const err = HttpError.forbidden();
    expect(err.status).toBe(403);
  });

  it("создаёт notFound с дефолтным сообщением", () => {
    const err = HttpError.notFound();
    expect(err.status).toBe(404);
  });

  it("создаёт unprocessable", () => {
    const err = HttpError.unprocessable("Invalid");
    expect(err.status).toBe(422);
  });

  it("создаёт tooMany", () => {
    const err = HttpError.tooMany();
    expect(err.status).toBe(429);
  });

  it("создаёт internal", () => {
    const err = HttpError.internal("Err", "trace");
    expect(err.status).toBe(500);
    expect(err.detail).toBe("trace");
  });
});

describe("handleRouteError", () => {
  it("возвращает корректный статус для HttpError", async () => {
    const err = new HttpError(422, "Validation failed");
    const res = handleRouteError(err);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("возвращает 500 для неизвестной ошибки", async () => {
    const err = new Error("Unexpected");
    const res = handleRouteError(err);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Внутренняя ошибка сервера");
  });

  it("не раскрывает детали для не-HttpError", async () => {
    const err = new Error("DB connection string postgres://user:pass@host");
    const res = handleRouteError(err);
    const body = await res.json();
    expect(body.error).toBe("Внутренняя ошибка сервера");
    expect(body.detail).toBeUndefined();
  });
});

describe("requireField", () => {
  it("возвращает null для валидного строкового значения", () => {
    expect(requireField("hello", "name")).toBeNull();
  });

  it("возвращает null для числового значения", () => {
    expect(requireField(42, "count")).toBeNull();
  });

  it("возвращает ошибку для undefined", () => {
    expect(requireField(undefined, "name")).toContain("обязательно");
  });

  it("возвращает ошибку для null", () => {
    expect(requireField(null, "name")).toContain("обязательно");
  });

  it("возвращает ошибку для пустой строки", () => {
    expect(requireField("   ", "name")).toContain("пустым");
  });
});

describe("readStringField", () => {
  it("читает валидное значение", () => {
    const { value, error } = readStringField({ name: "Anna" }, "name");
    expect(error).toBeNull();
    expect(value).toBe("Anna");
  });

  it("тримит пробелы", () => {
    const { value } = readStringField({ name: "  Anna  " }, "name");
    expect(value).toBe("Anna");
  });

  it("возвращает ошибку при required и отсутствующем поле", () => {
    const { value, error } = readStringField({}, "name", { required: true });
    expect(value).toBeNull();
    expect(error).toContain("обязательно");
  });

  it("возвращает ошибку при превышении maxLength", () => {
    const { value, error } = readStringField(
      { name: "a".repeat(200) },
      "name",
      { maxLength: 100 }
    );
    expect(value).toBeNull();
    expect(error).toContain("слишком длинное");
  });

  it("возвращает null для отсутствующего не-required поля", () => {
    const { value, error } = readStringField({}, "name");
    expect(value).toBeNull();
    expect(error).toBeNull();
  });

  it("возвращает ошибку для не-строкового значения", () => {
    const { value, error } = readStringField({ name: 42 }, "name");
    expect(value).toBeNull();
    expect(error).toContain("строкой");
  });
});

describe("readEnumField", () => {
  const STATUSES = ["active", "draft", "archived"] as const;

  it("читает валидное значение", () => {
    const { value, error } = readEnumField({ status: "active" }, "status", STATUSES);
    expect(error).toBeNull();
    expect(value).toBe("active");
  });

  it("возвращает ошибку при невалидном значении", () => {
    const { value, error } = readEnumField({ status: "invalid" }, "status", STATUSES);
    expect(value).toBeNull();
    expect(error).toContain("active, draft, archived");
  });

  it("возвращает null для отсутствующего не-required поля", () => {
    const { value, error } = readEnumField({}, "status", STATUSES);
    expect(value).toBeNull();
    expect(error).toBeNull();
  });

  it("возвращает ошибку при required и отсутствующем поле", () => {
    const { value, error } = readEnumField({}, "status", STATUSES, { required: true });
    expect(value).toBeNull();
    expect(error).toContain("обязательно");
  });
});
