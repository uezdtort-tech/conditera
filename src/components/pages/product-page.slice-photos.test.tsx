/**
 * product-page.slice-photos.test.tsx — регрессия U-06 (v4.2):
 * НЕпустые данные → в DOM карточки отображаются И главное фото товара,
 * И фото разреза, сцепленное с начинкой (fillingName → slice.image).
 *
 * Отличие от product-page.fillings-gate.test.tsx: там ProductMediaGallery
 * заглушен (контракт гейта секции); здесь галерея РЕАЛЬНАЯ — проверяется
 * фактический рендер главного фото из product.images.
 *
 * Слияние 2026-11-23: секция «Срезы торта по начинкам» (fillingName-гейт)
 * superseded канонической ProductSliceGallery (гейт product.slices.length>0,
 * slices приходят в product из detail-запроса). Фото разреза рендерится
 * ВНУТРИ галереи — контракт проверяется через spy-мок галереи (props.slices
 * с fixture-URL), без привязки к внутренностям компонента.
 *
 * Fixtures (явно обозначены, не выдаются за production-контент):
 *   - главное фото: РЕАЛЬНЫЙ ассет репо, используемый реальным продуктом
 *     ...0001 — /uploads/products/svadebnyy-tort-yagodnyy-barhat.png;
 *   - фото разреза: синтетический путь /test-fixtures/u06-slice-fixture.png
 *     (реальных фотографий разреза в БД нет — задокументированное
 *     ограничение U-06; владелец предоставляет контент, см.
 *     supabase/seed_slices.template.sql + RELEASE-GATE-v4.2-REPORT.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Product } from "@/lib/types";

const PRODUCT_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const MAIN_PHOTO = "/uploads/products/svadebnyy-tort-yagodnyy-barhat.png";
const SLICE_FIXTURE = "/test-fixtures/u06-slice-fixture.png";
const TITLE = "Свадебный торт «Ягодный бархат»";

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

// --- Мок хука карточки: fixture читается в момент вызова ---
let detailResult: {
  data: { product: Product | null; reviews: never[] };
  isFetching: boolean;
  isLoading: boolean;
};

vi.mock("@/lib/supabase/use-marketplace", () => ({
  useLiveProductDetail: vi.fn(() => detailResult),
}));

// --- Заглушки дочерних блоков (не входят в контракт этого теста).
// ВАЖНО: ProductMediaGallery НЕ заглушен — его рендер и есть предмет проверки. ---
vi.mock("@/components/marketplace/cross-sell-block", () => ({
  CrossSellBlock: () => null,
}));
vi.mock("@/components/marketplace/similar-products", () => ({
  SimilarProductsBlock: () => null,
}));
vi.mock("@/components/dashboard/customer-features-tabs", () => ({
  VideoReviewsSection: () => null,
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

// --- Заглушка глобального fetch: /slices отдаёт fixture-срез ---
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

let slicesFixture: Array<{
  id: string;
  productId: string;
  fillingName: string;
  image: string | null;
  config: unknown;
  caption: string | null;
  sortOrder: number;
}> = [];

function productFixture(
  fillings: Product["fillings"],
  slices: Product["slices"] = []
): Product {
  // Канонический поток данных: slices приходят в product из detail-запроса.
  return {
    id: PRODUCT_ID,
    title: TITLE,
    slug: "svadebnyy-tort-yagodnyy-barhat",
    description: "Описание товара",
    price: 8900,
    category: "cakes",
    images: [MAIN_PHOTO],
    media: [],
    confectionerId: "confectioner-uuid",
    rating: 4.9,
    reviewsCount: 3,
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

describe("ProductPage — главное фото и фото разреза при непустых данных (U-06, v4.2)", () => {
  it("главное фото из product.images рендерится реальной галереей", async () => {
    mockDetail(productFixture([{ name: "Шоколад-ганаш", priceModifier: 300 }]));

    const { container } = render(<ProductPage />);

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    // Реальная ProductMediaGallery: <img src={active.src}> — главное фото
    const mainImg = await vi.waitFor(() => {
      const img = container.querySelector<HTMLImageElement>(`img[src="${MAIN_PHOTO}"]`);
      expect(img).not.toBeNull();
      return img!;
    });
    expect(mainImg.getAttribute("src")).toBe(MAIN_PHOTO);
  });

  it("slices с fixture-URL переданы в каноническую галерею (props.slices)", async () => {
    const slices = [
      {
        id: "u06-v42-fixture-slice",
        fillingName: "Шоколад-ганаш",
        image: SLICE_FIXTURE,
        config: null,
        caption: "fixture (v4.2 регрессия)",
        sortOrder: 0,
      },
    ];
    mockDetail(
      productFixture(
        [
          { name: "Шоколад-ганаш", priceModifier: 300 },
          { name: "Малина-базилик", priceModifier: 0 },
        ],
        slices
      )
    );

    render(<ProductPage />);

    // Карточка отрисовалась, главное фото — реальной галереей (прошлый тест)
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    // Каноническая ProductSliceGallery получила slices с fixture-URL:
    // фото разреза рендерится внутри галереи (image + caption)
    await vi.waitFor(() => expect(gallerySpy).toHaveBeenCalled());
    const props = gallerySpy.mock.calls[0][0] as {
      productId: string;
      slices: Array<{ id: string; image: string | null }>;
    };
    expect(props.productId).toBe(PRODUCT_ID);
    const fixtureSlice = props.slices.find((x) => x.id === "u06-v42-fixture-slice");
    expect(fixtureSlice).toBeDefined();
    expect(fixtureSlice?.image).toBe(SLICE_FIXTURE);
  });
});
