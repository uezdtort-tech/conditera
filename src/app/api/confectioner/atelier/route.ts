/**
 * GET  /api/confectioner/atelier?userId=... — получить информацию об ателье кондитера.
 * POST /api/confectioner/atelier — создать/обновить ателье (только кондитер)
 *
 * GET — public: возвращает данные ателье по userId.
 *        Если запись не найдена — возвращает пустую структуру с default значениями.
 * POST — CONFECTIONER only: upsert ателье по своему userId.
 *
 * Соответствует таблице: confectioner_ateliers (JSONB-поля для photos/equipment/etc.)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";

export const runtime = "nodejs";

interface AtelierData {
  confectionerId: string;
  about: string | null;
  workshopPhotos: string[];
  presentationVideo: string | null;
  equipment: string[];
  experienceYears: number;
  education: string[];
  certificates: string[];
  awards: string[];
  workingHours: Record<string, string>;
  teamSize: number;
  techniques: string[];
  deliveryCities: string[];
  serviceRadiusKm: number;
  socialLinks: Record<string, string>;
}

const DEFAULT_ATELIER: AtelierData = {
  confectionerId: "",
  about: null,
  workshopPhotos: [],
  presentationVideo: null,
  equipment: [],
  experienceYears: 0,
  education: [],
  certificates: [],
  awards: [],
  workingHours: {
    mon: "9:00-18:00",
    tue: "9:00-18:00",
    wed: "9:00-18:00",
    thu: "9:00-18:00",
    fri: "9:00-18:00",
    sat: "10:00-16:00",
    sun: "выходной",
  },
  teamSize: 1,
  techniques: [],
  deliveryCities: [],
  serviceRadiusKm: 0,
  socialLinks: {},
};

/**
 * GET /api/confectioner/atelier — получить данные ателье по userId.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json(
        { error: "userId обязателен" },
        { status: 400 }
      );
    }

    try {
      const { data: atelier, error } = await supabaseAdmin
        .from("confectioner_ateliers")
        .select("*")
        .eq("confectionerId", userId)
        .maybeSingle();

      if (error) {
        console.warn("[confectioner/atelier] query error:", error.message);
        return NextResponse.json({
          atelier: { ...DEFAULT_ATELIER, confectionerId: userId },
        });
      }

      if (!atelier) {
        // Возвращаем пустую структуру с default значениями
        return NextResponse.json({
          atelier: { ...DEFAULT_ATELIER, confectionerId: userId },
        });
      }

      return NextResponse.json({ atelier });
    } catch (e: any) {
      console.warn("[confectioner/atelier] query failed:", e?.message);
      return NextResponse.json({
        atelier: { ...DEFAULT_ATELIER, confectionerId: userId },
      });
    }
  } catch (error: any) {
    console.error("GET /api/confectioner/atelier error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/confectioner/atelier — создать/обновить ателье.
 * Только CONFECTIONER может редактировать своё ателье.
 *
 * Тело запроса — объект AtelierData (см. интерфейс выше).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Не авторизован" },
        { status: 401 }
      );
    }

    // Проверка роли — только CONFECTIONER
    const guard = await requireRole(user.id, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();
    const {
      about,
      workshopPhotos,
      presentationVideo,
      equipment,
      experienceYears,
      education,
      certificates,
      awards,
      workingHours,
      teamSize,
      techniques,
      deliveryCities,
      serviceRadiusKm,
      socialLinks,
    } = body ?? {};

    const insertData = {
      confectionerId: user.id,
      about: about ?? null,
      workshopPhotos: workshopPhotos || [],
      presentationVideo: presentationVideo ?? null,
      equipment: equipment || [],
      experienceYears: experienceYears ?? 0,
      education: education || [],
      certificates: certificates || [],
      awards: awards || [],
      workingHours: workingHours || DEFAULT_ATELIER.workingHours,
      teamSize: teamSize ?? 1,
      techniques: techniques || [],
      deliveryCities: deliveryCities || [],
      serviceRadiusKm: serviceRadiusKm ?? 0,
      socialLinks: socialLinks || {},
      updatedAt: new Date().toISOString(),
    };

    try {
      // Upsert по confectionerId
      const { data: atelier, error } = await supabaseAdmin
        .from("confectioner_ateliers")
        .upsert(insertData, { onConflict: "confectionerId" })
        .select()
        .single();

      if (error) {
        console.error("[confectioner/atelier] upsert error:", error.message);
        return NextResponse.json(
          { error: "DB error", details: error.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ atelier });
    } catch (e: any) {
      console.error("[confectioner/atelier] DB error:", e?.message);
      return NextResponse.json(
        { error: "DB error", detail: e?.message },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("POST /api/confectioner/atelier error:", error?.message);
    return NextResponse.json(
      { error: "Internal error", detail: error?.message },
      { status: 500 }
    );
  }
}
