/**
 * /api/cart — серверная корзина (P1 «серверная корзина», миграция 0062).
 *
 * Контракт владения: КАЖДАЯ операция фильтруется по user_id из сессии
 * (getUserFromRequest), НИКОГДА по user_id из тела. Чужие строки недостижимы:
 * чтение — .eq("user_id", me); мутация по client_ref — .eq("user_id", me).
 *
 * Методы:
 *   GET    → позиции текущего пользователя (+снапшот товара: title/price/images).
 *   POST   → upsert ОДНОЙ позиции по client_ref (абсолютное количество —
 *            идемпотентно при ретраях). Контент-дедуп: тот же товар+атрибуты
 *            под другим client_ref → MAX(количества), client_ref перезаписывается.
 *   PUT    → слияние состояния клиента (guest→login, перезагрузка, другое
 *            устройство): UNION по контент-ключу, quantity = MAX, серверные
 *            строки без входящей пары сохраняются. Возвращает ПОЛНОЕ merged-состояние.
 *   DELETE → очистить корзину пользователя (idempotent).
 *
 * Цены здесь НЕ пересчитываются и НЕ хранятся: финальная серверная истина —
 * POST /api/checkout (валидация товара/атрибутов + ЕДИНАЯ формула цены).
 * Здесь структурная валидация: товар существует и published; custom-конфиг
 * проходит validateBuilderConfig; известные ключи атрибутов; quantity 1..999.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromRequest } from "@/lib/auth";
import { enforceRateLimit, getClientIP, RATE_LIMITS } from "@/lib/rate-limit";
import {
  CartMergeInputSchema,
  cartContentKey,
  planCartMerge,
  validateCustomConfigError,
  type CartProductSnapshot,
  type CartRow,
} from "@/lib/cart-merge";

const PRODUCT_SELECT = "id, title, price, images";
const ROW_SELECT =
  "id, user_id, client_ref, product_id, quantity, selected_attributes, custom_config, notes, created_at, updated_at";

function unauthorized() {
  return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
}

async function loadProductSnapshots(
  productIds: string[]
): Promise<Map<string, CartProductSnapshot>> {
  const map = new Map<string, CartProductSnapshot>();
  if (productIds.length === 0) return map;
  const { data, error } = await supabaseAdmin
    .from("products")
    .select(PRODUCT_SELECT)
    .in("id", productIds);
  if (error) throw new Error(error.message);
  for (const p of (data || []) as Array<{
    id: string;
    title: string;
    price: number;
    images: unknown;
  }>) {
    map.set(p.id, { id: p.id, title: p.title, price: Number(p.price) || 0, images: p.images });
  }
  return map;
}

/** Строка БД → DTO ответа (снапшот товара — для восстановления корзины на новом устройстве). */
function rowToDto(row: CartRow, products: Map<string, CartProductSnapshot>) {
  const product = row.product_id ? products.get(row.product_id) ?? null : null;
  return {
    id: row.id,
    client_ref: row.client_ref,
    product_id: row.product_id,
    quantity: row.quantity,
    selected_attributes: row.selected_attributes,
    custom_config: row.custom_config,
    notes: row.notes,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    product,
  };
}

interface ValidatedItem {
  client_ref: string;
  product_id: string | null;
  quantity: number;
  selected_attributes: Record<string, string> | null;
  custom_config: Record<string, unknown> | null;
  notes: string | null;
}

/**
 * Валидация массива позиций: zod-форма + структурные проверки товара/конфига.
 * Возвращает либо валидированные позиции, либо NextResponse с ошибкой.
 */
