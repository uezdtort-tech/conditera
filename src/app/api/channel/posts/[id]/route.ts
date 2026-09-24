/**
 * GET    /api/channel/posts/:id — получить публикацию
 * PATCH  /api/channel/posts/:id — обновить (владелец или ADMIN)
 * DELETE /api/channel/posts/:id — удалить (владелец или ADMIN)
 *
 * Auth: GET public, PATCH/DELETE — владелец (через confectioner.user_id) или ADMIN
 *
 * Безопасность:
 *   • PATCH: парсинг JSON безопасен (safeJsonBody), 400 при невалидном теле.
 *   • PATCH: валидация типов полей перед UPDATE — не передаём в БД невалидные данные.
 *   • Ownership check: через confectioner.user_id, не через post.user_id —
 *     нельзя редактировать чужой пост даже зная post.id.
 *   • При DB error не возвращаем детали клиенту.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

const MAX_CONTENT_LENGTH = 10_000;
const MAX_IMAGES_COUNT = 10;

interface PatchPostBody {
  content?: string;
  images?: unknown;
  isPinned?: boolean;
  isPublished?: boolean;
}

export async function GET(_request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id) throw new HttpError(400, "ID required");

    const { data: post, error } = await supabaseAdmin
      .from("channel_posts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[channel/posts/:id] GET error:", error.message);
      throw new HttpError(500, "Ошибка при загрузке публикации");
    }
    if (!post) throw new HttpError(404, "Публикация не найдена");

    return NextResponse.json({ post });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id) throw new HttpError(400, "ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    // Find post + check ownership
    const { data: post, error: postErr } = await supabaseAdmin
      .from("channel_posts")
      .select("id, confectioner_id")
      .eq("id", id)
      .maybeSingle();

    if (postErr) {
      console.error("[channel/posts/:id] lookup failed:", postErr.message);
      throw new HttpError(500, "Не удалось найти публикацию");
    }
    if (!post) throw new HttpError(404, "Не найдено");

    // Check ownership via confectioner.user_id
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("user_id")
      .eq("id", post.confectioner_id)
      .maybeSingle();

    if (confErr) {
      console.error("[channel/posts/:id] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить владельца");
    }

    const isOwner = conf?.user_id === user.id;
    const adminCheck = await isAdmin(user.id);
    if (!isOwner && !adminCheck) {
      throw new HttpError(403, "Нет прав");
    }

    const { data: body, error: parseErr } = await safeJsonBody<PatchPostBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    const updateData: Record<string, unknown> = {};

    if (body.content !== undefined) {
      if (typeof body.content !== "string") {
        throw new HttpError(422, "content должен быть строкой");
      }
      if (body.content.length > MAX_CONTENT_LENGTH) {
        throw new HttpError(422, `content слишком длинный (макс ${MAX_CONTENT_LENGTH} символов)`);
      }
      updateData.content = body.content;
    }

    if (body.images !== undefined) {
      if (!Array.isArray(body.images)) {
        throw new HttpError(422, "images должен быть массивом");
      }
      if (body.images.length > MAX_IMAGES_COUNT) {
        throw new HttpError(422, `images: слишком много элементов (макс ${MAX_IMAGES_COUNT})`);
      }
      // Все элементы должны быть строками (URL/paths)
      for (const img of body.images) {
        if (typeof img !== "string") {
          throw new HttpError(422, "images: каждый элемент должен быть строкой");
        }
      }
      updateData.images = body.images;
    }

    if (body.isPinned !== undefined) {
      if (typeof body.isPinned !== "boolean") {
        throw new HttpError(422, "isPinned должен быть boolean");
      }
      updateData.is_pinned = body.isPinned;
    }

    if (body.isPublished !== undefined) {
      if (typeof body.isPublished !== "boolean") {
        throw new HttpError(422, "isPublished должен быть boolean");
      }
      updateData.is_published = body.isPublished;
    }

    // Если нет полей для обновления — возвращаем текущий пост без UPDATE.
    if (Object.keys(updateData).length === 0) {
      const { data: current, error: curErr } = await supabaseAdmin
        .from("channel_posts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (curErr || !current) {
        throw new HttpError(500, "Не удалось получить публикацию");
      }
      return NextResponse.json({ post: current });
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("channel_posts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      console.error("[channel/posts/:id] update failed:", updateErr.message);
      throw new HttpError(500, "Не удалось обновить публикацию");
    }
    return NextResponse.json({ post: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    if (!id) throw new HttpError(400, "ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const { data: post, error: postErr } = await supabaseAdmin
      .from("channel_posts")
      .select("confectioner_id")
      .eq("id", id)
      .maybeSingle();

    if (postErr) {
      console.error("[channel/posts/:id] lookup failed:", postErr.message);
      throw new HttpError(500, "Не удалось найти публикацию");
    }
    if (!post) throw new HttpError(404, "Не найдено");

    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("user_id")
      .eq("id", post.confectioner_id)
      .maybeSingle();

    if (confErr) {
      console.error("[channel/posts/:id] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить владельца");
    }

    const isOwner = conf?.user_id === user.id;
    const adminCheck = await isAdmin(user.id);
    if (!isOwner && !adminCheck) {
      throw new HttpError(403, "Нет прав");
    }

    const { error: delErr } = await supabaseAdmin
      .from("channel_posts")
      .delete()
      .eq("id", id);
    if (delErr) {
      console.error("[channel/posts/:id] delete failed:", delErr.message);
      throw new HttpError(500, "Не удалось удалить публикацию");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
