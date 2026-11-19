import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("не показывает метку разреза, если реального изображения нет", () => {
    render(<ProductCard product={makeProduct([{ id: "slice-empty", image: "" }])} />);
    expect(screen.queryByText("Разрез")).not.toBeInTheDocument();
  });

  it("показывает действие сравнения внутри карточки и вызывает переданный обработчик", () => {
    const onCompare = vi.fn();
    render(<ProductCard product={makeProduct()} onCompare={onCompare} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить к сравнению" }));
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(storeMock.state.navigate).not.toHaveBeenCalled();
  });

  it("показывает настройку только для товаров с вариантами и открывает блок персонализации", () => {
    const product = makeProduct();
    product.fillings = [{ name: "Малина", priceModifier: 0 }];
    render(<ProductCard product={product} />);
    fireEvent.click(screen.getByRole("button", { name: "Настроить Торт «Малина»" }));
    expect(storeMock.state.navigate).toHaveBeenCalledWith("product", {
      id: "product-1",
      customize: "true",
    });
  });

  it("не показывает действие настройки для товара без вариантов", () => {
    render(<ProductCard product={makeProduct()} />);
    expect(screen.queryByRole("button", { name: /Настроить/ })).not.toBeInTheDocument();
  });
});