async function validateItems(
  rawItems: unknown
): Promise<{ items: ValidatedItem[] } | { error: NextResponse }> {
  const parsed = CartMergeInputSchema.safeParse({ items: rawItems });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "items";
    return {
      error: NextResponse.json(
        { error: `Некорректные данные корзины (${path}): ${issue?.message || "validation failed"}` },
        { status: 400 }
      ),
    };
  }

  const items = parsed.data.items;

  // Товары: существование + published (то же правило, что в checkout)
  const productIds = [...new Set(items.map((i) => i.product_id).filter((x): x is string => !!x))];
  const productStatus = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("id, status")
      .in("id", productIds);
    if (error) {
      return { error: NextResponse.json({ error: "Ошибка загрузки товаров" }, { status: 500 }) };
    }
    for (const p of (products || []) as Array<{ id: string; status: string }>) {
      productStatus.set(p.id, p.status);
    }
    const missing = productIds.filter((id) => !productStatus.has(id));
    if (missing.length > 0) {
      return {
        error: NextResponse.json(
          { error: "Некоторые товары не найдены", productIds: missing.slice(0, 10) },
          { status: 400 }
        ),
      };
    }
    const drafts = productIds.filter((id) => productStatus.get(id) !== "published");
    if (drafts.length > 0) {
      return {
        error: NextResponse.json(
          { error: "Товары недоступны", productIds: drafts.slice(0, 10) },
          { status: 400 }
        ),
      };
    }
  }

  // Custom-конфиги: та же валидация, что в checkout (ЕДИНАЯ формула)
  for (const item of items) {
    if (item.custom_config) {
      const customError = validateCustomConfigError(item.custom_config);
      if (customError) {
        return {
          error: NextResponse.json(
            { error: customError, client_ref: item.client_ref },
            { status: 422 }
          ),
        };
      }
    }
  }

  return {
    items: items.map((i) => ({
      client_ref: i.client_ref,
      product_id: i.product_id ?? null,
      quantity: i.quantity,
      selected_attributes: i.selected_attributes
        ? (Object.fromEntries(
            Object.entries(i.selected_attributes).filter(([, v]) => v !== undefined)
          ) as Record<string, string>)
        : null,
      custom_config: i.custom_config ?? null,
      notes: i.notes ?? null,
    })),
  };
}

async function loadUserRows(userId: string): Promise<CartRow[]> {
  const { data: rows, error } = await supabaseAdmin
    .from("cart_items")
    .select(ROW_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (rows || []) as unknown as CartRow[];
}

async function cartGetResponse(userId: string): Promise<NextResponse> {
  try {
    const rows = await loadUserRows(userId);
    const products = await loadProductSnapshots(
      rows.map((r) => r.product_id).filter((x): x is string => !!x)
    );
    return NextResponse.json({ items: rows.map((r) => rowToDto(r, products)) });
  } catch (e) {
    console.error("[cart:GET] query error:", (e as Error).message);
    return NextResponse.json({ error: "Ошибка загрузки корзины" }, { status: 500 });
  }
}

// ===== GET /api/cart =====
export async function GET(request: NextRequest): Promise<NextResponse> {
  const blocked = await enforceRateLimit(
    request,
    `cart:${getClientIP(request)}`,
    RATE_LIMITS.api.limit,
    RATE_LIMITS.api.windowMs
  );
  if (blocked) return blocked as unknown as NextResponse;

  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();

  return cartGetResponse(user.id);
}

// ===== POST /api/cart — upsert одной позиции =====
export async function POST(request: NextRequest): Promise<NextResponse> {
  const blocked = await enforceRateLimit(
    request,
    `cart:post:${getClientIP(request)}`,
    RATE_LIMITS.api.limit,
    RATE_LIMITS.api.windowMs
  );
  if (blocked) return blocked as unknown as NextResponse;

  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();

  const body = await request.json().catch(() => null);
  const validated = await validateItems([body]);
  if ("error" in validated) return validated.error;
  const item = validated.items[0];

  const nowIso = new Date().toISOString();
  const rowPayload = {
    user_id: user.id,
    client_ref: item.client_ref,
    product_id: item.product_id,
    quantity: item.quantity,
    selected_attributes: item.selected_attributes,
    custom_config: item.custom_config,
    notes: item.notes,
    updated_at: nowIso,
  };

  try {
    // 1. Прямое совпадение по (user_id, client_ref) → обновить (абсолютное quantity)
    const rows = await loadUserRows(user.id);
    const byRef = rows.find((r) => r.client_ref === item.client_ref);

    if (byRef) {
      const { error } = await supabaseAdmin
        .from("cart_items")
        .update(rowPayload)
        .eq("id", byRef.id)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, mode: "updated" });
    }

    // 2. Контент-дедуп: тот же товар+атрибуты / тот же custom-конфиг под другим
    //    client_ref → MAX количества, client_ref перезаписывается на клиентский.
    const targetKey = cartContentKey({
      product_id: item.product_id,
      selected_attributes: item.selected_attributes,
      custom_config: item.custom_config,
    });
    const sameContent = rows.find((r) => cartContentKey(r) === targetKey);

    if (sameContent) {
      const mergedQty = Math.max(Number(sameContent.quantity) || 1, item.quantity);
      const { error } = await supabaseAdmin
        .from("cart_items")
        .update({ ...rowPayload, quantity: mergedQty })
        .eq("id", sameContent.id)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, mode: "merged" });
    }

    // 3. Новая позиция
    const { error } = await supabaseAdmin.from("cart_items").insert(rowPayload);
    if (error) {
      // Гонка двух параллельных POST с одним client_ref → 23505 по
      // uq_cart_user_client_ref → повторяем как обновление (идемпотентно).
      const pgCode = (error as { code?: string } | null)?.code;
      if (pgCode === "23505") {
        const { error: updError } = await supabaseAdmin
          .from("cart_items")
          .update(rowPayload)
          .eq("user_id", user.id)
          .eq("client_ref", item.client_ref);
        if (!updError) return NextResponse.json({ ok: true, mode: "updated" });
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, mode: "inserted" });
  } catch (e) {
    console.error("[cart:POST] error:", (e as Error).message);
    return NextResponse.json({ error: "Ошибка добавления в корзину" }, { status: 500 });
  }
}

