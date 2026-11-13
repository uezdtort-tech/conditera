/**
 * ZV33-7b FIX 3 (ZV33-6 C-2): GET /api/video-feed — сбой БД больше НЕ
 * маскируется MOCK_VIDEOS.
 *
 * Лочит контракт:
 *   a) здоровый путь → 200 + реальные строки (snake_case-маппинг сохранён);
 *   b) ошибка БД → 503 { error } — МАСКИРОВАННОЕ сообщение, никакого
 *      fabricated-контента (mux-стримы/unsplash-постеры mock-ленты);
 *   c) пустая таблица → честный 200 { videos: [], total: 0 }.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

// FIFO результатов запроса к video_feed_items
let videoQueue: Result[];

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const resultFor = (): Result => {
        if (table === "video_feed_items") {
          return videoQueue.length > 0 ? videoQueue.shift()! : { data: [], error: null };
        }
        return { data: [], error: null };
      };
      const b: Record<string, unknown> = {
        select: vi.fn(() => b),
        eq: vi.fn(() => b),
        order: vi.fn(() => b),
        range: vi.fn(() => b),
        insert: vi.fn(() => b),
        then: (
          res?: (v: unknown) => unknown,
          rej?: (e: unknown) => unknown
        ) => Promise.resolve(resultFor()).then(res as never, rej as never),
      };
      return b;
    }),
  },
}));

const getUserFromRequest = vi.fn();
vi.mock("@/lib/auth", () => ({
  getUserFromRequest: (...args: unknown[]) => getUserFromRequest(...args),
}));

import { GET } from "./route";

async function callGet(query = "?limit=10"): Promise<Response> {
  const req = new NextRequest(`http://localhost:3000/api/video-feed${query}`);
  return GET(req);
}

function expectNoMockPayload(json: unknown): void {
  const s = JSON.stringify(json);
  expect(s).not.toContain("test-streams.mux.dev");
  expect(s).not.toContain("images.unsplash.com/photo-1535254973040");
  expect(s).not.toContain("Создаю свадебный торт");
  expect(s).not.toContain("Бенто-торт за 5 минут");
}

beforeEach(() => {
  vi.clearAllMocks();
  videoQueue = [];
});

describe("GET /api/video-feed — no-mock контракт (ZV33-7b FIX 3)", () => {
  it("здоровый путь → 200 + реальные строки (snake_case-маппинг)", async () => {
    videoQueue = [
      {
        data: [
          {
            id: "db-v1",
            confectionerId: "conf-uuid-1",
            videoUrl: "https://real.example/hls/real.m3u8",
            posterUrl: "/api/upload/poster.png",
            title: "Реальное видео из БД",
            description: null,
            viewsCount: 12,
            likesCount: 3,
            commentsCount: 1,
            sharesCount: 0,
            productId: null,
            audioTitle: null,
            rating: 50,
            status: "active",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
    ];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      videos: Array<Record<string, unknown>>;
      total: number;
    };
    expect(json.total).toBe(1);
    expect(json.videos[0].id).toBe("db-v1");
    expect(json.videos[0].video_url).toBe("https://real.example/hls/real.m3u8");
    expect(json.videos[0].confectioner_id).toBe("conf-uuid-1");
    expectNoMockPayload(json);
  });

  it("ошибка БД → 503 с маскированным сообщением, БЕЗ mock-ленты", async () => {
    videoQueue = [{ data: null, error: { message: "connection refused" } }];
    const res = await callGet();
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string; videos?: unknown };
    expect(json.error).toBe("Видеолента временно недоступна, попробуйте позже");
    // ключевой регресс: mock-лента не просочилась в ответ
    expect(json.videos).toBeUndefined();
    expectNoMockPayload(json);
  });

  it("пустая таблица → честный 200 { videos: [], total: 0 }", async () => {
    videoQueue = [{ data: [], error: null }];
    const res = await callGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { videos: unknown[]; total: number };
    expect(json.videos).toEqual([]);
    expect(json.total).toBe(0);
    expectNoMockPayload(json);
  });
});
