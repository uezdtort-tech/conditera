/**
 * Регрессионные тесты POST /api/upload — oversized-payload контракт
 * (DEV-20 / Release Gate v4.1; закрывает FINDING из U-12-upload-general-1362744.md).
 *
 * Контракт:
 *   - ≤ MAX_UPLOAD_BYTES, валидный multipart с честным Content-Length → 201 {url};
 *   - Content-Length > MAX_UPLOAD_BYTES → 422 {"error":"FILE_TOO_LARGE",
 *     "message":"Файл слишком большой: больше 10 МБ"} — pre-parse, тело не
 *     читается (в т.ч. реальное тело > 10 МБ — зона молчаливой обрезки
 *     платформой, body-streams.js DEFAULT_BODY_CLONE_SIZE_LIMIT);
 *   - chunked/мусор без Content-Length → 400 BAD_REQUEST (документированная
 *     зона, прежнее поведение сохранено);
 *   - форма ответа ошибки неизменна: {error, message}.
 *
 * Моки: @/lib/auth, @/lib/supabase/admin (storage) — герметично, без сети/БД.
 * Конвенции — src/app/api/health/route.test.ts (docblock-контекст, vi.mock,
 * русские describe/it, без ослабления проверок). jsdom-окружение (проектный
 * default, setup требует window): глобальный File подменяется на node:buffer
 * File — иначе undici-парсер multipart падает на webidl brand check (зонд A-3c).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { File as NodeFile } from "node:buffer";
import { NextRequest } from "next/server";

// --- Моки модулей (герметично, без сети и Supabase) ---

const getUserFromRequest = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}));

const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }),
    },
  },
}));

import { POST } from "./route";
import { MAX_UPLOAD_BYTES, OVERSIZE_UPLOAD_MESSAGE } from "@/lib/upload-service";

const DEMO_USER = { id: "confectioner-uuid", roles: ["CONFECTIONER"], email: "test@test.local" };
const MOCK_URL = "/storage/v1/object/public/media/misc/00000000-0000-4000-8000-000000000000.png";

// --- Multipart-хелперы (raw bytes — без зависимости от jsdom FormData) ---

const BOUNDARY = "----a3c-upload-boundary";

/** 1×1 валидный PNG (67 байт) — тот же fixture, что в scripts/verify. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function multipartFile(field: string, filename: string, mime: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
    ),
    bytes,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
}

function multipartFields(fields: Record<string, string>): Buffer {
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
  );
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

function makePost(body: Buffer, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/upload", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      ...headers,
    },
    body: new Uint8Array(body), // BodyInit: свежий ArrayBuffer для TS
  });
}

async function callPost(body: Buffer, headers: Record<string, string> = {}) {
  return POST(makePost(body, headers));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("File", NodeFile);
  getUserFromRequest.mockResolvedValue(DEMO_USER);
  uploadMock.mockResolvedValue({ error: null });
  getPublicUrlMock.mockReturnValue({ data: { publicUrl: MOCK_URL } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/upload — oversized-payload контракт (DEV-20)", () => {
  it("401 без аутентификации (базовая защита не тронута)", async () => {
    getUserFromRequest.mockResolvedValue(null);
    const res = await callPost(multipartFile("file", "a.png", "image/png", PNG_1X1), {
      "content-length": String(PNG_1X1.length),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHORIZED",
      message: "Требуется аутентификация",
    });
  });

  it("Content-Length > MAX_UPLOAD_BYTES (тело — мусор) → 422 FILE_TOO_LARGE pre-parse, storage не вызывается", async () => {
    // Мусорное тело: если бы запрос дошёл до formData(), контракт дал бы 400.
    // 422 доказывает, что гейт сработал ДО разбора тела.
    const res = await callPost(Buffer.from("garbage-not-multipart"), {
      "content-length": String(MAX_UPLOAD_BYTES + 1),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "FILE_TOO_LARGE",
      message: OVERSIZE_UPLOAD_MESSAGE,
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("реальное multipart-тело > 10 МБ с честным Content-Length → 422 FILE_TOO_LARGE (зона обрезки платформой)", async () => {
    // payload 10 МБ + 1: sniff не выполняется — гейт срабатывает раньше.
    const oversizePayload = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41);
    const body = multipartFile("file", "big.png", "image/png", oversizePayload);
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "FILE_TOO_LARGE",
      message: "Файл слишком большой: больше 10 МБ",
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("валидный 1×1 PNG ниже лимита → 201 {url}, файл уходит в storage", async () => {
    const body = multipartFile("file", "photo.png", "image/png", PNG_1X1);
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ url: MOCK_URL });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [filePath, buffer, opts] = uploadMock.mock.calls[0];
    expect(String(filePath)).toMatch(/^misc\/[0-9a-f-]{36}\.png$/);
    expect(Buffer.from(buffer as Uint8Array).equals(PNG_1X1)).toBe(true);
    expect((opts as { contentType: string }).contentType).toBe("image/png");
  });

  it("мусор без Content-Length (text/plain) → 400 BAD_REQUEST (форма ответа сохранена)", async () => {
    const res = await callPost(Buffer.from("plain garbage"), {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "BAD_REQUEST",
      message: "Ожидается multipart/form-data",
    });
  });

  it("chunked multipart без Content-Length + мусор → 400 BAD_REQUEST (документированная зона)", async () => {
    // content-type multipart, но тела нет Content-Length и boundary не совпадает.
    const res = await callPost(Buffer.from("chunked garbage without boundary"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "BAD_REQUEST",
      message: "Ожидается multipart/form-data",
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("валидный multipart без поля file → 400 NO_FILE (пост-parse поведение не троннуто)", async () => {
    const body = multipartFields({ category: "misc" });
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "NO_FILE",
      message: "Не передан файл (поле 'file')",
    });
  });
});
