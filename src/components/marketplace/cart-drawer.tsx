"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Minus, Plus, Trash2, ShoppingBag, Tag, X, Truck } from "lucide-react";
import { formatCurrency, calculateDelivery } from "@/lib/finance";
import { useState } from "react";
import { toast } from "sonner";

export function CartDrawer() {
  const cartOpen = useAppStore((s) => s.cartOpen);
  const setCartOpen = useAppStore((s) => s.setCartOpen);
  const cart = useAppStore((s) => s.cart);
  const updateCartQuantity = useAppStore((s) => s.updateCartQuantity);
  const removeFromCart = useAppStore((s) => s.removeFromCart);
  const clearCart = useAppStore((s) => s.clearCart);
  const navigate = useAppStore((s) => s.navigate);
  const applyPromo = useAppStore((s) => s.applyPromo);
  const clearPromo = useAppStore((s) => s.clearPromo);
  const promoCode = useAppStore((s) => s.promoCode);
  const promoDiscount = useAppStore((s) => s.promoDiscount);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);

  const [promoInput, setPromoInput] = useState("");

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Math.round(subtotal * promoDiscount);
  const deliveryCost = calculateDelivery(subtotal - discount).cost;
  const total = subtotal - discount + deliveryCost;

  const handleApplyPromo = () => {
    if (!promoInput.trim()) return;
    const result = applyPromo(promoInput);
    if (result.success) {
      toast.success("Промокод применён!", {
        description: `Скидка ${Math.round(result.discount * 100)}%`,
      });
      setPromoInput("");
    } else {
      toast.error("Промокод не найден", {
        description: "Проверьте правильность кода",
      });
    }
  };

  const handleCheckout = () => {
    if (cart.length === 0) {
      toast.error("Корзина пуста");
      return;
    }
    if (!isAuthenticated) {
      setCartOpen(false);
      setAuthModalOpen(true);
      toast.info("Войдите, чтобы оформить заказ");
      return;
    }
    setCartOpen(false);
    navigate("checkout");
  };

  return (
    <Sheet open={cartOpen} onOpenChange={setCartOpen}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            Корзина
            {cart.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {cart.reduce((s, i) => s + i.quantity, 0)} шт
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Ваша корзина покупок
          </SheetDescription>
        </SheetHeader>

        {cart.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Корзина пуста</h3>
              <p className="text-sm text-muted-foreground">
                Загляните в каталог и выберите вкусный торт
              </p>
            </div>
            <Button
              onClick={() => {
                setCartOpen(false);
                navigate("catalog");
              }}
            >
              В каталог
            </Button>
          </div>
        ) : (
          <>
            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.map((item, idx) => (
                <div
                  key={`${item.productId}-${idx}`}
                  className="flex gap-3 p-3 bg-card rounded-lg border border-border"
                >
                  <img
                    src={item.image}
                    alt={item.title}
                    className="h-16 w-16 rounded-md object-cover shrink-0" loading="lazy" decoding="async" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-medium line-clamp-2">
                        {item.title}
                      </h4>
                      <button
                        onClick={() => removeFromCart(item.productId)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        aria-label="Удалить"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    {item.customization && (
                      <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                        {item.customization.filling && (
                          <div>Начинка: {item.customization.filling}</div>
                        )}
                        {item.customization.coating && (
                          <div>Покрытие: {item.customization.coating}</div>
                        )}
                        {item.customization.decoration && (
                          <div>Декор: {item.customization.decoration}</div>
                        )}
                        {item.customization.inscription && (
                          <div>Надпись: &laquo;{item.customization.inscription}&raquo;</div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5 border border-border rounded-md">
                        <button
                          onClick={() =>
                            updateCartQuantity(item.productId, item.quantity - 1)
                          }
                          className="h-7 w-7 flex items-center justify-center hover:bg-accent rounded-l-md"
                          aria-label="Уменьшить"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="text-sm font-medium w-6 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() =>
                            updateCartQuantity(item.productId, item.quantity + 1)
                          }
                          className="h-7 w-7 flex items-center justify-center hover:bg-accent rounded-r-md"
                          aria-label="Увеличить"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="font-semibold text-sm">
                        {formatCurrency(item.price * item.quantity)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Promo */}
              <div className="pt-3 border-t">
                {promoCode ? (
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Tag className="h-4 w-4 text-emerald-600" />
                      <span className="font-medium">{promoCode}</span>
                      <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                        -{Math.round(promoDiscount * 100)}%
                      </Badge>
                    </div>
                    <button
                      onClick={() => {
                        clearPromo();
                        toast.info("Промокод удалён");
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={promoInput}
                      onChange={(e) => setPromoInput(e.target.value)}
                      placeholder="Промокод (например, WELCOME10)"
                      className="h-9"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleApplyPromo}
                      className="shrink-0"
                    >
                      Применить
                    </Button>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Попробуйте: WELCOME10, SWEET15, UYEZD20, BIRTHDAY
                </p>
              </div>

              <button
                onClick={() => {
                  clearCart();
                  toast.info("Корзина очищена");
                }}
                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                Очистить корзину
              </button>
            </div>

            {/* Footer */}
            <div className="border-t p-4 space-y-3 shrink-0">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Товары</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Скидка</span>
                    <span>−{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Truck className="h-3.5 w-3.5" />
                    Доставка
                  </span>
                  <span>
                    {deliveryCost === 0 ? "Бесплатно" : formatCurrency(deliveryCost)}
                  </span>
                </div>
                {deliveryCost > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Бесплатно от {formatCurrency(3000)}
                  </p>
                )}
              </div>
              <Separator />
              <div className="flex justify-between font-semibold text-base">
                <span>Итого</span>
                <span>{formatCurrency(total)}</span>
              </div>
              <Button
                size="lg"
                onClick={handleCheckout}
                className="w-full bg-primary"
              >
                Оформить заказ
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
