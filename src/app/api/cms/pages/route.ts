/**
 * /api/cms/pages — CRUD для CMS страниц.
 *
 * GET — список страниц (public: published only, admin: all)
 * POST — создать страницу (admin/copywriter)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";
import { validateCmsPageInput } from "@/lib/cms-validation";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    const { searchParams } = request.nextUrl;
    const includeDrafts = searchParams.get("include_drafts") === "true";

    let query = supabaseAdmin.from("cms_pages").select("*").is("deleted_at", null);

    // Если не admin — только published
    if (!user || !user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "COPYWRITER"].includes(r)
    ) || !includeDrafts) {
      query = query.eq("status", "published");
    }

    const { data, error } = await query.order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ pages: data });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorizedResponse();

    if (!user.roles.some((r: string) =>
      ["ADMIN", "SUPER_ADMIN", "COPYWRITER"].includes(r)
    )) {
      return forbiddenResponse("Только admin/copywriter могут создавать страницы");
    }

    const body: unknown = await request.json();
    const validationError = validateCmsPageInput(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const input = body as {
      slug: string; title: string; content: string; description?: string | null;
      seoTitle?: string | null; seoDescription?: string | null; seoKeywords?: string[] | null;
      isInMenu?: boolean; menuOrder?: number; status?: "draft" | "published";
    };
    const status = input.status ?? "draft";
    const { data: page, error } = await supabaseAdmin
      .from("cms_pages")
      .insert({
        slug: input.slug,
        title: input.title.trim(),
        description: input.description || null,
        content: input.content,
        seo_title: input.seoTitle || null,
        seo_description: input.seoDescription || null,
        seo_keywords: input.seoKeywords || null,
        is_in_menu: input.isInMenu ?? false,
        menu_order: input.menuOrder ?? 0,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error?.code === "23505") {
      return NextResponse.json({ error: "Страница с таким slug уже существует" }, { status: 409 });
    }
    if (error) {
      console.error("[cms/pages] create failed:", error.message);
      return NextResponse.json({ error: "Не удалось создать страницу" }, { status: 500 });
    }

    return NextResponse.json({ page }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
