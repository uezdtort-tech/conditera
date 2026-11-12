/**
 * product-card.test.tsx — маркер «от» и защита от фиктивных скидок (PR-4).
 *
 * Контракт Z-v32 ADDENDUM Этап 6:
 *   • «от {цена} ₽» в карточке — когда выбираемые опции могут поднять цену
 *     выше базовой (fillings с priceModifier > 0 / customizable);
 *   • без опций-модификаторов маркера нет;
 *   • зачёркнутая old_price — только при old_price > price (фиктивная
 *     скидка old <= price не рендится ни бейджем, ни зачёркиванием).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Product } from "@/lib/types";

// --- Мок store (zustand): ProductCard читает навигацию/избранное/кондитеров ---
const storeState = {
  navigate: vi.fn(),
  addToCart: vi.fn(),
  toggleFavorite: vi.fn(),
  isFavorite: vi.fn(() => false),
  confectioners: [] as unknown[],
};

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
}));

function productFixture(overrides: Partial<Product>): Product {
  return {
    id: "p1",
    title: "Медовик",
    slug: "medovik",
    description: "Классический медовик",
    price: 2400,
    category: "cakes",
    images: [],
    confectionerId: "c1",
    rating: 4.8,
    reviewsCount: 3,
    isAvailable: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

import { ProductCard } from "./product-card";

describe("ProductCard — маркер «от» (PR-4)", () => {
  it("fillings с priceModifier > 0 → «от» перед ценой", () => {
    render(
      <ProductCard
        product={productFixture({
          fillings: [{ name: "Шоколад-ганаш", priceModifier: 300 }],
        })}
      />,
    );
    const marker = screen.getByText("от");
    expect(marker).toBeInTheDocument();
    // Цена рядом с маркером — базовая (2 400 ₽), а не максимальная
    expect(screen.getByText(/2\s?400/)).toBeInTheDocument();
  });

  it("опции без модификаторов → маркера «от» нет", () => {
    render(
      <ProductCard
        product={productFixture({
          fillings: [{ name: "Классика", priceModifier: 0 }],
        })}
      />,
    );
    expect(screen.queryByText("от")).toBeNull();
  });

  it("пустой товар (без опций) → маркера «от» нет", () => {
    render(<ProductCard product={productFixture({})} />);
    expect(screen.queryByText("от")).toBeNull();
  });
});

describe("ProductCard — фиктивные скидки не рисуются (PR-4)", () => {
  it("old_price > price → зачёркнутая старая цена есть", () => {
    const { container } = render(
      <ProductCard product={productFixture({ price: 2400, oldPrice: 3000 })} />,
    );
    expect(container.querySelector(".line-through")).not.toBeNull();
  });

  it("old_price = price → ни зачёркивания, ни бейджа «-0%»", () => {
    const { container } = render(
      <ProductCard product={productFixture({ price: 2400, oldPrice: 2400 })} />,
    );
    expect(container.querySelector(".line-through")).toBeNull();
    expect(container.textContent).not.toContain("%");
  });

  it("old_price < price (грязные данные) → зачёркивания нет", () => {
    const { container } = render(
      <ProductCard product={productFixture({ price: 2400, oldPrice: 1900 })} />,
    );
    expect(container.querySelector(".line-through")).toBeNull();
  });
});
