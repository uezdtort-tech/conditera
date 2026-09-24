"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MOCK_SUPPLIERS, MOCK_SUPPLIER_PRODUCTS } from "@/lib/mock-data";
import { MarketplaceCtaCard } from "@/components/marketplace/marketplace-cta-card";
import { formatCurrency } from "@/lib/finance";
import {
  Store,
  ShoppingCart,
  Star,
  MapPin,
  Truck,
  Package,
  Plus,
  Minus,
  Check,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export function SupplierShopPage() {
  const navigate = useAppStore((s) => s.navigate);
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});

  const filteredProducts =
    selectedSupplier === "all"
      ? MOCK_SUPPLIER_PRODUCTS
      : MOCK_SUPPLIER_PRODUCTS.filter((p) => p.supplierId === selectedSupplier);

  const addToCart = (id: string) => {
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + 1 }));
    toast.success("Добавлено в корзину поставщика");
  };
  const removeFromCart = (id: string) => {
    setCart((c) => {
      const next = { ...c };
      if (next[id] > 1) next[id] -= 1;
      else delete next[id];
      return next;
    });
  };

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      <div className="mb-6">
        <Badge className="mb-2 bg-emerald-100 text-emerald-800 border-emerald-200">
          <Store className="h-3 w-3 mr-1" />
          B2B-магазин
        </Badge>
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Магазин ингредиентов и оборудования
        </h1>
        <p className="text-muted-foreground">
          Оптовые поставки для кондитеров: мука, шоколад, сливки, ягоды и
          многое другое. Прямые поставки от производителей.
        </p>
      </div>

      {/* Suppliers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Card
          onClick={() => setSelectedSupplier("all")}
          className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${
            selectedSupplier === "all" ? "border-primary bg-primary/5" : ""
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Все поставщики</div>
              <div className="text-xs text-muted-foreground">
                {MOCK_SUPPLIER_PRODUCTS.length} товаров
              </div>
            </div>
          </div>
        </Card>
        {MOCK_SUPPLIERS.map((s) => (
          <Card
            key={s.id}
            onClick={() => setSelectedSupplier(s.id)}
            className={`p-4 cursor-pointer hover:shadow-md transition-shadow ${
              selectedSupplier === s.id ? "border-primary bg-primary/5" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={s.avatar} alt={s.businessName} />
                <AvatarFallback>{s.businessName.slice(0, 2)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{s.businessName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {s.city} • ⭐ {s.rating}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Products grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredProducts.map((p, i) => {
          const supplier = MOCK_SUPPLIERS.find((s) => s.id === p.supplierId);
          const qty = cart[p.id] || 0;
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="overflow-hidden p-0 h-full flex flex-col hover:shadow-md transition-shadow">
                <div className="aspect-square bg-muted">
                  <img
                    src={p.image}
                    alt={p.title}
                    className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
                <div className="p-3 flex-1 flex flex-col">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Store className="h-3 w-3" />
                    {supplier?.businessName}
                  </div>
                  <h3 className="font-medium text-sm line-clamp-2 mb-1">
                    {p.title}
                  </h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                    {p.description}
                  </p>
                  <div className="flex items-center gap-2 text-xs mb-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {p.category}
                    </Badge>
                    <span className="text-muted-foreground">
                      Осталось: {p.inStock} {p.unit}
                    </span>
                  </div>
                  {p.bulkPrices && p.bulkPrices.length > 0 && (
                    <div className="text-[11px] text-emerald-700 bg-emerald-50 rounded p-1.5 mb-2">
                      Опт:{" "}
                      {p.bulkPrices.map((b, i) => (
                        <span key={i}>
                          {i > 0 && " • "}
                          от {b.quantity} {p.unit}: {formatCurrency(b.price)}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex items-end justify-between">
                    <div>
                      <div className="font-display font-bold text-lg">
                        {formatCurrency(p.price)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        за {p.unit}
                      </div>
                    </div>
                    {qty === 0 ? (
                      <Button size="sm" onClick={() => addToCart(p.id)}>
                        <Plus className="h-4 w-4 mr-1" />
                        В корзину
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1 border border-border rounded-md">
                        <button
                          onClick={() => removeFromCart(p.id)}
                          className="h-7 w-7 flex items-center justify-center hover:bg-accent rounded-l-md"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-6 text-center text-sm font-medium">
                          {qty}
                        </span>
                        <button
                          onClick={() => addToCart(p.id)}
                          className="h-7 w-7 flex items-center justify-center hover:bg-accent rounded-r-md"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* CTA: зазывалка для поставщиков ингредиентов */}
      <MarketplaceCtaCard
        badge="Для поставщиков и производителей"
        title="Вы поставляете ингредиенты, сырьё или упаковку?"
        description="Продавайте кондитерам напрямую: оптовые цены, повторные заказы из личного кабинета, складской учёт и готовая аудитория из тысяч домашних и студийных кондитеров. Комиссия — от 4%."
        primaryLabel="Присоединиться и разместить каталог"
        secondaryLabel="Условия для поставщиков"
        secondaryView="for-suppliers"
      />

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12">
        {[
          {
            icon: Truck,
            title: "Доставка по России",
            text: "1-3 дня по Москве, 3-7 дней по регионам. Бесплатно от 10 000 ₽",
          },
          {
            icon: Package,
            title: "Оптовые цены",
            text: "Скидки от объёма. Прямые поставки от производителей",
          },
          {
            icon: Check,
            title: "Сертификация",
            text: "Все товары сертифицированы. Документы доступны в личном кабинете",
          },
        ].map((c, i) => {
          const Icon = c.icon;
          return (
            <Card key={i} className="p-4">
              <Icon className="h-8 w-8 text-primary mb-2" />
              <div className="font-semibold mb-1">{c.title}</div>
              <div className="text-sm text-muted-foreground">{c.text}</div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
