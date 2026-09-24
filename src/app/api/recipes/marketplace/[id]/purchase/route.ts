/**
 * /api/recipes/marketplace/[id]/purchase/route.ts — покупка рецепта.
 *
 * POST /api/recipes/marketplace/:id/purchase
 *
 * Тело запроса:
 *  {
 *    "payment_id": "uuid-of-payment"   // ссылка на платеж (опционально, если 0 ₽)
 *  }
 *
 * Логика:
 *  1. Проверить аутентификацию
 *  2. Найти рецепт (должен быть опубликован)
 *  3. Проверить, что пользователь ещё не покупал (idempotency)
 *  4. Рассчитать роялти: royalty_amount = base_price * royalty_rate
 *  5. Рассчитать комиссию: commission_amount = base_price * 0.10 (10% от суммы)
 *  6. Создать запись в recipe_purchases
 *  7. Увеличить purchases_count и purchases_count в recipe_marketplace
 *  8. (Опционально) Вызвать Edge Function для выплаты роялти автору
 *
 * Права:
 *  POST — любой AUTHENTICATED пользователь (CONFECTIONER, ADMIN, и т.д.)
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import type { RecipePurchase } from "@/lib/supabase/types";

export const runtime = "nodejs";

const PLATFORM_COMMISSION_RATE = 0.10; // 10% от base_price идёт платформе

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/recipes/marketplace/:id/purchase — купить рецепт.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const { id: recipeId } = await params;
    const user = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Необходима аутентификация" },
        { status: 401 }
      );
    }

    // Найти рецепт
    const { data: recipe, error: recipeErr } = await supabaseAdmin
      .from("recipe_marketplace")
      .select("id, author_id, title, base_price, royalty_rate, is_published, purchases_count")
      .eq("id", recipeId)
      .maybeSingle();

    if (recipeErr || !recipe) {
      return NextResponse.json(
        { error: "Рецепт не найден" },
        { status: 404 }
      );
    }

    if (!recipe.is_published) {
      return NextResponse.json(
        { error: "Рецепт не опубликован" },
        { status: 422 }
      );
    }

    // Автор не может покупать свой рецепт
    if (recipe.author_id === user.id) {
      return NextResponse.json(
        { error: "Вы не можете купить собственный рецепт" },
        { status: 422 }
      );
    }

    // Idempotency — проверить, что пользователь ещё не покупал
    const { data: existingPurchase } = await supabaseAdmin
      .from("recipe_purchases")
      .select("id, created_at")
      .eq("recipe_id", recipeId)
      .eq("buyer_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (existingPurchase) {
      // Уже куплено — вернуть существующую покупку
      return NextResponse.json({
        data: existingPurchase,
        message: "Рецепт уже куплен ранее",
      });
    }

    // Расчёт роялти и комиссии
    const pricePaid = Number(recipe.base_price);
    const royaltyAmount = Number((pricePaid * Number(recipe.royalty_rate)).toFixed(2));
    const commissionAmount = Number((pricePaid * PLATFORM_COMMISSION_RATE).toFixed(2));

    // Парсим body (опционально — payment_id)
    let paymentId: string | null = null;
    try {
      const body = await request.json();
      if (body && typeof body.payment_id === "string") {
        paymentId = body.payment_id;
      }
    } catch {
      // Body может быть пустым — это OK для бесплатных рецептов
    }

    // Создать запись о покупке
    const { data: purchase, error: purchaseErr } = await supabaseAdmin
      .from("recipe_purchases")
      .insert({
        recipe_id: recipeId,
        buyer_id: user.id,
        price_paid: pricePaid,
        royalty_amount: royaltyAmount,
        commission_amount: commissionAmount,
        payment_id: paymentId,
        is_active: true,
      })
      .select()
      .single();

    if (purchaseErr) {
      console.error("[recipes/:id/purchase] INSERT error:", purchaseErr.message);
      return NextResponse.json(
        { error: "Ошибка при создании записи о покупке", details: purchaseErr.message },
        { status: 500 }
      );
    }

    // Увеличить purchases_count в recipe_marketplace (атомарный инкремент через RPC)
    const { error: updateErr } = await supabaseAdmin
      .from("recipe_marketplace")
      .update({
        purchases_count: (recipe.purchases_count || 0) + 1,
      })
      .eq("id", recipeId);

    if (updateErr) {
      console.warn("[recipes/:id/purchase] UPDATE count error:", updateErr.message);
      // Не fail-ить запрос — покупка уже создана
    }

    return NextResponse.json(
      {
        data: purchase as RecipePurchase,
        message: "Рецепт успешно куплен",
        meta: {
          price_paid: pricePaid,
          royalty_amount: royaltyAmount,
          commission_amount: commissionAmount,
          author_royalty: royaltyAmount,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[recipes/:id/purchase] unexpected:", error?.message);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
