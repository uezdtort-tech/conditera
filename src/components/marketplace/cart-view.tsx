"use client";

/**
 * CartView — SPA-view корзины для renderView ("cart") и страницы /cart.
 *
 * Z-v20 (UX D14/D2): раньше ViewKey "cart" не имел case в renderView —
 * navigate("cart") из command-palette молча открывал главную. Корзина в
 * Conditera канонична как CartDrawer (Sheet), поэтому view НЕ дублирует
 * содержимое корзины, а по монту открывает ЕДИНСТВЕННЫЙ реальный CartDrawer
 * поверх лёгкой подложки (тот же контракт, что у страницы /cart).
 */

import { useEffect } from "react";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/marketplace/cart-drawer";
import { useAppStore } from "@/lib/store";

export function CartView() {
  const setCartOpen = useAppStore((s) => s.setCartOpen);
  const cartCount = useAppStore((s) => s.cart.length);

  // Открываем реальный дровер один раз при монте view.
  useEffect(() => {
    setCartOpen(true);
  }, [setCartOpen]);

  // Если пользователь закрыл дровер крестиком — не навязываем его снова:
  // подложка сама превращается в понятный экран с переходами.
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <CartDrawer />
      <div className="max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <ShoppingBag className="h-8 w-8 text-primary" aria-hidden="true" />
        </div>
        <h1 className="font-display text-2xl font-bold">Корзина</h1>
        {cartCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            В корзине {cartCount} {cartCount === 1 ? "товар" : "товаров"}. Панель
            корзины открыта рядом — продолжите оформление там.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Корзина пуста. Загляните в каталог и выберите вкусный торт.
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Button asChild>
            <Link href="/catalog">В каталог</Link>
          </Button>
          {cartCount > 0 && (
            <Button variant="outline" asChild>
              <Link href="/checkout">Оформление заказа</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
