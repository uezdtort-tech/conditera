"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductCard } from "@/components/marketplace/product-card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CATEGORIES } from "@/lib/mock-data";
import { productMatchesPaymentFilter, PAYMENT_METHOD_INFO } from "@/lib/finance";
import type { PaymentFilterOption } from "@/lib/types";
import { Search, SlidersHorizontal, X, Filter, Cake, CreditCard } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function CatalogPage() {
  const navigate = useAppStore((s) => s.navigate);
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);
  const nav = useAppStore((s) => s.nav);

  const initialCategory = nav.params?.category || "all";
  const initialQuery = nav.params?.q || "";

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState<string>(initialCategory);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 15000]);
  const [selectedConfectioners, setSelectedConfectioners] = useState<string[]>([]);
  const [onlyVeg, setOnlyVeg] = useState(false);
  const [onlyHit, setOnlyHit] = useState(false);
  const [paymentFilters, setPaymentFilters] = useState<PaymentFilterOption[]>([]);
  const [tasteFilters, setTasteFilters] = useState<string[]>([]);
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>("popular");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    let result = [...products];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (activeCategory !== "all") {
      result = result.filter((p) => p.category === activeCategory);
    }
    result = result.filter(
      (p) => p.price >= priceRange[0] && p.price <= priceRange[1]
    );
    if (selectedConfectioners.length > 0) {
      result = result.filter((p) =>
        selectedConfectioners.includes(p.confectionerId)
      );
    }
    if (onlyHit) result = result.filter((p) => p.isHit || p.isPopular);
    if (minRating > 0) result = result.filter((p) => p.rating >= minRating);
    if (tasteFilters.length > 0) {
      result = result.filter((p) =>
        tasteFilters.every((taste) =>
          p.tags?.some((t) => t.toLowerCase().includes(taste.toLowerCase())) ||
          p.title.toLowerCase().includes(taste.toLowerCase()) ||
          p.description.toLowerCase().includes(taste.toLowerCase())
        )
      );
    }
    // Фильтр по способу оплаты
    if (paymentFilters.length > 0) {
      result = result.filter((p) => {
        const confectioner = confectioners.find((c) => c.id === p.confectionerId);
        return paymentFilters.every((opt) => productMatchesPaymentFilter(p, confectioner, opt));
      });
    }
    switch (sortBy) {
      case "price-asc":
        result.sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        result.sort((a, b) => b.price - a.price);
        break;
      case "rating":
        result.sort((a, b) => b.rating - a.rating);
        break;
      case "popular":
      default:
        result.sort((a, b) => b.reviewsCount - a.reviewsCount);
    }
    return result;
  }, [products, searchQuery, activeCategory, priceRange, selectedConfectioners, onlyHit, paymentFilters, tasteFilters, minRating, confectioners, sortBy]);

  const FiltersContent = (
    <div className="space-y-6">
      {/* Categories */}
      <div>
        <h4 className="font-medium text-sm mb-3">Категории</h4>
        <div className="space-y-1.5">
          <button
            onClick={() => setActiveCategory("all")}
            className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-sm ${
              activeCategory === "all"
                ? "bg-primary/10 text-primary font-medium"
                : "hover:bg-accent"
            }`}
          >
            <Filter className="h-3.5 w-3.5" />
            Все категории
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setActiveCategory(cat.slug)}
              className={`flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-sm ${
                activeCategory === cat.slug
                  ? "bg-primary/10 text-primary font-medium"
                  : "hover:bg-accent"
              }`}
            >
              <span>{cat.icon}</span>
              {cat.name}
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {cat.count}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {/* Price range */}
      <div>
        <h4 className="font-medium text-sm mb-3">Цена</h4>
        <div className="px-2">
          <Slider
            value={priceRange}
            onValueChange={(v) => setPriceRange(v as [number, number])}
            min={0}
            max={15000}
            step={100}
            className="mb-3"
          />
          <div className="flex items-center gap-2 text-sm">
            <Input
              type="number"
              value={priceRange[0]}
              onChange={(e) => setPriceRange([+e.target.value, priceRange[1]])}
              className="h-8"
            />
            <span>—</span>
            <Input
              type="number"
              value={priceRange[1]}
              onChange={(e) => setPriceRange([priceRange[0], +e.target.value])}
              className="h-8"
            />
          </div>
        </div>
      </div>

      {/* Confectioners */}
      <div>
        <h4 className="font-medium text-sm mb-3">Кондитеры</h4>
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {confectioners.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={selectedConfectioners.includes(c.id)}
                onCheckedChange={(checked) => {
                  if (checked) setSelectedConfectioners([...selectedConfectioners, c.id]);
                  else
                    setSelectedConfectioners(
                      selectedConfectioners.filter((id) => id !== c.id)
                    );
                }}
              />
              <span className="truncate">{c.businessName}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Other filters */}
      <div>
        <h4 className="font-medium text-sm mb-3">Дополнительно</h4>
        <label className="flex items-center gap-2 text-sm cursor-pointer mb-2">
          <Checkbox checked={onlyHit} onCheckedChange={(v) => setOnlyHit(!!v)} />
          Только хиты и популярные
        </label>
        <div className="mt-2">
          <div className="text-xs text-muted-foreground mb-1">Минимальный рейтинг</div>
          <div className="flex gap-1">
            {[0, 4.0, 4.5, 4.8, 4.9].map((r) => (
              <button
                key={r}
                onClick={() => setMinRating(r)}
                className={`px-2 py-0.5 text-xs rounded border ${
                  minRating === r ? "bg-primary text-primary-foreground border-primary" : "border-border"
                }`}
              >
                {r === 0 ? "Любой" : `≥${r}`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Taste/ingredients filter */}
      <div>
        <h4 className="font-medium text-sm mb-3">Вкус / ингредиенты</h4>
        <div className="flex flex-wrap gap-1">
          {["шоколад", "ягоды", "карамель", "орехи", "ваниль", "лимон", "мёд", "сгущёнка", "маракуйя", "красный бархат"].map((taste) => (
            <button
              key={taste}
              onClick={() => {
                if (tasteFilters.includes(taste)) {
                  setTasteFilters(tasteFilters.filter((t) => t !== taste));
                } else {
                  setTasteFilters([...tasteFilters, taste]);
                }
              }}
              className={`px-2 py-1 text-xs rounded-full border ${
                tasteFilters.includes(taste)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              {taste}
            </button>
          ))}
        </div>
      </div>

      {/* Payment method filter */}
      <div>
        <h4 className="font-medium text-sm mb-3 flex items-center gap-1.5">
          <CreditCard className="h-4 w-4" />
          Способ оплаты
        </h4>
        <div className="space-y-2">
          {([
            { id: "installment_0" as PaymentFilterOption, label: "💳 Беспроцентная рассрочка 0%", icon: "📅" },
            { id: "installment_3" as PaymentFilterOption, label: "Рассрочка от 3 мес", icon: "📅" },
            { id: "installment_6" as PaymentFilterOption, label: "Рассрочка от 6 мес", icon: "📅" },
            { id: "split" as PaymentFilterOption, label: "🔀 Разделить платёж (Сплит)", icon: "🔀" },
            { id: "sbp" as PaymentFilterOption, label: "⚡ СБП (по QR)", icon: "⚡" },
            { id: "cash" as PaymentFilterOption, label: "💵 Наличными при получении", icon: "💵" },
            { id: "card" as PaymentFilterOption, label: "💳 Банковская карта", icon: "💳" },
            { id: "escrow" as PaymentFilterOption, label: "🛡️ Эскроу 24ч (безопасно)", icon: "🛡️" },
          ]).map((opt) => (
            <label
              key={opt.id}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={paymentFilters.includes(opt.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setPaymentFilters([...paymentFilters, opt.id]);
                  } else {
                    setPaymentFilters(paymentFilters.filter((f) => f !== opt.id));
                  }
                }}
              />
              <span className="text-xs">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setActiveCategory("all");
          setPriceRange([0, 15000]);
          setSelectedConfectioners([]);
          setOnlyHit(false);
          setPaymentFilters([]);
          setTasteFilters([]);
          setMinRating(0);
          setSortBy("popular");
        }}
      >
        Сбросить фильтры
      </Button>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      <Breadcrumbs items={[{ label: "Каталог" }]} />
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
          Каталог кондитерских изделий
        </h1>
        <p className="text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "товар" : "товаров"} от{" "}
          {confectioners.length} кондитеров по всей России
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию, описанию или тегам..."
            className="pl-10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-44 shrink-0">
            <SelectValue placeholder="Сортировка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">Популярные</SelectItem>
            <SelectItem value="price-asc">Сначала дешевле</SelectItem>
            <SelectItem value="price-desc">Сначала дороже</SelectItem>
            <SelectItem value="rating">По рейтингу</SelectItem>
          </SelectContent>
        </Select>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="lg:hidden shrink-0">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-4 overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Фильтры</SheetTitle>
            </SheetHeader>
            <div className="mt-4">{FiltersContent}</div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sidebar — desktop filters */}
        <aside className="hidden lg:block">
          <Card className="p-4 sticky top-20">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Фильтры
            </h3>
            {FiltersContent}
          </Card>
        </aside>

        {/* Grid */}
        <div>
          {filtered.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
                <Search className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="font-semibold mb-1">Ничего не найдено</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Попробуйте изменить параметры поиска или фильтры
              </p>
              <Button
                onClick={() => {
                  setSearchQuery("");
                  setActiveCategory("all");
                  setPriceRange([0, 15000]);
                  setSelectedConfectioners([]);
                  setOnlyHit(false);
                  setPaymentFilters([]);
                }}
              >
                Сбросить всё
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
