"use client";

/**
 * LiveDecorHydrator — гидрация витрины декора live-данными из БД.
 *
 * Монтируется в оболочке приложения (app/page.tsx + route-fallback.tsx),
 * зеркалит LiveProductsHydrator/LiveServicesHydrator:
 *   • GET /api/builder/decor-shops — магазины (builder_decor_shops, 0014)
 *   • GET /api/decor/products      — товары (decor_products, 0040)
 * и замещает mock-данные в store (decorShops / decorProducts). Если БД
 * пуста/недоступна — витрина остаётся на mock-данных (dual-mode).
 *
 * Ничего не рендерит (returns null).
 */

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import type { DecorProduct, DecorShop } from "@/lib/types";

// DECOR_CATEGORIES — const-массив слагов витрины (candles/toppers/...)
const VALID_DECOR_SLUGS = new Set([
  "candles", "toppers", "boards", "boxes", "ribbon", "sparklers",
  "figures", "flowers", "packaging", "tools", "gift_cards",
]);

interface ApiShopRow {
  id: string;
  name: string;
  description: string | null;
  logo: string | null;
  city: string | null;
  delivery_cities: string[] | null;
  rating: number | string | null;
  reviews_count: number | null;
  is_verified: boolean | null;
  categories: string[] | null;
}

interface ApiProductRow {
  id: string;
  shopId: string | null;
  title: string;
  description: string;
  price: number;
  images: string[];
  category: string | null;
  inStock: boolean;
}

function mapShop(row: ApiShopRow): DecorShop {
  return {
    id: row.id,
    businessName: row.name,
    description: row.description || "",
    avatar: row.logo || "",
    city: row.city || "Россия",
    rating: Number(row.rating ?? 0),
    reviewsCount: row.reviews_count ?? 0,
    shipsNationwide: true,
    deliveryCities: row.delivery_cities || [],
    minOrder: 0,
    categories: (row.categories || []).filter((c): c is DecorShop["categories"][number] =>
      (VALID_DECOR_SLUGS as Set<string>).has(c)
    ),
    verified: row.is_verified === true,
  };
}

function mapProduct(
  row: ApiProductRow,
  shopById: Map<string, ApiShopRow>
): DecorProduct {
  const shop = row.shopId ? shopById.get(row.shopId) : undefined;
  const category = row.category && (VALID_DECOR_SLUGS as Set<string>).has(row.category)
    ? (row.category as DecorProduct["category"])
    : "tools";
  return {
    id: row.id,
    shopId: row.shopId || "",
    shopName: shop?.name || "Магазин декора",
    shopAvatar: shop?.logo || undefined,
    title: row.title,
    description: row.description || "",
    category,
    price: Number(row.price ?? 0),
    images: Array.isArray(row.images) ? row.images : [],
    rating: 4.5, // decor_products (0040) без rating-колонки — нейтральное значение
    reviewsCount: 0,
    inStock: row.inStock ? 1 : 0,
  };
}

export function LiveDecorHydrator() {
  const setLiveDecorShops = useAppStore((s) => s.setLiveDecorShops);
  const setLiveDecorProducts = useAppStore((s) => s.setLiveDecorProducts);

  const [payload, setPayload] = useState<{
    shops: ApiShopRow[];
    products: ApiProductRow[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [shopsRes, productsRes] = await Promise.all([
          fetch("/api/builder/decor-shops?limit=20"),
          fetch("/api/decor/products?limit=60"),
        ]);
        if (!shopsRes.ok || !productsRes.ok) return;
        const shopsJson = (await shopsRes.json()) as { shops?: ApiShopRow[] };
        const productsJson = (await productsRes.json()) as { products?: ApiProductRow[] };
        if (cancelled) return;
        setPayload({
          shops: shopsJson.shops || [],
          products: productsJson.products || [],
        });
      } catch {
        // API недоступен — витрина остаётся на mock-данных
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    const { shops, products } = payload;
    // Dual-mode: пустой ответ из БД — не затираем mock (setters сами гвардят)
    setLiveDecorShops(shops.map(mapShop));
    const shopById = new Map(shops.map((s) => [s.id, s]));
    setLiveDecorProducts(products.map((p) => mapProduct(p, shopById)));
  }, [payload, setLiveDecorShops, setLiveDecorProducts]);

  return null;
}