// ===== PUT /api/cart — слияние состояния клиента (login/устройства) =====
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const blocked = await enforceRateLimit(
    request,
    `cart:put:${getClientIP(request)}`,
    RATE_LIMITS.api.limit,
    RATE_LIMITS.api.windowMs
  );
  if (blocked) return blocked as unknown as NextResponse;

  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();

  const body = await request.json().catch(() => null);
  const validated = await validateItems(body?.items ?? []);
  if ("error" in validated) return validated.error;

  try {
    const serverRows = await loadUserRows(user.id);
    const plan = planCartMerge(serverRows, validated.items);
    const nowIso = new Date().toISOString();

    // inserts (только у клиента) — client_ref = клиентский
    if (plan.inserts.length > 0) {
      const { error } = await supabaseAdmin.from("cart_items").insert(
        plan.inserts.map((i) => ({
          user_id: user.id,
          client_ref: i.client_ref,
          product_id: i.product_id,
          quantity: i.quantity,
          selected_attributes: i.selected_attributes,
          custom_config: i.custom_config,
          notes: i.notes,
          updated_at: nowIso,
        }))
      );
      if (error) throw new Error(error.message);
    }

    // updates: MAX(количества) + перезапись client_ref на клиентский
    for (const upd of plan.updates) {
      const { error } = await supabaseAdmin
        .from("cart_items")
        .update({ quantity: upd.quantity, client_ref: upd.client_ref, updated_at: nowIso })
        .eq("id", upd.id)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
    }

    // Полное merged-состояние (клиент заменяет им свою корзину)
    return await cartGetResponse(user.id);
  } catch (e) {
    console.error("[cart:PUT] error:", (e as Error).message);
    return NextResponse.json({ error: "Ошибка слияния корзины" }, { status: 500 });
  }
}

// ===== DELETE /api/cart — очистить корзину пользователя =====
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const blocked = await enforceRateLimit(
    request,
    `cart:delete:${getClientIP(request)}`,
    RATE_LIMITS.api.limit,
    RATE_LIMITS.api.windowMs
  );
  if (blocked) return blocked as unknown as NextResponse;

  const user = await getUserFromRequest(request);
  if (!user) return unauthorized();

  const { error } = await supabaseAdmin.from("cart_items").delete().eq("user_id", user.id);
  if (error) {
    console.error("[cart:DELETE] error:", error.message);
    return NextResponse.json({ error: "Ошибка очистки корзины" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
