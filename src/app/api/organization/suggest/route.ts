/**
 * GET /api/organization/suggest?q=...
 *
 * Auto-complete organization name/INN through DaData.
 * Returns up to 5 matches with INN, OGRN, name, address — for form auto-fill.
 *
 * Auth: any authenticated user.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { suggestOrganizations, isDaDataConfigured } from "@/lib/dadata";

export async function GET(req: NextRequest) {
  try {
    const payload = await getUserFromRequest(req);
    if (!payload) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";

    if (q.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    if (!isDaDataConfigured()) {
      return NextResponse.json({
        suggestions: [],
        warning: "DaData API не настроена. Укажите DADATA_API_KEY в .env для автозаполнения.",
      });
    }

    const suggestions = await suggestOrganizations(q);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("GET /api/organization/suggest error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
