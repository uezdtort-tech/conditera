/**
 * /api/cms/pages — CRUD для CMS страниц.
 *
 * GET — список страниц (public: published only, admin: all)
 * POST — создать страницу (admin/copywriter)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, unauthorizedResponse, forbiddenResponse } from "@/lib/supabase/auth";

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

    const body = await request.json();
    const { slug, title, description, content, seoTitle, seoDescription, seoKeywords, isInMenu, menuOrder, status = "draft" } = body as {
      slug: string;
      title: string;
      description?: string;
      content: string;
      seoTitle?: string;
      seoDescription?: string;
      seoKeywords?: string[];
      isInMenu?: boolean;
      menuOrder?: number;
      status?: string;
    };

    if (!slug || !title || !content) {
      return NextResponse.json(
        { error: "Slug, title и content обязательны" },
        { status: 400 }
      );
    }

    const { data: page, error } = await supabaseAdmin
      .from("cms_pages")
      .insert({
        slug,
        title,
        description: description || null,
        content,
        seo_title: seoTitle || null,
        seo_description: seoDescription || null,
        seo_keywords: seoKeywords || null,
        is_in_menu: isInMenu || false,
        menu_order: menuOrder || 0,
        status,
        published_at: status === "published" ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ page }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
