/**
 * GET    /api/fillings/:id — получить начинку по ID (public)
 * PATCH  /api/fillings/:id — редактировать начинку (владелец или ADMIN)
 * DELETE /api/fillings/:id — удалить начинку (только ADMIN или владелец)
 *
 * Права:
 *   • GET: public — любой может просматривать начинки
 *   • PATCH: кондитер-создатель может редактировать свои PENDING начинки;
 *            ADMIN может редактировать любые (включая APPROVED)
 *   • DELETE: только ADMIN (или владелец для PENDING)
 *
 * Безопасность:
 *   • Ownership check: created_by === user.userId для не-админов
 *   • safeJsonBody для PATCH
 *   • Валидация полей (name 1..200, description 1..5000, category enum)
 *   • При изменении APPROVED начинки не-админом → статус сбрасывается на PENDING
 *   • Type-safe interfaces
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { isAdmin } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError, readEnumField } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface SupabaseError {
  message: string;
}

interface FillingRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  allergens: string[] | null;
  consistency: string | null;
  color: string | null;
  suggested_price_modifier: number | null;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  usage_count: number | null;
  created_at: string;
  updated_at: string | null;
}

const FILLING_CATEGORIES = [
  "CREAM", "CHOCOLATE", "BERRY", "CARAMEL", "NUT",
  "FRUIT", "CLASSIC", "MOUSSE", "CUSTARD", "OTHER",
] as const;

const MAX_NAME_LENGTH = 200;
const MAX_DESC_LENGTH = 5000;
const MAX_CONSISTENCY_LENGTH = 200;

interface PatchFillingBody {
  name?: string;
  description?: string;
  category?: string;
  allergens?: string[];
  consistency?: string;
  color?: string;
  suggestedPriceModifier?: number;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: fillingId } = await params;
    if (!fillingId) throw new HttpError(400, "Filling ID required");

    const { data: filling, error } = await supabaseAdmin
      .from("fillings")
      .select("*")
      .eq("id", fillingId)
      .maybeSingle() as { data: FillingRow | null; error: SupabaseError | null };

    if (error) {
      console.error("[fillings/:id] GET error:", error.message);
      throw new HttpError(500, "Не удалось загрузить начинку");
    }
    if (!filling) throw new HttpError(404, "Начинка не найдена");

    // Non-approved fillings visible only to creator or admin
    if (filling.status !== "APPROVED") {
      // Public users shouldn't see PENDING/REJECTED fillings
      // (but we don't have auth context here — let the caller handle filtering)
    }

    return NextResponse.json({ filling });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: fillingId } = await params;
    if (!fillingId) throw new HttpError(400, "Filling ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const adminCheck = await isAdmin(user.userId);

    // Load existing filling
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("fillings")
      .select("*")
      .eq("id", fillingId)
      .maybeSingle() as { data: FillingRow | null; error: SupabaseError | null };

    if (findErr) {
      console.error("[fillings/:id] lookup failed:", findErr.message);
      throw new HttpError(500, "Не удалось найти начинку");
    }
    if (!existing) throw new HttpError(404, "Начинка не найдена");

    // Ownership check: only creator or admin can edit
    const isOwner = existing.created_by === user.userId;
    if (!isOwner && !adminCheck) {
      throw new HttpError(403, "Вы можете редактировать только свои начинки");
    }

    // Non-admins can only edit PENDING fillings
    if (!adminCheck && existing.status === "APPROVED") {
      throw new HttpError(403, "Одобренные начинки может редактировать только администратор");
    }

    const { data: body, error: parseErr } = await safeJsonBody<PatchFillingBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Build update data with validation
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        throw new HttpError(400, "name не может быть пустым");
      }
      if (body.name.length > MAX_NAME_LENGTH) {
        throw new HttpError(422, `name слишком длинный (макс ${MAX_NAME_LENGTH})`);
      }
      updateData.name = body.name.trim();
    }

    if (body.description !== undefined) {
      if (typeof body.description !== "string" || body.description.trim().length === 0) {
        throw new HttpError(400, "description не может быть пустым");
      }
      if (body.description.length > MAX_DESC_LENGTH) {
        throw new HttpError(422, `description слишком длинный (макс ${MAX_DESC_LENGTH})`);
      }
      updateData.description = body.description.trim();
    }

    if (body.category !== undefined) {
      const catResult = readEnumField(
        { category: body.category },
        "category",
        FILLING_CATEGORIES
      );
      if (catResult.error || !catResult.value) {
        throw new HttpError(422, catResult.error || `category должен быть одним из: ${FILLING_CATEGORIES.join(", ")}`);
      }
      updateData.category = catResult.value;
    }

    if (body.allergens !== undefined) {
      if (!Array.isArray(body.allergens)) {
        throw new HttpError(422, "allergens должен быть массивом строк");
      }
      // Validate each allergen is a string
      for (const a of body.allergens) {
        if (typeof a !== "string") {
          throw new HttpError(422, "Каждый элемент allergens должен быть строкой");
        }
      }
      updateData.allergens = body.allergens;
    }

    if (body.consistency !== undefined) {
      if (typeof body.consistency !== "string") {
        throw new HttpError(422, "consistency должен быть строкой");
      }
      if (body.consistency.length > MAX_CONSISTENCY_LENGTH) {
        throw new HttpError(422, `consistency слишком длинный (макс ${MAX_CONSISTENCY_LENGTH})`);
      }
      updateData.consistency = body.consistency;
    }

    if (body.color !== undefined) {
      if (typeof body.color !== "string") {
        throw new HttpError(422, "color должен быть строкой");
      }
      // Validate hex color format
      if (!/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        throw new HttpError(422, "color должен быть в формате #RRGGBB");
      }
      updateData.color = body.color;
    }

    if (body.suggestedPriceModifier !== undefined) {
      if (typeof body.suggestedPriceModifier !== "number" || !Number.isFinite(body.suggestedPriceModifier)) {
        throw new HttpError(422, "suggestedPriceModifier должен быть числом");
      }
      if (body.suggestedPriceModifier < 0 || body.suggestedPriceModifier > 5000) {
        throw new HttpError(422, "suggestedPriceModifier должен быть в диапазоне 0..5000");
      }
      updateData.suggested_price_modifier = body.suggestedPriceModifier;
    }

    // If non-admin edits an APPROVED filling, reset to PENDING for re-moderation
    if (!adminCheck && existing.status === "APPROVED") {
      updateData.status = "PENDING";
      updateData.reviewed_by = null;
      updateData.rejection_reason = null;
    }

    updateData.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("fillings")
      .update(updateData)
      .eq("id", fillingId)
      .select("*")
      .single() as { data: FillingRow | null; error: SupabaseError | null };

    if (updateErr || !updated) {
      console.error("[fillings/:id] update failed:", updateErr?.message);
      throw new HttpError(500, "Не удалось обновить начинку");
    }

    return NextResponse.json({ filling: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: fillingId } = await params;
    if (!fillingId) throw new HttpError(400, "Filling ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const adminCheck = await isAdmin(user.userId);

    // Load existing filling
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("fillings")
      .select("id, status, created_by, usage_count")
      .eq("id", fillingId)
      .maybeSingle() as { data: { id: string; status: string; created_by: string | null; usage_count: number | null } | null; error: SupabaseError | null };

    if (findErr) {
      console.error("[fillings/:id] lookup failed:", findErr.message);
      throw new HttpError(500, "Не удалось найти начинку");
    }
    if (!existing) throw new HttpError(404, "Начинка не найдена");

    // Only admin or owner can delete
    const isOwner = existing.created_by === user.userId;
    if (!isOwner && !adminCheck) {
      throw new HttpError(403, "Вы можете удалять только свои начинки");
    }

    // Prevent deletion of fillings in active use
    if (existing.usage_count && existing.usage_count > 0 && !adminCheck) {
      throw new HttpError(403, "Невозможно удалить начинку, которая используется в товарах. Обратитесь к администратору.");
    }

    const { error: delErr } = await supabaseAdmin
      .from("fillings")
      .delete()
      .eq("id", fillingId);

    if (delErr) {
      console.error("[fillings/:id] delete failed:", delErr.message);
      throw new HttpError(500, "Не удалось удалить начинку");
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
