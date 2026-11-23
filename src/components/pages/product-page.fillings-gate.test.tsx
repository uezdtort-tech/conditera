/**
 * product-page.fillings-gate.test.tsx — гейт секции срезов на ProductPage.
 *
 * Канонический контракт (слияние 2026-11-23, коммиты 700c336f/444728fe
 * линии origin/main): секция «Реальные срезы товара из product_slices»
 * монтируется под условием `product.slices && product.slices.length > 0`.
 * Прежний гейт «Срезы торта по начинкам» (fillings + совпадение
 * fillingName, U-06) superseded: ProductSliceGallery канонической линии
 * не фильтрует срезы по совпадению с начинками и рендерит фото ИЛИ
 * конфигурационный превью.
 *
 * Проверяется контракт гейта на уровне ProductPage (галерея замокана):
 *   - slices present → ProductSliceGallery монтируется, props.slices
 *     переданы полностью (даже БЕЗ fillings — гейт больше не смотрит
 *     на начинки);
 *   - slices [] → галерея не монтируется.
 *
 * Дочерние блоки (cross-sell/similar/video-reviews/медиагалерея/AI/AR/
 * sticky) заглушены — их данные не входят в контракт гейта.
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

function productFixture(fillings: Product["fillings"], slices: Product["slices"] = []): Product {
  // Канонический поток данных: slices приходят в product из detail-запроса
  // (/api/products/[id] отдаёт { product, slices } → useLiveProductDetail
  // маппит их в product.slices — см. use-marketplace).
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
    slices,
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

// --- Мок канонической галереи: spy с записью props ---
const gallerySpy = vi.fn();
vi.mock("@/components/cake-slice/cake-slice-visualizer", () => ({
  ProductSliceGallery: (props: unknown) => {
    gallerySpy(props);
    return null;
  },
  FillingSlicePreview: () => null,
}));

import { ProductPage } from "./product-page";

describe("ProductPage — гейт канонической галереи срезов", () => {
  it("slices present (БЕЗ fillings) → галерея монтируется, props.slices переданы", async () => {
    const slices = [
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
    mockDetail(productFixture([], slices as Product["slices"]));

    render(<ProductPage />);

    expect(await screen.findByText("Порционные десерты (20 шт.)")).toBeInTheDocument();
    await vi.waitFor(() => expect(gallerySpy).toHaveBeenCalled());
    const props = gallerySpy.mock.calls[0][0] as { productId: string; slices: Array<{ id: string }> };
    expect(props.productId).toBe(PRODUCT_ID);
    expect(props.slices.map((x) => x.id)).toContain("acc-u06-slice-synthetic");
  });

  it("slices [] → галерея не монтируется", async () => {
    mockDetail(productFixture([{ name: "Шоколад-ганаш", priceModifier: 300 }]));
    slicesFixture = [];

    render(<ProductPage />);

    expect(await screen.findByText("Порционные десерты (20 шт.)")).toBeInTheDocument();
    // Демо-данные срезов (fetch /slices → []) не создают секцию
    await new Promise((r) => setTimeout(r, 20));
    expect(gallerySpy).not.toHaveBeenCalled();
  });
});
