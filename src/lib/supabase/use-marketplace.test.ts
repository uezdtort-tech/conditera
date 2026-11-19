import { describe, expect, it } from "vitest";
import { mapApiProductToProduct } from "./use-marketplace";

const baseApiProduct = {
  id: "product-1",
  title: "Торт «Малина»",
  slug: "tort-malina",
  description: "Бисквитный торт с малиной",
  price: 4500,
  old_price: null,
  weight_grams: 1800,
  servings: 12,
  tags: [],
  rating_average: 4.9,
  reviews_count: 12,
  is_featured: false,
  images: ["/cake-cover.jpg"],
  confectioner: {
    id: "confectioner-profile-1",
    businessName: "Кондитерская",
    avatar: "",
    verified: true,
    city: "Москва",
  },
} satisfies Parameters<typeof mapApiProductToProduct>[0];

describe("mapApiProductToProduct", () => {
  it("preserves real product_slices from the public catalog API", () => {
    const slices = [
      {
        id: "slice-1",
        fillingName: "Малина",
        image: "/api/product-slices/slice-1",
        caption: "Разрез с малиной",
        sortOrder: 0,
      },
      {
        id: "slice-2",
        fillingName: "Фисташка",
        image: "/api/product-slices/slice-2",
        caption: null,
        sortOrder: 1,
      },
    ];

    const product = mapApiProductToProduct({ ...baseApiProduct, slices });

    expect(product.slices).toEqual(slices);
  });

  it("returns an empty slice list when the API has no slices field", () => {
    const product = mapApiProductToProduct(baseApiProduct);

    expect(product.slices).toEqual([]);
  });
});
