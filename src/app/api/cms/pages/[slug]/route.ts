/**
 * /api/cms/pages/[slug] — управление конкретной CMS страницей.
 * GET — опубликованная страница для всех, черновик только для редакторов.
 * PATCH — обновление редактором.
 * DELETE — soft delete администратором.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { isValidCmsSlug, validateCmsPageInput } from "@/lib/cms-validation";

const EDITOR_ROLES = ["ADMIN", "SUPER_ADMIN", "COPYWRITER"];
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

async function getPage(slug: string) {
  return supabaseAdmin.from("cms_pages")
    .select("*")
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    if (!isValidCmsSlug(slug)) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
    const { data: page, error } = await getPage(slug);
    if (error) {
      console.error("[cms/pages] read failed:", error.message);
      return NextResponse.json({ error: "Не удалось загрузить страницу" }, { status: 500 });
    }
    if (!page) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });

    if (page.status !== "published") {
      const user = await getCurrentUser();
      if (!user || !user.roles.some((role: string) => EDITOR_ROLES.includes(role))) {
        return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
      }
    }
    return NextResponse.json({ page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    if (!isValidCmsSlug(slug)) return NextResponse.json({ error: "Некорректный slug" }, { status: 400 });
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();
    if (!user.roles.some((role: string) => EDITOR_ROLES.includes(role))) return forbiddenResponse();

    const body: unknown = await request.json();
    const validationError = validateCmsPageInput(body, true);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const input = body as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (input.slug !== undefined) updates.slug = input.slug;
    if (input.title !== undefined) updates.title = (input.title as string).trim();
    if (input.description !== undefined) updates.description = input.description || null;
    if (input.content !== undefined) updates.content = input.content;
    if (input.seoTitle !== undefined) updates.seo_title = input.seoTitle || null;
    if (input.seoDescription !== undefined) updates.seo_description = input.seoDescription || null;
    if (input.seoKeywords !== undefined) updates.seo_keywords = input.seoKeywords || null;
    if (input.isInMenu !== undefined) updates.is_in_menu = input.isInMenu;
    if (input.menuOrder !== undefined) updates.menu_order = input.menuOrder;
    if (input.status !== undefined) {
      updates.status = input.status;
      updates.published_at = input.status === "published" ? new Date().toISOString() : null;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    const { data: existing, error: lookupError } = await getPage(slug);
    if (lookupError) return NextResponse.json({ error: "Не удалось найти страницу" }, { status: 500 });
    if (!existing) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });

    const { data: page, error } = await supabaseAdmin
      .from("cms_pages")
      .update(updates)
      .eq("slug", slug)
      .is("deleted_at", null)
      .select()
      .maybeSingle();
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Страница с таким slug уже существует" }, { status: 409 });
    }
    if (error) {
      console.error("[cms/pages] update failed:", error.message);
      return NextResponse.json({ error: "Не удалось обновить страницу" }, { status: 500 });
    }
    if (!page) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
    return NextResponse.json({ page });
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    if (!isValidCmsSlug(slug)) return NextResponse.json({ error: "Некорректный slug" }, { status: 400 });
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();
    if (!user.roles.some((role: string) => ADMIN_ROLES.includes(role))) {
      return forbiddenResponse("Только admin может удалять страницы");
    }

    const { data: page, error } = await supabaseAdmin
      .from("cms_pages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("slug", slug)
      .is("deleted_at", null)
      .select("slug")
      .maybeSingle();
    if (error) {
      console.error("[cms/pages] delete failed:", error.message);
      return NextResponse.json({ error: "Не удалось удалить страницу" }, { status: 500 });
    }
    if (!page) return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
