/**
 * product-page.fillings-gate.test.tsx — гейт секции «Срезы торта по начинкам».
 *
 * Регрессия U-06: секция ProductSliceGallery монтируется в ProductPage под
 * условием `product.fillings && product.fillings.length > 0`
 * (product-page.tsx:1142). До фикса StoreProduct.fillings был undefined для
 * всех DB-товаров → гейт был мёртвым кодом на живых данных.
 *
 * Проверяется контракт гейта на уровне карточки:
 *   - fillings present + совпадающий slice (fillingName === filling.name) →
 *     секция рендерится, фото среза <img> в DOM;
 *   - fillings [] → секция отсутствует (и /slices вообще не запрашивается);
 *   - fillings present, но slice с НЕсовпадающим fillingName → секция есть,
 *     фото среза НЕ рендерится (SVG-fallback).
 *
 * Дочерние блоки (cross-sell/similar/video-reviews/галерея/AI/AR/sticky)
 * заглушены — их данные не входят в контракт гейта. ProductSliceGallery —
 * РЕАЛЬНЫЙ (fetch на /api/products/<id>/slices заглушен глобально).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Product } from "@/lib/types";

const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-00000000000b";

// --- Мок store (zustand): ProductPage читает nav/products/confectioners/... ---
const storeState = {
  nav: { page: "product", params: { id: PRODUCT_ID } },
  products: [],
  confectioners: [],
  favorites: [] as string[],
  addToCart: vi.fn(),
  toggleFavorite: vi.fn(),
  navigate: vi.fn(),
  setChatOpen: vi.fn(),
};

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

// --- Мок хука карточки: возвращаем fixture из теста (читается в момент вызова) ---
let detailResult: {
  data: { product: Product | null; reviews: never[] };
  isFetching: boolean;
  isLoading: boolean;
};

vi.mock("@/lib/supabase/use-marketplace", () => ({
  useLiveProductDetail: vi.fn(() => detailResult),
}));

// --- Заглушки дочерних блоков (не входят в контракт гейта) ---
vi.mock("@/components/marketplace/cross-sell-block", () => ({
  CrossSellBlock: () => null,
}));
vi.mock("@/components/marketplace/similar-products", () => ({
  SimilarProductsBlock: () => null,
}));
vi.mock("@/components/dashboard/customer-features-tabs", () => ({
  VideoReviewsSection: () => null,
}));
vi.mock("@/components/products/product-media-gallery", () => ({
  ProductMediaGallery: () => null,
}));
vi.mock("@/components/ai/ai-ask-product", () => ({
  AiAskProduct: () => null,
}));
vi.mock("@/components/ui/enhanced-components", () => ({
  StickyAddToCart: () => null,
  addRecentlyViewed: vi.fn(),
}));
vi.mock("@/components/marketplace/ar-viewer", () => ({
  ARViewer: () => null,
}));
vi.mock("@/components/layout/breadcrumbs", () => ({
  Breadcrumbs: () => null,
}));

// --- Заглушка глобального fetch: только /slices отдаёт данные ---
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.href;
  if (url.includes("/slices")) {
    return new Response(JSON.stringify({ slices: slicesFixture, total: slicesFixture.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
});

let slicesFixture: Array<{ id: string; productId: string; fillingName: string; image: string | null; config: unknown; caption: string | null; sortOrder: number }> = [];

function productFixture(fillings: Product["fillings"]): Product {
  return {
    id: PRODUCT_ID,
    title: "Порционные десерты (20 шт.)",
    slug: "deserty-portSIONnyye-20",
    description: "Набор порционных десертов",
    price: 4400,
    category: "desserts",
    images: ["/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-00000000f001"],
    confectionerId: "confectioner-uuid",
    rating: 4.8,
    reviewsCount: 2,
    isAvailable: true,
    fillings,
  };
}

function mockDetail(product: Product | null) {
  detailResult = { data: { product, reviews: [] }, isFetching: false, isLoading: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  slicesFixture = [];
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

import { ProductPage } from "./product-page";

describe("ProductPage — гейт секции «Срезы торта по начинкам» (U-06)", () => {
  it("fillings present + совпадающий slice → секция рендерится, фото среза в DOM", async () => {
    mockDetail(
      productFixture([{ name: "Шоколад-ганаш", priceModifier: 300 }])
    );
    slicesFixture = [
      {
        id: "acc-u06-slice-synthetic",
        productId: PRODUCT_ID,
        fillingName: "Шоколад-ганаш",
        image: "/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-00000000f001",
        config: null,
        caption: "Срез (acceptance)",
        sortOrder: 999,
      },
    ];

    render(<ProductPage />);

    // Карточка отрисовалась
    expect(await screen.findByText("Порционные десерты (20 шт.)")).toBeInTheDocument();
    // Секция срезов появилась (раньше — недостижима из DB-данных)
    expect(await screen.findByText("Срезы торта по начинкам")).toBeInTheDocument();
    // Совпадающий slice → <img> с фото среза (alt = имя начинки)
    const sliceImg = await screen.findByAltText("Шоколад-ганаш");
    expect(sliceImg).toHaveAttribute(
      "src",
      "/api/product-media/aaaaaaaa-aaaa-4aaa-8aaa-00000000f001"
    );
    // Данные срезов запрошены у реального эндпоинта
    const slicesCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/slices"));
    expect(slicesCall).toBeDefined();
    expect(String(slicesCall?.[0])).toContain(`/api/products/${PRODUCT_ID}/slices`);
  });

  it("fillings [] → секция отсутствует, /slices не запрашивается", async () => {
    mockDetail(productFixture([]));

    render(<ProductPage />);

    expect(await screen.findByText("Порционные десерты (20 шт.)")).toBeInTheDocument();
    expect(screen.queryByText("Срезы торта по начинкам")).toBeNull();
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("/slices"))
    ).toBe(false);
  });

  it("fillings present, slice с НЕсовпадающим fillingName → секция есть, фото среза нет", async () => {
    mockDetail(
      productFixture([{ name: "Шоколад-ганаш", priceModifier: 300 }])
    );
    slicesFixture = [
      {
        id: "other-slice",
        productId: PRODUCT_ID,
        fillingName: "Другая начинка",
        image: "/api/product-media/other",
        config: null,
        caption: null,
        sortOrder: 0,
      },
    ];

    render(<ProductPage />);

    expect(await screen.findByText("Срезы торта по начинкам")).toBeInTheDocument();
    // Матчинг строгий (slice.fillingName === filling.name) → чужое фото не рендерится
    expect(screen.queryByAltText("Шоколад-ганаш")).toBeNull();
    expect(screen.queryByAltText("Другая начинка")).toBeNull();
  });
});
