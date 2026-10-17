/**
 * Регрессионные тесты POST /api/services/upload — oversized-payload контракт
 * (DEV-20 / Release Gate v4.1; закрывает FINDING из U-13-upload-services-1362744.md).
 *
 * Контракт (поле `files`, роут делит хелпер parseUploadRequest с /api/upload):
 *   - ≤ MAX_UPLOAD_BYTES, валидный multipart с честным Content-Length → 201 {urls};
 *   - Content-Length > MAX_UPLOAD_BYTES → 422 {"error":"FILE_TOO_LARGE"} —
 *     pre-parse, тело не читается (зона обрезки платформой покрыта);
 *   - chunked/мусор без Content-Length → 400 BAD_REQUEST (документированная зона);
 *   - пост-parse поведения (NO_FILES / TOO_MANY_FILES) не тронуты.
 *
 * Моки: @/lib/auth, @/lib/supabase/admin (storage) — герметично, без сети/БД.
 * Конвенции — src/app/api/health/route.test.ts. jsdom-окружение (проектный
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
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, OVERSIZE_UPLOAD_MESSAGE } from "@/lib/upload-service";

const DEMO_USER = { id: "confectioner-uuid", roles: ["CONFECTIONER"], email: "test@test.local" };
const MOCK_URL = "/storage/v1/object/public/media/services/00000000-0000-4000-8000-000000000000.png";

// --- Multipart-хелперы (raw bytes — без зависимости от jsdom FormData) ---

const BOUNDARY = "----a3c-services-upload-boundary";

/** 1×1 валидный PNG (67 байт) — тот же fixture, что в scripts/verify. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function multipartFiles(filenames: string[]): Buffer {
  const parts = filenames.map((filename) =>
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`
      ),
      PNG_1X1,
      Buffer.from(`\r\n`),
    ])
  );
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(parts);
}

function makePost(body: Buffer, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/services/upload", {
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

describe("POST /api/services/upload — oversized-payload контракт (DEV-20)", () => {
  it("401 без аутентификации (базовая защита не тронута)", async () => {
    getUserFromRequest.mockResolvedValue(null);
    const res = await callPost(multipartFiles(["a.png"]), {
      "content-length": String(PNG_1X1.length),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHORIZED",
      message: "Требуется аутентификация",
    });
  });

  it("Content-Length > MAX_UPLOAD_BYTES (тело — мусор) → 422 FILE_TOO_LARGE pre-parse, storage не вызывается", async () => {
    // Мусорное тело: без pre-parse гейта formData() бросил бы → был бы 400.
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
    const oversizePayload = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41);
    const body = Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="big.png"\r\nContent-Type: image/png\r\n\r\n`
      ),
      oversizePayload,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ]);
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "FILE_TOO_LARGE",
      message: "Файл слишком большой: больше 10 МБ",
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("валидный 1×1 PNG ниже лимита → 201 {urls:[…]}, файл уходит в services/", async () => {
    const body = multipartFiles(["photo.png"]);
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ urls: [MOCK_URL] });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [filePath] = uploadMock.mock.calls[0];
    expect(String(filePath)).toMatch(/^services\/[0-9a-f-]{36}\.png$/);
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
    const res = await callPost(Buffer.from("chunked garbage without boundary"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "BAD_REQUEST",
      message: "Ожидается multipart/form-data",
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("валидный multipart без файлов → 400 NO_FILES (пост-parse поведение не троннуто)", async () => {
    const body = Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nx\r\n`),
      Buffer.from(`--${BOUNDARY}--\r\n`),
    ]);
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "NO_FILES",
      message: "Не передано файлов (поле 'files')",
    });
  });

  it("9 файлов (> MAX_UPLOAD_FILES) → 400 TOO_MANY_FILES, storage не вызывается", async () => {
    const names = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, i) => `f${i}.png`);
    const body = multipartFiles(names);
    const res = await callPost(body, { "content-length": String(body.length) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "TOO_MANY_FILES",
      message: `Максимум ${MAX_UPLOAD_FILES} файлов за запрос`,
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });
});
