"use client";

/**
 * /cart — страница корзины.
 *
 * Z-v20: содержимое вынесено в общий компонент CartView
 * (components/marketplace/cart-view.tsx) — единственная каноническая
 * реализация подложки корзины, переиспользуется и SPA-view "cart"
 * (navigate("cart") из command-palette), и этой страницей.
 */

import { CartView } from "@/components/marketplace/cart-view";

export default function CartPage() {
  return (
    <main>
      <CartView />
    </main>
  );
}
