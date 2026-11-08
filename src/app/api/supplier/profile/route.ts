/**
 * GET  /api/supplier/profile — свой профиль поставщика (+ история модерации).
 * PUT  /api/supplier/profile — обновление профиля.
 *
 * Правила редактирования по статусу:
 *  - draft / changes_requested / rejected — свободное редактирование;
 *  - submitted / under_review — заблокировано (409, ждите решения);
 *  - approved — редактирование описательных полей без смены статуса;
 *  - suspended — только просмотр.
 *
 * Auth: SUPPLIER (владелец профиля). Все проверки — на сервере.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { getPool } from "@/lib/postgrest/pool";

export const runtime = "nodejs";

const EDITABLE_FIELDS = [
  "companyName",
  "legalForm",
  "inn",
  "contactPerson",
  "phone",
  "email",
  "address",
  "region",
  "description",
  "specialization",
  "productCategories",
  "wholesaleTerms",
  "minOrderAmount",
  "minOrderQty",
  "workSchedule",
  "deliveryGeography",
  "deliveryTerms",
  "pickupAvailable",
  "deliveryAvailable",
  "documents",
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function sanitizeProfileUpdate(
  body: Record<string, unknown>
): Partial<Record<EditableField, unknown>> {
  const out: Partial<Record<EditableField, unknown>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    switch (field) {
      case "specialization":
      case "productCategories":
        if (Array.isArray(value)) {
          out[field] = value
            .map((v) => String(v).trim())
            .filter(Boolean)
            .slice(0, 30);
        }
        break;
      case "documents":
        if (value && typeof value === "object" && !Array.isArray(value)) {
          out[field] = value;
        }
        break;
      case "minOrderAmount":
      case "minOrderQty": {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) out[field] = n;
        break;
      }
      case "pickupAvailable":
      case "deliveryAvailable":
        if (typeof value === "boolean") out[field] = value;
        break;
      default:
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed.length <= 2000) out[field] = trimmed || null;
        }
        break;
    }
  }
  return out;
}

/** Обязательные поля для отправки на модерацию. */
export function validateForSubmit(p: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!String(p.companyName ?? "").trim()) errors.push("Название компании обязательно");
  if (!String(p.contactPerson ?? "").trim()) errors.push("Контактное лицо обязательно");
  if (!String(p.phone ?? "").trim()) errors.push("Телефон обязателен");
  if (!String(p.email ?? "").trim()) errors.push("Email обязателен");
  if (!String(p.region ?? "").trim()) errors.push("Регион деятельности обязателен");
  if (!String(p.description ?? "").trim()) errors.push("Описание компании обязательно");
  const cats = Array.isArray(p.productCategories) ? p.productCategories : [];
  if (cats.length === 0) errors.push("Укажите хотя бы одну категорию товаров");
  const email = String(p.email ?? "");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Некорректный email");
  return errors;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const { data: profile, error } = await supabaseAdmin
      .from("supplier_profiles")
      .select("*")
      .eq("userId", user.id)
      .maybeSingle();

    if (error) {
      console.error("[supplier/profile] GET error:", error.message);
      return NextResponse.json({ error: "Ошибка чтения профиля" }, { status: 500 });
    }

    // История модерации (последние 30 записей).
    let history: unknown[] = [];
    if (profile) {
      const pool = getPool();
      const res = await pool.query(
        `SELECT action, from_status AS "fromStatus", to_status AS "toStatus",
                actor_role AS "actorRole", comment, created_at AS "createdAt"
           FROM supplier_profile_reviews
          WHERE profile_id = $1
          ORDER BY created_at DESC LIMIT 30`,
        [profile.id]
      );
      history = res.rows;
    }

    return NextResponse.json({ profile: profile ?? null, history });
  } catch (e: any) {
    console.error("[supplier/profile] GET:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    const guard = await requireRole(user.id, "SUPPLIER");
    if (guard) return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });

    const body = (await request.json()) as Record<string, unknown>;
    const update = sanitizeProfileUpdate(body);
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Нет корректных полей для обновления" }, { status: 400 });
    }

    const { data: profile } = await supabaseAdmin
      .from("supplier_profiles")
      .select("id, verificationStatus")
      .eq("userId", user.id)
      .maybeSingle();

    // Upsert: у нового поставщика профиля ещё нет — PUT создаёт черновик.
    if (!profile) {
      if (!update.companyName) {
        return NextResponse.json(
          { error: "Укажите название компании — по нему создаётся профиль" },
          { status: 400 }
        );
      }
      const { data: created, error: insErr } = await supabaseAdmin
        .from("supplier_profiles")
        .insert({
          id: crypto.randomUUID(), // id TEXT PK без default
          userId: user.id,
          verificationStatus: "draft",
          isActive: false,
          ...update,
          updatedAt: new Date().toISOString(),
        })
        .select()
        .single();
      if (insErr) {
        console.error("[supplier/profile] PUT create error:", insErr.message);
        return NextResponse.json({ error: "Ошибка создания профиля" }, { status: 500 });
      }
      return NextResponse.json({ profile: created, created: true });
    }

    const status = profile.verificationStatus as string;
    if (status === "submitted" || status === "under_review") {
      return NextResponse.json(
        { error: "Профиль на модерации — редактирование недоступно до решения" },
        { status: 409 }
      );
    }
    if (status === "suspended") {
      return NextResponse.json(
        { error: "Профиль приостановлен администратором — обратитесь в поддержку" },
        { status: 409 }
      );
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("supplier_profiles")
      .update({ ...update, updatedAt: new Date().toISOString() })
      .eq("id", profile.id)
      .eq("userId", user.id) // защита от подмены владельца
      .select()
      .single();

    if (updErr) {
      console.error("[supplier/profile] PUT error:", updErr.message);
      return NextResponse.json({ error: "Ошибка сохранения" }, { status: 500 });
    }

    // Журнал: профиль изменён (не статусное событие).
    const pool = getPool();
    await pool.query(
      `INSERT INTO supplier_profile_reviews
         (profile_id, action, from_status, to_status, actor_id, actor_role, comment)
       VALUES ($1,'profile_updated',$2,$2,$3,'supplier','Профиль обновлён поставщиком')`,
      [profile.id, status, user.id]
    );

    return NextResponse.json({ profile: updated });
  } catch (e: any) {
    console.error("[supplier/profile] PUT:", e?.message);
    return NextResponse.json({ error: "Ошибка сервера" }, { status: 500 });
  }
}
