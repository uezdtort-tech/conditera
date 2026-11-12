/**
 * catalog-page.test.tsx — публичный каталог на РЕАЛЬНЫХ live-данных (ZV31-017).
 *
 * Регрессия: с пустым ответом /api/products каталог рендерил mock-товары из
 * store («Торт „Купеческий медовик"» за 2 300 ₽, id=p2), которых нет в БД;
 * клик по карточке давал 404 /api/products/p2.
 *
 * Контракт страницы (по образцу recipes-catalog):
 *   • loading → skeleton (aria-busy), без карточек;
 *   • ошибка API → честное «Не удалось загрузить каталог» + кнопка «Повторить»
 *     (refetch); mock-данные НИКОГДА не подменяют серверный сбой;
 *   • пустой ответ БД → честное «Каталог пока пуст», без фейковых карточек/цен;
 *   • live-данные → карточки с реальными названиями (путь без изменений);
 *   • demo-escape-hatch NEXT_PUBLIC_DEMO_MODE='1' → прежний dual-mode
 *     (mock-сид store до прихода live-данных).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Product } from "@/lib/types";

// --- Состояние live-запроса /api/products (мок useLiveProducts) ---
const liveState = vi.hoisted(() => ({
  data: undefined as unknown[] | undefined,
  isPending: true,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@/lib/supabase/use-marketplace", () => ({
  useLiveProducts: () => liveState,
}));

// --- Мок store (zustand): каталог читает navigate/products/confectioners/nav ---
const storeState = vi.hoisted(() => {
  const state = {
    navigate: vi.fn(),
    products: [] as unknown[],
    confectioners: [] as unknown[],
    nav: { params: null as null | Record<string, string> },
  };
  return state;
});

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

// --- Тяжёлые дочерние компоненты — стабы (фокус теста: состояния данных) ---
vi.mock("@/components/marketplace/product-card", () => ({
  ProductCard: ({ product }: { product: { id: string; title: string } }) => (
    <div data-testid="product-card" data-product-id={product.id}>
      {product.title}
    </div>
  ),
}));
vi.mock("@/components/marketplace/help-choose-dialog", () => ({
  HelpChooseDialog: () => null,
}));
vi.mock("@/components/ai/ai-smart-search", () => ({
  AiSmartSearch: () => null,
}));
vi.mock("@/components/ai/ai-compare-dialog", () => ({
  AiCompareDialog: () => null,
}));

import { CatalogPage } from "./catalog-page";

const LIVE_A = { id: "live-uuid-1", title: "Бенто-торт «Нежный»", price: 1900 } as Product;
const LIVE_B = { id: "live-uuid-2", title: "Торт «Ягодный бархат»", price: 3200 } as Product;
const MOCK_PRODUCT = {
  id: "p2",
  title: "Торт «Купеческий медовик»",
  price: 2300,
} as Product;

function setLive(patch: Partial<typeof liveState>): void {
  liveState.data = patch.data;
  liveState.isPending = patch.isPending ?? false;
  liveState.isError = patch.isError ?? false;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.products = [];
  storeState.confectioners = [];
  storeState.nav = { params: null };
  setLive({ data: undefined, isPending: true, isError: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function renderCatalog(): void {
  render(<CatalogPage />);
}

describe("CatalogPage — honest data states (ZV31-017)", () => {
  it("loading → skeleton (aria-busy), без карточек и без mock-подстановки", () => {
    setLive({ isPending: true, data: undefined });
    storeState.products = [MOCK_PRODUCT]; // mock в store НЕ должен показаться
    renderCatalog();

    expect(screen.getByRole("status", { name: "Загрузка каталога" })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByTestId("product-card")).toBeNull();
    expect(screen.queryByText("Торт «Купеческий медовик»")).toBeNull();
    expect(screen.getByText("Загружаем каталог…")).toBeInTheDocument();
  });

  it("ошибка API → роль alert, «Не удалось загрузить каталог» + «Повторить» (refetch), mock не подставляется", async () => {
    const user = userEvent.setup();
    setLive({ isError: true, data: undefined });
    storeState.products = [MOCK_PRODUCT]; // серверный сбой НЕ маскируется демо-данными
    renderCatalog();

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText("Не удалось загрузить каталог")).toBeInTheDocument();
    expect(screen.queryByTestId("product-card")).toBeNull();
    expect(screen.queryByText("Торт «Купеческий медовик»")).toBeNull();

    const retry = screen.getByRole("button", { name: "Повторить" });
    expect(liveState.refetch).not.toHaveBeenCalled();
    await user.click(retry);
    expect(liveState.refetch).toHaveBeenCalledTimes(1);
  });

  it("пустой ответ БД (success, []) → честное «Каталог пока пуст», без фейковых карточек", () => {
    setLive({ data: [] });
    storeState.products = [MOCK_PRODUCT]; // пустой каталог = пустая витрина, не mock
    renderCatalog();

    expect(screen.getByText("Каталог пока пуст")).toBeInTheDocument();
    expect(screen.getByText(/Кондитеры ещё не опубликовали товары/)).toBeInTheDocument();
    expect(screen.queryByTestId("product-card")).toBeNull();
    expect(screen.queryByText("Торт «Купеческий медовик»")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("live-данные → карточки с реальными названиями (путь без изменений)", () => {
    setLive({ data: [LIVE_A, LIVE_B] });
    renderCatalog();

    const cards = screen.getAllByTestId("product-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("Бенто-торт «Нежный»")).toBeInTheDocument();
    expect(screen.getByText("Торт «Ягодный бархат»")).toBeInTheDocument();
    expect(screen.queryByText("Каталог пока пуст")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("live-данные не содержат mock-товаров (id=p2 не рендерится)", () => {
    setLive({ data: [LIVE_A, LIVE_B] });
    renderCatalog();

    const ids = screen
      .getAllByTestId("product-card")
      .map((el) => el.getAttribute("data-product-id"));
    expect(ids).toEqual(["live-uuid-1", "live-uuid-2"]);
    expect(ids).not.toContain("p2");
  });
});

describe("CatalogPage — demo-escape-hatch NEXT_PUBLIC_DEMO_MODE='1'", () => {
  it("demo + live грузится → mock-сид store показывается (прежний dual-mode)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    setLive({ isPending: true, data: undefined });
    storeState.products = [MOCK_PRODUCT];
    renderCatalog();

    expect(screen.getByTestId("product-card")).toBeInTheDocument();
    expect(screen.getByText("Торт «Купеческий медовик»")).toBeInTheDocument();
  });

  it("demo + live вернул данные → mock замещается live-карточками", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    setLive({ data: [LIVE_A] });
    storeState.products = [MOCK_PRODUCT];
    renderCatalog();

    expect(screen.getByText("Бенто-торт «Нежный»")).toBeInTheDocument();
    expect(screen.queryByText("Торт «Купеческий медовик»")).toBeNull();
  });

  it("demo + ошибка API → mock ВСЁ РАВНО не показывается (ошибка честная)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "1");
    setLive({ isError: true, data: undefined });
    storeState.products = [MOCK_PRODUCT];
    renderCatalog();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("product-card")).toBeNull();
    expect(screen.queryByText("Торт «Купеческий медовик»")).toBeNull();
  });
});
