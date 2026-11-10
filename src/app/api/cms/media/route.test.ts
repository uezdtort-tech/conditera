/**
 * cms-media.test.ts — регрессия Z-v21 (аудит §10 Storage).
 *
 * Лочит исправление POST /api/cms/media:
 *   • без роли CMS (например CUSTOMER) → 403, файл НЕ загружается,
 *     запись в cms_media НЕ создаётся (раньше: любой authenticated мог
 *     загрузить до 50 МБ без проверки типа);
 *   • файл с нераспознанным содержимым (подделка Content-Type: image/png)
 *     → 415 fail-closed, ничего не сохраняется (раньше: клиентский
 *     Content-Type/расширение доверялись);
 *   • настоящий PNG по магическим байтам → 201, contentType записи =
 *     image/png из сниффа, расширение файла из сниффа (не из имени клиента).
 *
 * Среда node (не jsdom): NextRequest.formData() работает с undici FormData;
 * jsdom-Blob несовместим с парсером Next (все multipart-тесты падали в 500).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = {
  user: { id: "11111111-1111-4111-8111-111111111107", roles: ["ADMIN"] },
  guardError: null as Record<string, unknown> | null,
  uploads: [] as Array<{ path: string; contentType: string; size: number }>,
  inserted: [] as Array<Record<string, unknown>>,
};

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: (_table: string) => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            state.inserted.push(row);
            return { data: { ...row, id: "cm-1" }, error: null };
          },
        }),
      }),
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    }),
    storage: {
      from: (_bucket: string) => ({
        upload: async (path: string, body: ArrayBuffer | Buffer, opts: { contentType: string }) => {
          state.uploads.push({
            path,
            contentType: opts.contentType,
            size: body instanceof Buffer ? body.length : body.byteLength,
          });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.local/${path}` } }),
      }),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  getUserFromRequest: vi.fn(async () => state.user),
}));

vi.mock("@/lib/supabase/auth", () => ({
  unauthorizedResponse: () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
  forbiddenResponse: () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
}));

vi.mock("@/lib/role-guards", () => ({
  requireAnyRole: vi.fn(async () => state.guardError),
}));

// sharp — нативный модуль; в vitest/jsdom может не загрузиться. Реальному
// sniffMime (магические байты) sharp не нужен — глушим только сам sharp.
vi.mock("sharp", () => ({ default: {} }));

import { POST } from "./route";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

function makeRequest(file: { bytes: Buffer; name: string; type: string }): NextRequest {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(file.bytes)], { type: file.type });
  form.append("file", blob, file.name);
  return new NextRequest("http://localhost:3000/api/cms/media", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/cms/media — Z-v21 role gate + content sniffing", () => {
  beforeEach(() => {
    state.uploads = [];
    state.inserted = [];
    state.guardError = null;
    state.user = { id: "11111111-1111-4111-8111-111111111107", roles: ["ADMIN"] };
  });

  it("CUSTOMER (нет CMS-роли) → 403, загрузки и записи нет", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111106", roles: ["CUSTOMER"] };
    state.guardError = { body: { error: "forbidden" } as unknown as BodyInit, status: 403, headers: {} } as never;
    const res = await POST(makeRequest({ bytes: PNG_BYTES, name: "x.png", type: "image/png" }));
    expect(res.status).toBe(403);
    expect(state.uploads).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });

  it("подделка Content-Type (текст под видом PNG) → 415, ничего не сохраняется", async () => {
    const fake = Buffer.from("definitely not an image, just plain text");
    const res = await POST(makeRequest({ bytes: fake, name: "evil.png", type: "image/png" }));
    expect(res.status).toBe(415);
    expect(state.uploads).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
  });

  it("настоящий PNG → 201, mime/расширение из сниффа, не из имени клиента", async () => {
    const res = await POST(
      makeRequest({ bytes: PNG_BYTES, name: "report.pdf", type: "application/pdf" })
    );
    expect(res.status).toBe(201);
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0].contentType).toBe("image/png");
    expect(state.uploads[0].path.endsWith(".png")).toBe(true);
    expect(state.inserted[0].mime_type).toBe("image/png");
    expect(state.inserted[0].type).toBe("image");
  });
});
