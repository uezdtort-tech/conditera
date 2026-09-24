/**
 * GET  /api/stories — лента сторис (все активные, не истёкшие)
 *   Query: ?confectionerId=... — сторис конкретного кондитера
 *          ?productId=... — сторис с привязкой к товару
 *
 * POST /api/stories — создать сторис (только CONFECTIONER)
 *   Body: {
 *     image: string (URL),     // обязательное поле
 *     video?: string (URL),
 *     type?: "image" | "video",
 *     caption?: string,
 *     duration?: number,        // по умолчанию 5 сек
 *     productId?: string,
 *     promotionId?: string,
 *   }
 *   TTL = 24 часа (expires_at = created_at + 24h)
 *
 * GET: public endpoint (любой может смотреть)
 * POST: CONFECTIONER only
 *
 * Соответствует таблицам: channel_stories, confectioners
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_STORIES_RETURN = 50;
const STORY_TTL_HOURS = 24;

interface CreateStoryBody {
  image?: string;
  video?: string;
  type?: "image" | "video";
  caption?: string;
  duration?: number;
  productId?: string;
  promotionId?: string;
}

/**
 * Mock-сторис для dev (если БД недоступна).
 */
function getMockStories(confectionerId?: string | null): any[] {
  const now = new Date();
  const expires = new Date(now.getTime() + 22 * 60 * 60 * 1000);
  return [
    {
      id: "mock-s1",
      confectioner_id: confectionerId || "c0",
      image: "https://images.unsplash.com/photo-1535141192574-5d4897c12636?w=400",
      video: null,
      type: "image",
      caption: "Свежий торт «Красный бархат» 🎂",
      duration: 5,
      product_id: null,
      views_count: 47,
      likes_count: 12,
      replies_count: 3,
      expires_at: expires.toISOString(),
      created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "mock-s2",
      confectioner_id: confectionerId || "c0",
      image: "https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=400",
      video: null,
      type: "image",
      caption: "Процесс украшения 🌸",
      duration: 7,
      product_id: null,
      views_count: 89,
      likes_count: 24,
      replies_count: 5,
      expires_at: expires.toISOString(),
      created_at: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "mock-s3",
      confectioner_id: confectionerId || "c1",
      image: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400",
      video: null,
      type: "image",
      caption: "Свадебный торт на 100 гостей 💍",
      duration: 8,
      product_id: null,
      views_count: 156,
      likes_count: 47,
      replies_count: 12,
      expires_at: expires.toISOString(),
      created_at: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
    },
  ];
}

/**
 * GET /api/stories — получить ленту сторис.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const confectionerId = sp.get("confectionerId");
    const productId = sp.get("productId");

    const nowIso = new Date().toISOString();

    let query = supabaseAdmin
      .from("channel_stories")
      .select("*")
      .gt("expires_at", nowIso)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(MAX_STORIES_RETURN);

    if (confectionerId) {
      query = query.eq("confectioner_id", confectionerId);
    }
    if (productId) {
      query = query.eq("product_id", productId);
    }

    const { data: stories, error } = await query;

    if (error) {
      console.warn("[stories] GET query error:", error.message);
      // Fallback на mock в dev
      return NextResponse.json({
        stories: getMockStories(confectionerId),
        total: 3,
        mock: true,
      });
    }

    return NextResponse.json({
      stories: stories || [],
      total: (stories || []).length,
    });
  } catch (error: any) {
    console.error("[stories] GET error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stories — создать сторис.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    // Проверка роли — только CONFECTIONER
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = (await request.json()) as CreateStoryBody;
    const { image, video, type, caption, duration, productId, promotionId } = body;

    if (!image && !video) {
      return NextResponse.json(
        { error: "Нужно указать image или video URL" },
        { status: 400 }
      );
    }

    // TTL = 24 часа
    const expiresAt = new Date(Date.now() + STORY_TTL_HOURS * 60 * 60 * 1000).toISOString();

    // Найти профиль кондитера
    const { data: confectioner, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (confErr || !confectioner) {
      return NextResponse.json(
        { error: "Профиль кондитера не найден" },
        { status: 404 }
      );
    }

    const { data: story, error: insertErr } = await supabaseAdmin
      .from("channel_stories")
      .insert({
        confectioner_id: confectioner.id,
        image: image || "",
        video: video || null,
        type: type || (video ? "video" : "image"),
        caption: caption || null,
        duration: duration || 5,
        product_id: productId || null,
        promotion_id: promotionId || null,
        expires_at: expiresAt,
        views_count: 0,
        likes_count: 0,
        replies_count: 0,
        sort_order: 0,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[stories] create failed:", insertErr.message);
      // Mock для dev если БД недоступна
      const mockStory = {
        id: `mock-${Date.now()}`,
        confectioner_id: confectioner.id,
        image: image || "",
        video: video || null,
        type: type || (video ? "video" : "image"),
        caption: caption || null,
        duration: duration || 5,
        product_id: productId || null,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
        mock: true,
      };
      return NextResponse.json({ story: mockStory }, { status: 201 });
    }

    return NextResponse.json({ story }, { status: 201 });
  } catch (error: any) {
    console.error("[stories] POST error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
