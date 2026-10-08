"use client";

import { useAppStore } from "@/lib/store";
import { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductCard } from "@/components/marketplace/product-card";
import { HelpChooseDialog } from "@/components/marketplace/help-choose-dialog";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AiSmartSearch } from "@/components/ai/ai-smart-search";
import { AiCompareDialog } from "@/components/ai/ai-compare-dialog";
import type { AiSearchFilters } from "@/lib/ai-search-types";
import { CATEGORIES } from "@/lib/mock-data";
import { productMatchesPaymentFilter, PAYMENT_METHOD_INFO } from "@/lib/finance";
import type { PaymentFilterOption } from "@/lib/types";
import {
  parseQueryIntent,
  filterAndRank,
  toSearchDoc,
  wordStem,
  matchesOccasion,
  passesAllergen,
  ALLERGEN_GROUPS,
  OCCASIONS,
  emptyHelpAnswers,
  type AllergenKey,
  type HelpChooseAnswers,
  type OccasionKey,
  type RankOptions,
} from "@/lib/product-search";
import { toast } from "sonner";
import { Search, SlidersHorizontal, X, Filter, Cake, CreditCard, Scale, Sparkles } from "lucide-react";
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

  // Фильтры, пришедшие из умного поиска на главной (nav.params.ai = JSON AiSearchFilters)
  const initialAiFilters: AiSearchFilters | null = (() => {
    const raw = nav.params?.ai;
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AiSearchFilters;
    } catch {
      return null;
    }
  })();

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState<string>(initialCategory);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 15000]);
  const [selectedConfectioners, setSelectedConfectioners] = useState<string[]>([]);
  const [onlyVeg, setOnlyVeg] = useState(false);
  const [onlyHit, setOnlyHit] = useState(false);
  const [paymentFilters, setPaymentFilters] = useState<PaymentFilterOption[]>([]);
  const [tasteFilters, setTasteFilters] = useState<string[]>(initialAiFilters?.tastes ?? []);
  const [minRating, setMinRating] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>("popular");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Реальный потолок цен каталога: сид содержит товары дороже 15000 ₽
  // (свадебный торт 18500 ₽) — жёсткий max прятал их из выдачи.
  const maxPrice = useMemo(
    () => Math.max(15000, ...products.map((p) => p.price || 0)),
    [products]
  );

  // Синхронизация верхней границы фильтра с реальным max: если пользователь
  // ещё не трогал цену (значение равно прежнему потолку) — поднимаем до нового.
  const lastMaxPriceRef = useRef(15000);
  useEffect(() => {
    const prevMax = lastMaxPriceRef.current;
    if (maxPrice !== prevMax) {
      // prevMax фиксируем в локальной переменной: updater React вызовется
      // позже, когда ref уже будет перезаписан
      setPriceRange(([lo, hi]) => (hi === prevMax ? [lo, maxPrice] : [lo, hi]));
      lastMaxPriceRef.current = maxPrice;
    }
  }, [maxPrice]);

  // AI-фильтры умного поиска: исключения (аллергены), порции, ключевые слова
  const [aiExclude, setAiExclude] = useState<string[]>(initialAiFilters?.exclude ?? []);
  const [aiServings, setAiServings] = useState<number>(initialAiFilters?.guests ?? 0);
  const [aiKeywords, setAiKeywords] = useState<string[]>(initialAiFilters?.keywords ?? []);

  // P2.1: повод, ограничения (аллергены), минимальные порции
  const [occasion, setOccasion] = useState<OccasionKey | null>(null);
  const [restrictions, setRestrictions] = useState<AllergenKey[]>([]);
  const [servingsMin, setServingsMin] = useState<number | null>(null);

  // P2.2: «Помочь выбрать» — анкета и переход с главной (nav.params.help)
  const [helpOpen, setHelpOpen] = useState(false);
  const initialHelp: HelpChooseAnswers | null = (() => {
    const raw = nav.params?.help;
    if (!raw) return null;
    try {
      return { ...emptyHelpAnswers(), ...(JSON.parse(raw) as HelpChooseAnswers) };
    } catch {
      return null;
    }
  })();

  const applyHelpAnswers = (a: HelpChooseAnswers) => {
    setOccasion(a.occasion ?? null);
    setRestrictions(a.excludeAllergens ?? []);
    setServingsMin(a.servingsMin ?? null);
    setTasteFilters(a.tastes ?? []);
    if (a.priceMax !== null) {
      setPriceRange(([lo]) => [lo, Math.min(a.priceMax as number, maxPrice)]);
    }
    setSearchQuery("");
  };

  useEffect(() => {
    // Переход с главной («Помочь выбрать» → «Показать в каталоге»):
    // применяем один раз при маунте, пока nav.params ещё содержат help
    if (initialHelp) applyHelpAnswers(initialHelp);
  }, []);

  // Режим сравнения (сценарий №2: сравнение выбранных тортов)
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const filtered = useMemo(() => {
    // P2.1: единый поисковый движок (морфология, «до N ₽», «на N человек»,
    // «без орехов») вместо наивного includes по title/description
    const intent = parseQueryIntent(searchQuery);
    if (occasion) intent.occasion = occasion;
    for (const r of restrictions) {
      if (!intent.excludeAllergens.includes(r)) intent.excludeAllergens.push(r);
    }
    if (servingsMin !== null && (intent.servingsMin ?? 0) < servingsMin) {
      intent.servingsMin = servingsMin;
    }
    if (priceRange[0] > 0) {
      intent.priceMin =
        intent.priceMin !== null ? Math.max(intent.priceMin, priceRange[0]) : priceRange[0];
    }
    if (priceRange[1] < maxPrice) {
      intent.priceMax =
        intent.priceMax !== null ? Math.min(intent.priceMax, priceRange[1]) : priceRange[1];
    }
    if (tasteFilters.length > 0) {
      for (const t of tasteFilters) {
        for (const w of t.split(/\s+/)) {
          const stem = wordStem(w);
          if (stem && !intent.tastes.includes(stem)) intent.tastes.push(stem);
        }
      }
    }
    // AI-фильтры умного поиска (сценарий №1) — через тот же движок
    if (aiServings > 0 && (intent.servingsMin ?? 0) < aiServings) {
      intent.servingsMin = aiServings;
    }
    for (const ex of aiExclude) {
      const stem = wordStem(ex);
      if (stem) intent.genericExcludes.push(stem);
    }
    if (aiKeywords.length > 0 && intent.tokens.length === 0) {
      intent.tokens.push(
        ...aiKeywords.map(wordStem).filter((s): s is string => Boolean(s))
      );
    }

    const docs = products.map(toSearchDoc);
    const rankSort: RankOptions["sort"] =
      sortBy === "price-asc" || sortBy === "price-desc" || sortBy === "rating"
        ? sortBy
        : "popular";
    const { items } = filterAndRank(docs, intent, { sort: rankSort });
    const byId = new Map(products.map((p) => [p.id, p]));
    let result = items
      .map((d) => byId.get(d.id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    if (activeCategory !== "all") {
      result = result.filter((p) => p.category === activeCategory);
    }
    if (selectedConfectioners.length > 0) {
      result = result.filter((p) =>
        selectedConfectioners.includes(p.confectionerId)
      );
    }
    if (onlyHit) result = result.filter((p) => p.isHit || p.isPopular);
    if (minRating > 0) result = result.filter((p) => p.rating >= minRating);
    // Фильтр по способу оплаты
    if (paymentFilters.length > 0) {
      result = result.filter((p) => {
        const confectioner = confectioners.find((c) => c.id === p.confectionerId);
        return paymentFilters.every((opt) => productMatchesPaymentFilter(p, confectioner, opt));
      });
    }
    return result;
  }, [products, searchQuery, activeCategory, priceRange, selectedConfectioners, onlyHit, paymentFilters, tasteFilters, minRating, confectioners, sortBy, aiServings, aiKeywords, aiExclude, maxPrice, occasion, restrictions, servingsMin]);

  // Честные счётчики чипов: считаются по реальным данным каталога
  // (чип с нулём не скрывается — показывается приглушённым)
  const occasionCounts = useMemo(() => {
    const counts = {} as Record<OccasionKey, number>;
    (Object.keys(OCCASIONS) as OccasionKey[]).forEach((k) => {
      counts[k] = products.filter((p) => matchesOccasion(toSearchDoc(p), k)).length;
    });
    return counts;
  }, [products]);

  const restrictionCounts = useMemo(() => {
    const counts = {} as Record<AllergenKey, number>;
    (Object.keys(ALLERGEN_GROUPS) as AllergenKey[]).forEach((k) => {
      counts[k] = products.filter((p) => passesAllergen(toSearchDoc(p), k)).length;
    });
    return counts;
  }, [products]);

  const toggleRestriction = (key: AllergenKey) => {
    setRestrictions((prev) =>
      prev.includes(key) ? prev.filter((r) => r !== key) : [...prev, key]
    );
  };

  const resetAdvancedFilters = () => {
    setOccasion(null);
    setRestrictions([]);
    setServingsMin(null);
  };

  // Применение фильтров из умного поиска (вариант="compact") к локальному состоянию каталога
  const applyAiFilters = (f: AiSearchFilters) => {
    if (f.category) setActiveCategory(f.category);
    if (f.budget !== null && f.budget > 0) setPriceRange([0, Math.min(f.budget, maxPrice)]);
    setAiServings(f.guests ?? 0);
    setAiExclude(f.exclude);
    setAiKeywords(f.keywords);
    setTasteFilters(f.tastes);
    setSearchQuery(f.keywords.length === 1 ? f.keywords[0] : "");
    toast.success(f.reply || "Фильтры ИИ применены к каталогу");
  };

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        toast.error("Можно сравнить максимум 4 товара");
        return prev;
      }
      return [...prev, id];
    });
  };

  const compareProducts = products.filter((p) => compareIds.includes(p.id));

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
            max={maxPrice}
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

      {/* Повод (P2 §4) — только реальные слова каталога, счётчики из БД */}
      <div>
        <h4 className="font-medium text-sm mb-3">Повод</h4>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(OCCASIONS) as OccasionKey[]).map((key) => {
            const count = occasionCounts[key] ?? 0;
            return (
              <button
                key={key}
                onClick={() => setOccasion(occasion === key ? null : key)}
                aria-pressed={occasion === key}
                disabled={count === 0}
                title={count === 0 ? "В каталоге пока нет товаров с таким поводом" : undefined}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  occasion === key
                    ? "bg-primary text-primary-foreground border-primary"
                    : count === 0
                      ? "border-border opacity-50 cursor-not-allowed"
                      : "border-border hover:border-primary/40"
                }`}
              >
                {OCCASIONS[key].label}
                <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Порции (P2 §4 «Размер»: порции) — честный фильтр по известным данным */}
      <div>
        <h4 className="font-medium text-sm mb-3">Порции</h4>
        <div className="flex flex-wrap gap-1">
          {[0, 2, 10, 15, 20, 30].map((n) => (
            <button
              key={n}
              onClick={() => setServingsMin(n === 0 ? null : n)}
              aria-pressed={servingsMin === (n === 0 ? null : n)}
              className={`px-2 py-1 text-xs rounded-full border ${
                servingsMin === (n === 0 ? null : n)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/40"
              }`}
            >
              {n === 0 ? "Любые" : `${n}+ чел.`}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Товары с меньшим известным числом порций скрываются; без данных — остаются.
        </p>
      </div>

      {/* Ограничения (P2 §4) — из dietary_features/composition, не фиктивные */}
      <div>
        <h4 className="font-medium text-sm mb-3">Ограничения</h4>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(ALLERGEN_GROUPS) as AllergenKey[]).map((key) => {
            const count = restrictionCounts[key] ?? 0;
            return (
              <button
                key={key}
                onClick={() => toggleRestriction(key)}
                aria-pressed={restrictions.includes(key)}
                disabled={count === 0}
                className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                  restrictions.includes(key)
                    ? "bg-primary text-primary-foreground border-primary"
                    : count === 0
                      ? "border-border opacity-50 cursor-not-allowed"
                      : "border-border hover:border-primary/40"
                }`}
              >
                {ALLERGEN_GROUPS[key].label}
                <span className="ml-1 opacity-70">({count})</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          По данным карточек: «содержит орехи» скрывает товар, пометка «без сахара» — оставляет.
        </p>
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
          setPriceRange([0, maxPrice]);
          setSelectedConfectioners([]);
          setOnlyHit(false);
          setPaymentFilters([]);
          setTasteFilters([]);
          setMinRating(0);
          setSortBy("popular");
          setAiExclude([]);
          setAiKeywords([]);
          setAiServings(0);
          resetAdvancedFilters();
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

      {/* Search bar — P2 §20: на мобильном поиск сверху на всю ширину,
          сортировка и фильтры — второй строкой */}
      <div className="flex flex-wrap gap-2 mb-6">
        <div className="relative w-full sm:w-auto sm:flex-1">
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
          <SelectTrigger className="flex-1 min-w-0 sm:flex-none sm:w-44 shrink-0">
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

      {/* P2 §20: мобильные быстрые фильтры — горизонтальная лента под поиском,
          первая — доступная кнопка «Помочь выбрать» */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-1 mb-4 lg:hidden"
        role="toolbar"
        aria-label="Быстрые фильтры"
      >
        <button
          onClick={() => setHelpOpen(true)}
          className="shrink-0 px-3 py-1.5 text-xs rounded-full border bg-primary text-primary-foreground border-primary"
        >
          ✨ Помочь выбрать
        </button>
        {(Object.keys(OCCASIONS) as OccasionKey[]).map((key) => {
          const count = occasionCounts[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => setOccasion(occasion === key ? null : key)}
              aria-pressed={occasion === key}
              disabled={count === 0}
              className={`shrink-0 px-3 py-1.5 text-xs rounded-full border ${
                occasion === key
                  ? "bg-primary text-primary-foreground border-primary"
                  : count === 0
                    ? "border-border opacity-50"
                    : "border-border bg-background"
              }`}
            >
              {OCCASIONS[key].label}
            </button>
          );
        })}
        {(["nuts", "gluten", "sugar"] as AllergenKey[]).map((key) => (
          <button
            key={key}
            onClick={() => toggleRestriction(key)}
            aria-pressed={restrictions.includes(key)}
            className={`shrink-0 px-3 py-1.5 text-xs rounded-full border ${
              restrictions.includes(key)
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border bg-background"
            }`}
          >
            {ALLERGEN_GROUPS[key].label}
          </button>
        ))}
      </div>

      {/* P2 §5: «Помочь выбрать» — рядом с уточнением через ИИ; обычный путь не спрятан */}
      <Card className="p-3 mb-4 border-purple-200 dark:border-purple-900">
        <div className="flex flex-col sm:flex-row items-stretch gap-2">
          <div className="flex-1 min-w-0">
            <AiSmartSearch variant="compact" onApplyFilters={applyAiFilters} />
          </div>
          <Button
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={() => setHelpOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
            Помочь выбрать
          </Button>
        </div>
      </Card>

      {/* Режим сравнения (сценарий №2) */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button
          variant={compareMode ? "default" : "outline"}
          size="sm"
          onClick={() => setCompareMode(!compareMode)}
          className="gap-1.5"
          aria-pressed={compareMode}
        >
          <Scale className="h-3.5 w-3.5" />
          Сравнить товары
        </Button>
        {compareMode && (
          <>
            <span className="text-xs text-muted-foreground">
              Отметьте до 4 товаров — ИИ сравнит их по данным карточек
            </span>
            <Button
              size="sm"
              disabled={compareIds.length < 2}
              onClick={() => setCompareOpen(true)}
              className="gap-1.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              Сравнить ({compareIds.length})
            </Button>
            {compareIds.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setCompareIds([])}>
                Очистить
              </Button>
            )}
          </>
        )}
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
                  setPriceRange([0, maxPrice]);
                  setSelectedConfectioners([]);
                  setOnlyHit(false);
                  setPaymentFilters([]);
                  setAiExclude([]);
                  setAiKeywords([]);
                  setAiServings(0);
                  resetAdvancedFilters();
                }}
              >
                Сбросить всё
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((p) =>
                compareMode ? (
                  <div key={p.id} className="relative">
                    <ProductCard product={p} />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCompare(p.id);
                      }}
                      aria-label={
                        compareIds.includes(p.id)
                          ? "Убрать из сравнения"
                          : "Добавить к сравнению"
                      }
                      className={`absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold shadow-sm transition-colors ${
                        compareIds.includes(p.id)
                          ? "bg-purple-600 text-white border-purple-600"
                          : "bg-background/95 text-foreground border-border hover:border-purple-400"
                      }`}
                    >
                      {compareIds.includes(p.id) ? "✓" : "+"}
                    </button>
                  </div>
                ) : (
                  <ProductCard key={p.id} product={p} />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Диалог ИИ-сравнения (сценарий №2) */}
      <AiCompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        products={compareProducts}
        onRemove={(id) => setCompareIds((prev) => prev.filter((x) => x !== id))}
      />

      {/* P2.2: анкета «Помочь выбрать» — тот же движок, без AI */}
      <HelpChooseDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        onShowInCatalog={applyHelpAnswers}
      />
    </div>
  );
}
