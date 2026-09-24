/**
 * POST /api/recipes/:id/accept — кондитер подтверждает готовность изготовить по рецепту.
 *
 * Body: { priceFrom, priceTo?, prepDays?, delivery?, selfPickup?, notes? }
 *
 * Auth: CONFECTIONER
 *
 * Безопасность:
 *   • POST: требует роль CONFECTIONER.
 *   • POST: парсинг JSON безопасен (safeJsonBody).
 *   • POST: priceFrom — число ≥100, priceTo — ≥priceFrom, prepDays — целое 1..90.
 *   • POST: confectioner_id берётся из таблицы confectioners (не user_id).
 *   • POST: idempotency — если уже есть active acceptance, возвращаем 400 с existing id.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { requireRole } from "@/lib/role-guards";
import { safeJsonBody, HttpError, handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ id: string }>; }

const MIN_PRICE_FROM = 100;
const MAX_PRICE = 1_000_000;
const MAX_PREP_DAYS = 90;
const MAX_NOTES_LENGTH = 1000;

interface AcceptRecipeBody {
  priceFrom?: number;
  priceTo?: number;
  prepDays?: number;
  delivery?: boolean;
  selfPickup?: boolean;
  notes?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: recipeId } = await params;
    if (!recipeId) throw new HttpError(400, "Recipe ID required");

    const user = await getUserFromRequest(request);
    if (!user) throw new HttpError(401, "Не авторизован");

    const guard = await requireRole(user.userId, "CONFECTIONER");
    if (guard) {
      return new NextResponse(guard.body, { status: guard.status, headers: guard.headers });
    }

    // Find confectioner profile (нельзя использовать user.id напрямую как confectioner_id)
    const { data: conf, error: confErr } = await supabaseAdmin
      .from("confectioners")
      .select("id")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (confErr) {
      console.error("[recipes/accept] confectioner lookup failed:", confErr.message);
      throw new HttpError(500, "Не удалось проверить профиль кондитера");
    }
    if (!conf) {
      throw new HttpError(404, "Профиль кондитера не найден");
    }

    const { data: body, error: parseErr } = await safeJsonBody<AcceptRecipeBody>(request);
    if (parseErr) {
      throw new HttpError(400, parseErr);
    }
    if (!body) {
      throw new HttpError(400, "Тело запроса обязательно");
    }

    // Validate priceFrom
    if (typeof body.priceFrom !== "number" || !Number.isFinite(body.priceFrom) || body.priceFrom < MIN_PRICE_FROM) {
      throw new HttpError(400, `Укажите минимальную цену (от ${MIN_PRICE_FROM}₽)`);
    }
    if (body.priceFrom > MAX_PRICE) {
      throw new HttpError(422, `priceFrom слишком большой (макс ${MAX_PRICE} ₽)`);
    }

    // Validate priceTo
    let priceTo: number | null = null;
    if (body.priceTo !== undefined && body.priceTo !== null) {
      if (typeof body.priceTo !== "number" || !Number.isFinite(body.priceTo)) {
        throw new HttpError(422, "priceTo должен быть числом");
      }
      if (body.priceTo < body.priceFrom) {
        throw new HttpError(422, "priceTo должен быть не меньше priceFrom");
      }
      if (body.priceTo > MAX_PRICE) {
        throw new HttpError(422, `priceTo слишком большой (макс ${MAX_PRICE} ₽)`);
      }
      priceTo = body.priceTo;
    }

    // Validate prepDays
    let prepDays = 3;
    if (body.prepDays !== undefined && body.prepDays !== null) {
      if (typeof body.prepDays !== "number" || !Number.isInteger(body.prepDays) || body.prepDays < 1) {
        throw new HttpError(422, "prepDays должен быть положительным целым числом");
      }
      if (body.prepDays > MAX_PREP_DAYS) {
        throw new HttpError(422, `prepDays слишком большой (макс ${MAX_PREP_DAYS} дней)`);
      }
      prepDays = body.prepDays;
    }

    // Validate notes
    let notes: string | null = null;
    if (typeof body.notes === "string") {
      if (body.notes.length > MAX_NOTES_LENGTH) {
        throw new HttpError(422, `notes слишком длинный (макс ${MAX_NOTES_LENGTH})`);
      }
      notes = body.notes;
    }

    // delivery/selfPickup — default true (boolean)
    const delivery = body.delivery !== false; // false только если явно false
    const selfPickup = body.selfPickup !== false;

    // Idempotency: check existing active acceptance
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("recipe_acceptances")
      .select("id")
      .eq("recipe_id", recipeId)
      .eq("confectioner_id", conf.id)
      .eq("status", "active")
      .maybeSingle();

    if (existingErr) {
      console.warn("[recipes/accept] existing check failed:", existingErr.message);
    }

    if (existing) {
      throw new HttpError(400, "Вы уже подтвердили готовность", existing.id);
    }

    const { data: acceptance, error } = await supabaseAdmin
      .from("recipe_acceptances")
      .insert({
        recipe_id: recipeId,
        confectioner_id: conf.id,
        price_from: body.priceFrom,
        price_to: priceTo,
        prep_days: prepDays,
        delivery,
        self_pickup: selfPickup,
        notes,
        status: "active",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("[recipes/accept] insert failed:", error.message);
      throw new HttpError(500, "Не удалось создать подтверждение");
    }

    return NextResponse.json({ acceptance }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
