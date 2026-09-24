/**
 * /api/cms/pages/[slug] — управление конкретной CMS страницей.
 *
 * GET — получить страницу по slug (public: published only, admin: any)
 * PATCH — обновить (admin/copywriter)
 * DELETE — soft delete (admin)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    const user = await getCurrentUser();

    let query = supabaseAdmin
      .from("cms_pages")
      .select("*")
      .eq("slug", slug)
      .is("deleted_at", null)
      .single();

    const { data: page, error } = await query;

    if (error || !page) {
      return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
    }

    // Если не admin и страница draft — 404
    if (page.status !== "published") {
      if (!user || !user.roles.some((r: string) =>
        ["ADMIN", "SUPER_ADMIN", "COPYWRITER"].includes(r)
      )) {
        return NextResponse.json({ error: "Страница не найдена" }, { status: 404 });
      }
    }

    return NextResponse.json({ page });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "COPYWRITER"].includes(r)
    )) {
      return forbiddenResponse();
    }

    const body = await request.json();
    const updates: Record<string, string | string[] | number | boolean | null> = {};

    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.content !== undefined) updates.content = body.content;
    if (body.seoTitle !== undefined) updates.seo_title = body.seoTitle;
    if (body.seoDescription !== undefined) updates.seo_description = body.seoDescription;
    if (body.seoKeywords !== undefined) updates.seo_keywords = body.seoKeywords;
    if (body.isInMenu !== undefined) updates.is_in_menu = body.isInMenu;
    if (body.menuOrder !== undefined) updates.menu_order = body.menuOrder;
    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === "published") {
        updates.published_at = new Date().toISOString();
      }
    }

    const { data: page, error } = await supabaseAdmin
      .from("cms_pages")
      .update(updates)
      .eq("slug", slug)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ page });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN"].includes(r)
    )) {
      return forbiddenResponse("Только admin может удалять страницы");
    }

    const { error } = await supabaseAdmin
      .from("cms_pages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("slug", slug);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
