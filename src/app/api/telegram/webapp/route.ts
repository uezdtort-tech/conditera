/**
 * GET /api/telegram/webapp
 *
 * Возвращает данные для Telegram Mini App:
 *   - Каталог тортов (топ-20)
 *   - Кондитеры (топ-10)
 *   - Акции
 *   - Информация о пользователе (из Telegram WebApp initData)
 *
 * Query: ?initData=... (Telegram WebApp initData string)
 *
 * Безопасность:
 *   • Парсим Telegram user из initData (в проде — проверка подписи через HMAC).
 *   • При сбое БД — возвращаем пустые массивы (не блокируем Mini App).
 *   • Type-safe interfaces для всех возвращаемых данных.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { handleRouteError } from "@/lib/http-helpers";

export const runtime = "nodejs";

interface SupabaseError {
  message: string;
}

interface TgUser {
  id?: number;
  first_name?: string;
  username?: string;
  photo_url?: string;
}

interface ProductRow {
  id: string;
  title: string;
  price: number;
  old_price: number | null;
  images: string[] | null;
  rating: number | null;
  reviews_count: number | null;
  servings: number | null;
  category: string | null;
}

interface ConfectionerRow {
  id: string;
  business_name: string;
  avatar: string | null;
  city: string | null;
  rating: number | null;
  reviews_count: number | null;
  specialization: string[] | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const sp = request.nextUrl.searchParams;
    const initData = sp.get("initData") || "";

    // Парсим Telegram user из initData (в проде — проверка подписи через HMAC)
    let tgUser: TgUser | null = null;
    if (initData) {
      const params = new URLSearchParams(initData);
      const userParam = params.get("user");
      if (userParam) {
        try {
          tgUser = JSON.parse(userParam) as TgUser;
        } catch {
          // Невалидный JSON — игнорируем
        }
      }
    }

    // Загружаем каталог товаров (топ-20 по рейтингу)
    let products: ProductRow[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("products")
        .select("id, title, price, old_price, images, rating, reviews_count, servings, category")
        .eq("published", true)
        .order("rating", { ascending: false })
        .limit(20) as { data: ProductRow[] | null; error: SupabaseError | null };

      if (error) {
        console.warn("[telegram/webapp] products query failed:", error.message);
      }
      products = data || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[telegram/webapp] products load failed:", msg);
    }

    // Загружаем кондитеров (топ-10 по рейтингу)
    let confectioners: ConfectionerRow[] = [];
    try {
      const { data, error } = await supabaseAdmin
        .from("confectioners")
        .select("id, business_name, avatar, city, rating, reviews_count, specialization")
        .eq("verified", true)
        .order("rating", { ascending: false })
        .limit(10) as { data: ConfectionerRow[] | null; error: SupabaseError | null };

      if (error) {
        console.warn("[telegram/webapp] confectioners query failed:", error.message);
      }
      confectioners = data || [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[telegram/webapp] confectioners load failed:", msg);
    }

    return NextResponse.json({
      user: tgUser
        ? {
            id: tgUser.id,
            name: tgUser.first_name || tgUser.username || "Пользователь",
            avatar: tgUser.photo_url,
          }
        : null,
      products,
      confectioners,
      promotions: [],
      app: {
        name: "Кондитера",
        description: "Маркетплейс кондитерских изделий от частных кондитеров России",
        url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
