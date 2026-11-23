/**
 * product-card.test.tsx — union двух линий:
 *   • theirs (канон): cake-slice preview, compare-действие, «Настроить»;
 *   • ours (PR-4): маркер «от» и защита от фиктивных скидок.
 * Общий store-мок (vi.hoisted) обслуживает оба набора.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { ProductCard } from "@/components/marketplace/product-card";
import type { Product } from "@/lib/types";

const storeMock = vi.hoisted(() => ({
  state: {
    navigate: vi.fn(),
    addToCart: vi.fn(),
    toggleFavorite: vi.fn(),
    isFavorite: vi.fn(() => false),
    confectioners: [] as Array<{ id: string; businessName: string; avatar?: string; verified?: boolean }>,
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof storeMock.state) => unknown) => selector(storeMock.state),
}));

const makeProduct = (slices: Product["slices"] = []): Product => ({
  id: "product-1",
  title: "Торт «Малина»",
  slug: "tort-malina",
  description: "Бисквитный торт с малиной",
  price: 4500,
  category: "cakes" as Product["category"],
  images: ["/cake-cover.jpg"],
  confectionerId: "confectioner-1",
  rating: 4.9,
  reviewsCount: 12,
  slices,
} as Product);

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
  } as Product;
}

afterEach(() => {
  cleanup();
});

describe("ProductCard cake slice preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("показывает настоящее изображение разреза и начинку", () => {
    render(<ProductCard product={makeProduct([{
      id: "slice-1",
      image: "/api/product-slices/slice-1.jpg",
      fillingName: "Малина",
      caption: "Разрез торта",
    }])} />);

    expect(screen.getByAltText("Разрез торта")).toHaveAttribute("src", "/api/product-slices/slice-1.jpg");
    expect(screen.getByText("Разрез")).toBeInTheDocument();
    expect(screen.getByText("Малина")).toBeInTheDocument();
  });

  it("пропускает пустое изображение и выбирает первый реальный разрез", () => {
    render(<ProductCard product={makeProduct([
      { id: "slice-empty", image: "", fillingName: "Пустая запись" },
      { id: "slice-real", image: "/slice-real.jpg", fillingName: "Фисташка" },
    ])} />);

    expect(screen.getByAltText("Разрез торта «Торт «Малина»»")).toHaveAttribute("src", "/slice-real.jpg");
    expect(screen.getByText("Фисташка")).toBeInTheDocument();
    expect(screen.queryByText("Пустая запись")).not.toBeInTheDocument();
  });

  it("не показывает метку разреза, если нет ни изображения, ни конфигурации", () => {
    render(<ProductCard product={makeProduct([{ id: "slice-empty", image: "" }])} />);
    expect(screen.queryByText("Разрез")).not.toBeInTheDocument();
  });

  it("показывает конфигурационный срез, если фотографии ещё нет", () => {
    render(<ProductCard product={makeProduct([{
      id: "slice-config",
      image: "",
      fillingName: "Фисташка",
      config: {
        layers: [{ type: "cream", color: "#f0e2b6", label: "Фисташковый крем", height: 1 }],
      },
    }])} />);
    expect(screen.getByText("Разрез")).toBeInTheDocument();
    expect(screen.getByText("Фисташка")).toBeInTheDocument();
  });

  it("показывает действие сравнения внутри карточки и вызывает переданный обработчик", () => {
    const onCompare = vi.fn();
    render(<ProductCard product={makeProduct()} onCompare={onCompare} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить к сравнению" }));
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(storeMock.state.navigate).not.toHaveBeenCalled();
  });

  it("открывает блок персонализации товара по действию «Настроить»", () => {
    const product = makeProduct();
    product.fillings = [{ name: "Фисташка", priceModifier: 0 }];
    render(<ProductCard product={product} />);

    fireEvent.click(screen.getByRole("button", { name: "Настроить Торт «Малина»" }));

    expect(storeMock.state.navigate).toHaveBeenCalledWith("product", {
      id: "product-1",
      customize: "true",
    });
  });

  it("не показывает настройку, если у товара нет вариантов", () => {
    render(<ProductCard product={makeProduct()} />);
    expect(screen.queryByRole("button", { name: /Настроить/ })).not.toBeInTheDocument();
  });
});

describe("ProductCard — маркер «от» (PR-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
