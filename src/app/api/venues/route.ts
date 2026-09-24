/**
 * GET  /api/venues — список площадок (public для опубликованных)
 * POST /api/venues — создать новую площадку (только VENUE_OWNER или ADMIN)
 *
 * Query параметры для GET:
 *  - city      — фильтр по городу
 *  - capacity  — минимальная вместимость (int)
 *  - max_price — максимальная цена в час
 *  - limit     — по умолчанию 20, макс 100
 *  - offset    — по умолчанию 0
 *
 * Тело POST:
 *  {
 *    "name": "Лофт «Восток»",
 *    "address": "г. Москва, ул. ...",
 *    "capacity": 50,
 *    "price_per_hour": 2500,
 *    "description": "Лофт для свадеб и корпоративов...",
 *    "images": ["https://..."],
 *    "amenities": {"wifi": true, "parking": true}
 *  }
 *
 * Auth:
 *  GET  — public
 *  POST — VENUE_OWNER или ADMIN (проверка через requireAnyRole)
 *
 * Соответствует таблице: venues (миграция 0008_geo.sql + 0011_rbac_franchise_escrow.sql)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireAnyRole } from "@/lib/role-guards";

export const runtime = "nodejs";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * GET /api/venues — список активных площадок.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const city = searchParams.get("city");
    const capacity = searchParams.get("capacity");
    const maxPrice = searchParams.get("max_price");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10),
      MAX_LIMIT
    );
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabaseAdmin
      .from("venues")
      .select(
        `
        id, owner_id, name, address, capacity, price_per_hour,
        description, images, amenities, is_active, created_at
      `
      )
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (city) {
      query = query.ilike("address", `%${city}%`);
    }
    if (capacity) {
      const cap = parseInt(capacity, 10);
      if (!isNaN(cap) && cap > 0) {
        query = query.gte("capacity", cap);
      }
    }
    if (maxPrice) {
      const price = parseFloat(maxPrice);
      if (!isNaN(price) && price > 0) {
        query = query.lte("price_per_hour", price);
      }
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error) {
      console.error("[venues] GET error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при получении списка площадок", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      meta: { limit, offset, count: data?.length ?? 0 },
    });
  } catch (error: any) {
    console.error("[venues] GET unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/venues — создать новую площадку.
 * Только VENUE_OWNER или ADMIN.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Проверка роли — VENUE_OWNER или ADMIN
    const guard = await requireAnyRole(user.id, ["VENUE_OWNER", "ADMIN"]);
    if (guard) {
      return new NextResponse(guard.body, {
        status: guard.status,
        headers: guard.headers,
      });
    }

    const body = await request.json();

    // Валидация обязательных полей
    const required = ["name", "address", "capacity", "price_per_hour"];
    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return NextResponse.json(
          { error: `Поле «${field}» обязательно`, field },
          { status: 422 }
        );
      }
    }

    // Валидация типов
    if (typeof body.name !== "string" || body.name.length < 3 || body.name.length > 200) {
      return NextResponse.json(
        { error: "name должен быть строкой 3-200 символов" },
        { status: 422 }
      );
    }
    if (typeof body.capacity !== "number" || body.capacity < 1 || body.capacity > 10000) {
      return NextResponse.json(
        { error: "capacity должен быть числом от 1 до 10000" },
        { status: 422 }
      );
    }
    if (typeof body.price_per_hour !== "number" || body.price_per_hour < 0) {
      return NextResponse.json(
        { error: "price_per_hour должен быть неотрицательным числом" },
        { status: 422 }
      );
    }

    // Создать площадку
    const insertData = {
      owner_id: user.id,
      name: body.name,
      address: body.address,
      capacity: body.capacity,
      price_per_hour: body.price_per_hour,
      description: body.description ?? null,
      images: Array.isArray(body.images) ? body.images : [],
      amenities: (body.amenities && typeof body.amenities === "object" && !Array.isArray(body.amenities))
        ? body.amenities
        : {},
      is_active: true,
    };

    const { data: created, error } = await supabaseAdmin
      .from("venues")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("[venues] POST error:", error.message);
      return NextResponse.json(
        { error: "Ошибка при создании площадки", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { data: created, message: "Площадка создана" },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[venues] POST unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
