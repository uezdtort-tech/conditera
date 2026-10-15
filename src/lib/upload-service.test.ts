/**
 * Регрессионные тесты parseUploadRequest — гейт размера multipart-запросов
 * (DEV-20 / Release Gate v4.1; U-12, U-13).
 *
 * Три зоны контракта на границе MAX_UPLOAD_BYTES (10 МБ, ЛИМИТ НЕ МЕНЯЛСЯ):
 *   - Content-Length = MAX ровно → гейт пропускает, form разбирается (ниже-лимит зона);
 *   - Content-Length = MAX + 1 → 422 FILE_TOO_LARGE ЕЩЁ ДО разбора тела
 *     (тело в тесте — мусор: если бы гейт не сработал pre-parse, formData()
 *     бросил бы и мы получили 400, а не 422 — тест различает зоны);
 *   - без Content-Length (chunked) или с нечисловым заголовком + неразбираемое
 *     тело → 400 BAD_REQUEST (документированная зона, прежнее поведение).
 *
 * Моки: @/lib/supabase/admin (импортируется upload-service на уровне модуля) —
 * герметично, без сети. Окружение jsdom (проектный default, setup требует
 * window): глобальный File подменяется на node:buffer File, иначе undici-парсер
 * multipart падает на webidl brand check (зонд задокументирован в worklog A-3c).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { File as NodeFile } from "node:buffer";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {},
}));

import {
  MAX_UPLOAD_BYTES,
  OVERSIZE_UPLOAD_MESSAGE,
  UploadServiceError,
  parseUploadRequest,
} from "./upload-service";

const BOUNDARY = "----a3c-boundary";
const REQ_URL = "http://localhost:3000/api/upload";

function makeRequest(body: Buffer, headers: Record<string, string> = {}): Request {
  return new Request(REQ_URL, {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
      ...headers,
    },
    body: new Uint8Array(body), // BodyInit: свежий ArrayBuffer для TS
  });
}

/** Multipart-тело с одной файловой частью; возвращает тело и overhead (head+tail). */
function buildFileBody(payload: Buffer): { body: Buffer; overhead: number } {
  const head = Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return { body: Buffer.concat([head, payload, tail]), overhead: head.length + tail.length };
}

beforeEach(() => {
  vi.stubGlobal("File", NodeFile);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseUploadRequest — граница MAX_UPLOAD_BYTES (DEV-20)", () => {
  it("Content-Length = MAX_UPLOAD_BYTES ровно → гейт пропускает, form разбирается", async () => {
    // Тело ДОСТРОЕНО до ровно 10 МБ суммарно: payload = MAX - overhead.
    const { body, overhead } = buildFileBody(Buffer.alloc(0));
    const payload = Buffer.alloc(MAX_UPLOAD_BYTES - overhead, 0x41);
    const exact = buildFileBody(payload);
    expect(exact.body.length).toBe(MAX_UPLOAD_BYTES);

    const form = await parseUploadRequest(
      makeRequest(exact.body, { "content-length": String(MAX_UPLOAD_BYTES) })
    );
    const file = form.get("file");
    expect(file instanceof File).toBe(true);
    expect((file as File).size).toBe(payload.length);
    expect((file as File).size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES); // пройдёт и per-file гейт
  });

  it("Content-Length = MAX_UPLOAD_BYTES + 1 (тело — мусор) → 422 FILE_TOO_LARGE pre-parse", async () => {
    // Мусорное тело + честный «большой» заголовок: если бы тело читалось,
    // formData() бросил бы и контракт был бы 400. 422 доказывает pre-parse гейт.
    const err = await parseUploadRequest(
      makeRequest(Buffer.from("garbage-not-multipart"), {
        "content-length": String(MAX_UPLOAD_BYTES + 1),
      })
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UploadServiceError);
    const e = err as UploadServiceError;
    expect(e.status).toBe(422);
    expect(e.code).toBe("FILE_TOO_LARGE");
    expect(e.message).toBe(OVERSIZE_UPLOAD_MESSAGE);
  });

  it("без Content-Length (chunked) + неразбираемое тело → 400 BAD_REQUEST (документированная зона)", async () => {
    await expect(
      parseUploadRequest(makeRequest(Buffer.from("chunked-garbage")))
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Ожидается multipart/form-data",
    });
  });

  it("нечисловой Content-Length → трактуется как chunked-зона: 400 BAD_REQUEST", async () => {
    await expect(
      parseUploadRequest(
        makeRequest(Buffer.from("garbage"), { "content-length": "12abc" })
      )
    ).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST" });
  });

  it("OVERSIZE_UPLOAD_MESSAGE согласован с контрактом (формат per-file сообщений)", () => {
    expect(OVERSIZE_UPLOAD_MESSAGE).toBe("Файл слишком большой: больше 10 МБ");
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024); // лимит не менялся
  });
});
