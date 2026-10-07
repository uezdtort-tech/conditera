"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductCard } from "@/components/marketplace/product-card";
import { CrossSellBlock } from "@/components/marketplace/cross-sell-block";
import { ProductMediaGallery } from "@/components/products/product-media-gallery";
import { VideoReviewsSection } from "@/components/dashboard/customer-features-tabs";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { AiAskProduct } from "@/components/ai/ai-ask-product";
import { StickyAddToCart, addRecentlyViewed } from "@/components/ui/enhanced-components";
import { ARViewer } from "@/components/marketplace/ar-viewer";
import { ProductSliceGallery, FillingSlicePreview } from "@/components/cake-slice/cake-slice-visualizer";
import {
  Star,
  Heart,
  ShoppingCart,
  Share2,
  Check,
  Clock,
  Users,
  Weight,
  MessageCircle,
  ChevronLeft,
  Plus,
  Minus,
  ShieldCheck,
  Truck,
  Calendar,
  CreditCard,
  Info,
  AlertCircle,
  Cake,
  CakeSlice,
  Scale,
  Ruler,
  MoveVertical,
  Maximize2,
  Shapes,
  Layers,
  ClipboardList,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  formatCurrency,
  calculateDelivery,
  TRUST_LEVELS,
  getProductPaymentOptions,
  calculateInstallmentPayment,
  INSTALLMENT_PROVIDERS,
} from "@/lib/finance";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useLiveProductDetail } from "@/lib/supabase/use-marketplace";
import type { Review } from "@/lib/types";

// ==== Хелперы структурированных полей карточки (миграция 0052) ====

// product.weight приходит строкой («2200 г» с маппера API) — достаём граммы
function parseWeightGrams(weight?: string): number | null {
  if (!weight) return null;
  const s = weight.replace(",", ".").toLowerCase();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return s.includes("кг") ? Math.round(n * 1000) : Math.round(n);
}

function formatWeightLabel(grams: number): string {
  if (grams >= 1000) {
    const kg = Math.round((grams / 1000) * 10) / 10;
    return `${kg.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} кг`;
  }
  return `${grams} г`;
}

function formatCmValue(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const cm = Math.round(Number(value) * 10) / 10;
  return `${cm.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} см`;
}

function formatProductionTime(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return `от ${hours / 24} дн.`;
  return hours >= 24
    ? `от ${hours} ч (≈ ${Math.round(hours / 24)} дн.)`
    : `от ${hours} ч`;
}

// ==== Отзывы карточки (live-данные GET /api/products/[id]) ====

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "П";
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function formatReviewDate(iso: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * ProductReviewsList — список реальных отзывов товара (approved, из БД).
 * Маппер отзыва защищает от отсутствующих полей, здесь — только рендер.
 */
function ProductReviewsList({ reviews }: { reviews: Review[] }) {
  return (
    <div className="space-y-5">
      {reviews.map((review, i) => {
        const dateLabel = formatReviewDate(review.date);
        return (
          <div key={review.id || `review-${i}`} className="flex gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              {review.avatar && (
                <AvatarImage src={review.avatar} alt={review.author} />
              )}
              <AvatarFallback>{initialsOf(review.author)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium">{review.author}</span>
                <span
                  className="flex items-center gap-0.5"
                  aria-label={`Оценка ${review.rating} из 5`}
                >
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star
                      key={s}
                      className={`h-3.5 w-3.5 ${
                        s < review.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-border"
                      }`}
                    />
                  ))}
                </span>
                {dateLabel && (
                  <span className="text-xs text-muted-foreground">{dateLabel}</span>
                )}
              </div>
              {review.text && (
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {review.text}
                </p>
              )}
              {(review.photos?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {review.photos!.map((src) => (
                    <img
                      key={src}
                      src={src}
                      alt={`Фото покупателя: ${review.author}`}
                      className="h-16 w-16 rounded-md border object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProductPage() {
  const nav = useAppStore((s) => s.nav);
  const products = useAppStore((s) => s.products);
  const confectioners = useAppStore((s) => s.confectioners);
  const addToCart = useAppStore((s) => s.addToCart);
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const isFavorite = useAppStore((s) => s.favorites.includes(nav.params?.id || ""));
  const navigate = useAppStore((s) => s.navigate);
  const setChatOpen = useAppStore((s) => s.setChatOpen);

  const productId = nav.params?.id;
  const storeProduct = products.find((p) => p.id === productId);

  // Deep-link (/product?id=...) — store ещё не гидрирован → догружаем карточку
  // напрямую через GET /api/products/[id] (см. useLiveProductDetail).
  // Detail всегда догружается: только он содержит approved-медиа (media[]) и
  // актуальные поля карточки — store-версия (список) служит мгновенным каркасом.
  const detail = useLiveProductDetail(productId);
  const product = detail.data?.product || storeProduct || undefined;
  // Отзывы только из live-детализации (approved + имена авторов из БД);
  // store-версия отзывов не содержит — при недогрузке показываем прежнюю
  // заглушку/пустое состояние.
  const liveReviews = detail.data?.reviews ?? [];

  const [quantity, setQuantity] = useState(1);
  const [selectedFilling, setSelectedFilling] = useState(0);
  const [selectedCoating, setSelectedCoating] = useState(0);
  const [selectedDecoration, setSelectedDecoration] = useState(0);
  const [inscription, setInscription] = useState("");

  useEffect(() => {
    if (product) {
      addRecentlyViewed(product.id);
    }
  }, [product?.id]);

  // Минимальный заказ (0052) — держим количество в рамках правила товара
  useEffect(() => {
    const min =
      product?.minOrderQty && product.minOrderQty > 1 ? product.minOrderQty : 1;
    setQuantity(min);
  }, [product?.id]);

  // П.24: Schema.org Product — для попадания в Google Shopping и рейтинга в сниппете
  useEffect(() => {
    if (!product) return;
    const APP_URL = window.location.origin;
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      description: product.description || `${product.title} — заказывайте у частного кондитера на «Уездном кондитере».`,
      image: product.images?.[0]?.startsWith("http")
        ? product.images[0]
        : `${APP_URL}${product.images?.[0] || "/logo.png"}`,
      category: product.category,
      sku: product.id,
      brand: {
        "@type": "Brand",
        name: confectioner?.businessName || "Кондитера",
      },
      offers: {
        "@type": "Offer",
        url: `${APP_URL}/catalog?product=${product.id}`,
        priceCurrency: "RUB",
        price: product.price +
          (product.fillings?.[selectedFilling]?.priceModifier || 0) +
          (product.coatings?.[selectedCoating]?.priceModifier || 0) +
          (product.decorations?.[selectedDecoration]?.priceModifier || 0),
        availability: `https://schema.org/${product.inStock !== false ? "InStock" : "OutOfStock"}`,
        itemCondition: "https://schema.org/NewCondition",
        seller: {
          "@type": "Organization",
          name: confectioner?.businessName || "Кондитера",
        },
      },
      ...(product.rating && product.reviewsCount
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: product.rating,
              reviewCount: product.reviewsCount,
              bestRating: 5,
              worstRating: 1,
            },
          }
        : {}),
    };
    // BreadcrumbList
    const breadcrumbLd = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Главная", item: APP_URL },
        { "@type": "ListItem", position: 2, name: "Каталог", item: `${APP_URL}/catalog` },
        { "@type": "ListItem", position: 3, name: product.title, item: `${APP_URL}/catalog?product=${product.id}` },
      ],
    };

    const script1 = document.createElement("script");
    script1.type = "application/ld+json";
    script1.text = JSON.stringify(jsonLd).replace(/</g, "\\u003c");
    script1.dataset.dynamicJsonLd = "product";
    const script2 = document.createElement("script");
    script2.type = "application/ld+json";
    script2.text = JSON.stringify(breadcrumbLd).replace(/</g, "\\u003c");
    script2.dataset.dynamicJsonLd = "breadcrumb";

    document.head.appendChild(script1);
    document.head.appendChild(script2);

    return () => {
      script1.remove();
      script2.remove();
    };
  }, [product?.id, product?.price, selectedFilling, selectedCoating, selectedDecoration]);

  if (!product && detail.isFetching) {
    // Гидрация/догрузка карточки — скелет вместо ложного «Товар не найден»
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-80 bg-muted rounded" />
          <div className="h-64 w-full bg-muted rounded" />
          <div className="h-4 w-96 bg-muted/70 rounded" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h2 className="font-display text-2xl font-bold mb-2">Товар не найден</h2>
        <Button onClick={() => navigate("catalog")}>В каталог</Button>
      </div>
    );
  }

  const confectioner = confectioners.find((c) => c.id === product.confectionerId);
  const similarProducts = products
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  const filling = product.fillings?.[selectedFilling];
  const coating = product.coatings?.[selectedCoating];
  const decoration = product.decorations?.[selectedDecoration];

  const finalPrice =
    product.price +
    (filling?.priceModifier || 0) +
    (coating?.priceModifier || 0) +
    (decoration?.priceModifier || 0);
  const deliveryCost = calculateDelivery(finalPrice).cost;

  // ==== Структурированные секции карточки (миграция 0052) ====
  const unavailable = product.isAvailable === false;
  const minOrderQty =
    product.minOrderQty && product.minOrderQty > 1 ? product.minOrderQty : 1;

  // Характеристики: только заполненные поля
  const weightGrams = parseWeightGrams(product.weight);
  const diameterLabel = formatCmValue(product.diameterCm);
  const heightLabel = formatCmValue(product.heightCm);
  const specs: { icon: LucideIcon; label: string; value: string }[] = [];
  if (weightGrams != null)
    specs.push({ icon: Scale, label: "Вес", value: formatWeightLabel(weightGrams) });
  if (diameterLabel)
    specs.push({ icon: Ruler, label: "Диаметр", value: diameterLabel });
  if (heightLabel)
    specs.push({ icon: MoveVertical, label: "Высота", value: heightLabel });
  if (product.sizeText)
    specs.push({ icon: Maximize2, label: "Размер", value: product.sizeText });
  if (product.shape)
    specs.push({ icon: Shapes, label: "Форма", value: product.shape });
  if (product.productType)
    specs.push({ icon: CakeSlice, label: "Тип изделия", value: product.productType });
  if (product.servings != null)
    specs.push({ icon: Users, label: "Порции", value: `${product.servings} шт.` });

  // Начинка: описание + слои + названия начинок из product.fillings
  const hasFillingInfo = Boolean(
    product.fillingDescription ||
      product.layersCount != null ||
      (product.fillings && product.fillings.length > 0)
  );

  // Заказ и производство
  const productionTime =
    product.productionTimeHours != null && product.productionTimeHours > 0
      ? product.productionTimeHours
      : null;
  const hasOrderInfo = Boolean(
    (product.minOrderQty != null && product.minOrderQty > 1) ||
      productionTime != null ||
      product.customOrderAvailable === true ||
      unavailable
  );

  const handleAddToCart = () => {
    if (product.isAvailable === false) {
      toast.error("Товар временно недоступен", {
        description:
          "Добавление в корзину недоступно — напишите кондитеру, чтобы уточнить сроки.",
      });
      return;
    }
    addToCart(
      product,
      {
        filling: filling?.name,
        coating: coating?.name,
        decoration: decoration?.name,
        inscription: inscription || undefined,
      },
      quantity
    );
    toast.success("Добавлено в корзину", {
      description: `${product.title} × ${quantity}`,
    });
  };

  // pay4: фейковые отзывы (pravatar + выдуманные тексты) удалены —
  // показываем только реальные счётчики из БД и честное пустое состояние

  return (
    <div className="container mx-auto px-4 py-6 lg:py-10">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: "Каталог", view: "catalog" },
          { label: product.category === "cakes" ? "Торты" : product.category, view: "catalog", params: { category: product.category } },
          { label: product.title },
        ]}
      />

      {/* Sticky add to cart */}
      <StickyAddToCart product={product} finalPrice={finalPrice} onAddToCart={handleAddToCart} />

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Галерея (approved-медиа 0052 + legacy-фото) / 3D-AR превью */}
        <div className="space-y-3 min-w-0">
          {product.modelUrl && product.arEnabled ? (
            <>
              <div className="aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-purple-50 via-pink-50 to-amber-50 dark:from-purple-950/40 dark:via-pink-950/40 dark:to-amber-950/40">
                <ARViewer
                  modelUrl={product.modelUrl}
                  modelUsdzUrl={product.modelUsdzUrl}
                  posterImage={product.images[0]}
                  productName={product.title}
                  arEnabled={product.arEnabled}
                />
              </div>
              {product.images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {product.images.map((img, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer border-2 border-transparent hover:border-primary"
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <ProductMediaGallery
              media={product.media}
              images={product.images}
              title={product.title}
            />
          )}
          {product.modelUrl && product.arEnabled && (
            <div className="text-center text-xs text-muted-foreground bg-purple-50 dark:bg-purple-950/30 rounded-lg py-2 px-3">
              <strong className="text-purple-700 dark:text-purple-300">3D / AR превью</strong> — уникальная функция «Уездного кондитера».
              Покрутите модель, чтобы рассмотреть торт со всех сторон.
              На Android/iOS нажмите «Посмотреть в AR», чтобы разместить торт в реальном пространстве.
            </div>
          )}
        </div>

        {/* Info */}
        <div className="space-y-5 min-w-0">
          <div className="flex flex-wrap gap-2">
            {product.isHit && (
              <Badge className="bg-primary text-primary-foreground">Хит продаж</Badge>
            )}
            {product.isNew && (
              <Badge className="bg-emerald-600 text-white">Новинка</Badge>
            )}
            {product.isPopular && (
              <Badge className="bg-amber-500 text-white">Популярное</Badge>
            )}
            {product.oldPrice && (
              <Badge className="bg-red-500 text-white">
                -{Math.round((1 - product.price / product.oldPrice) * 100)}%
              </Badge>
            )}
            {unavailable && (
              <Badge className="bg-amber-500 text-white">
                Временно недоступен
              </Badge>
            )}
          </div>

          <div>
            <h1 className="font-display text-2xl lg:text-3xl font-bold mb-2">
              {product.title}
            </h1>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-medium">{product.rating.toFixed(1)}</span>
                <span className="text-muted-foreground">
                  ({product.reviewsCount} отзывов)
                </span>
              </div>
              {product.prepTime && (
                <>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-muted-foreground">
                    {product.prepTime} готовка
                  </span>
                </>
              )}
            </div>
          </div>

          <p className="text-muted-foreground leading-relaxed">{product.description}</p>

          {/* Состав продукта */}
          {product.composition && ((product.composition.ingredients?.length ?? 0) > 0 || (product.composition.allergens?.length ?? 0) > 0) && (
            <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
              {product.composition.ingredients.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-1 flex items-center gap-1">
                    <Info className="h-4 w-4 text-primary" /> Состав
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {product.composition.ingredients.map((ing, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{ing}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {product.composition.allergens.length > 0 && (
                <div>
                  <div className="text-sm font-semibold mb-1 flex items-center gap-1 text-red-600">
                    <AlertCircle className="h-4 w-4" /> Аллергены
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {product.composition.allergens.map((a, i) => (
                      <Badge key={i} className="text-xs bg-red-100 text-red-700">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {product.composition.nutritionalValue && (product.composition.nutritionalValue.calories || product.composition.nutritionalValue.protein) && (
                <div className="flex gap-4 text-xs">
                  {product.composition.nutritionalValue.calories && <span>🔥 {product.composition.nutritionalValue.calories} ккал</span>}
                  {product.composition.nutritionalValue.protein && <span>🥩 Б: {product.composition.nutritionalValue.protein}г</span>}
                  {product.composition.nutritionalValue.fat && <span>🧈 Ж: {product.composition.nutritionalValue.fat}г</span>}
                  {product.composition.nutritionalValue.carbs && <span>🍞 У: {product.composition.nutritionalValue.carbs}г</span>}
                </div>
              )}
              {product.composition.storageConditions && (
                <div className="text-xs text-muted-foreground">📦 {product.composition.storageConditions}</div>
              )}
              {product.composition.shelfLife && (
                <div className="text-xs text-muted-foreground">⏰ Срок годности: {product.composition.shelfLife}</div>
              )}
            </div>
          )}

          {/* Характеристики (0052) — только заполненные поля */}
          {specs.length > 0 && (
            <Card className="card-hover p-4">
              <h3 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
                <Ruler className="h-4 w-4 text-primary" />
                Характеристики
              </h3>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                {specs.map((spec) => (
                  <div
                    key={spec.label}
                    className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5"
                  >
                    <dt className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <spec.icon className="h-3.5 w-3.5" aria-hidden />
                      {spec.label}
                    </dt>
                    <dd className="text-right font-medium">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {/* Начинка (0052): описание, слои, названия начинок */}
          {hasFillingInfo && (
            <Card className="card-hover p-4">
              <h3 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                Начинка
              </h3>
              <div className="space-y-2.5 text-sm">
                {product.fillingDescription && (
                  <p className="text-muted-foreground leading-relaxed">
                    {product.fillingDescription}
                  </p>
                )}
                {product.layersCount != null && (
                  <div className="flex items-center gap-1.5">
                    <CakeSlice className="h-4 w-4 text-primary/70" aria-hidden />
                    <span>
                      Количество слоёв: <span className="font-medium">{product.layersCount}</span>
                    </span>
                  </div>
                )}
                {product.fillings && product.fillings.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {product.fillings.map((f, i) => (
                      <Badge key={`${f.name}-${i}`} variant="outline" className="text-xs">
                        {f.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Помочь выбрать — ИИ отвечает по данным карточки (сценарий №2) */}
          <AiAskProduct productId={product.id} product={product} />

          {/* Meta */}
          <div className="grid grid-cols-3 gap-3">
            {product.weight && (
              <Card className="p-3 text-center">
                <Weight className="h-5 w-5 mx-auto mb-1 text-primary" />
                <div className="text-sm font-medium">{product.weight}</div>
                <div className="text-xs text-muted-foreground">вес</div>
              </Card>
            )}
            {product.servings && (
              <Card className="p-3 text-center">
                <Users className="h-5 w-5 mx-auto mb-1 text-primary" />
                <div className="text-sm font-medium">{product.servings}</div>
                <div className="text-xs text-muted-foreground">порций</div>
              </Card>
            )}
            {product.prepTime && (
              <Card className="p-3 text-center">
                <Clock className="h-5 w-5 mx-auto mb-1 text-primary" />
                <div className="text-sm font-medium">{product.prepTime}</div>
                <div className="text-xs text-muted-foreground">срок</div>
              </Card>
            )}
          </div>

          {/* Confectioner */}
          {confectioner && (
            <Card
              className="p-4 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate("confectioner-profile", { id: confectioner.id })}
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
                  <AvatarFallback>{confectioner.businessName.slice(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold truncate">{confectioner.businessName}</span>
                    {confectioner.verified && (
                      <Check className="h-4 w-4 text-primary fill-primary/20" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 min-w-0">
                    <span className="truncate">{confectioner.city}</span>
                    <span>•</span>
                    <span>⭐ {confectioner.rating.toFixed(1)}</span>
                    <span>•</span>
                    <span>{confectioner.responseTime}</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatOpen(true);
                  }}
                >
                  <MessageCircle className="h-4 w-4 mr-1" />
                  Чат
                </Button>
              </div>
            </Card>
          )}

          <Separator />

          {/* Customization */}
          {product.fillings && product.fillings.length > 0 && (
            <div className="space-y-4">
              <div>
                <Label className="font-medium flex items-center gap-2">
                  Начинка
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                    срез торта
                  </Badge>
                </Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {product.fillings.map((f, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedFilling(i)}
                      className={`text-left p-2 rounded-lg border text-sm transition-colors flex gap-2 ${
                        selectedFilling === i
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40"
                      }`}
                    >
                      <FillingSlicePreview fillingName={f.name} size={48} />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{f.name}</div>
                        {f.priceModifier > 0 && (
                          <div className="text-xs text-muted-foreground">
                            +{formatCurrency(f.priceModifier)}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {product.coatings && (
                <div>
                  <Label className="font-medium">Покрытие</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {product.coatings.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedCoating(i)}
                        className={`text-left p-2 rounded-lg border text-sm transition-colors ${
                          selectedCoating === i
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className="font-medium">{c.name}</div>
                        {c.priceModifier > 0 && (
                          <div className="text-xs text-muted-foreground">
                            +{formatCurrency(c.priceModifier)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {product.decorations && (
                <div>
                  <Label className="font-medium">Декор</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {product.decorations.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedDecoration(i)}
                        className={`text-left p-2 rounded-lg border text-sm transition-colors ${
                          selectedDecoration === i
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className="font-medium">{d.name}</div>
                        {d.priceModifier > 0 && (
                          <div className="text-xs text-muted-foreground">
                            +{formatCurrency(d.priceModifier)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <Label className="font-medium">Надпись на торте (опционально)</Label>
                <Textarea
                  value={inscription}
                  onChange={(e) => setInscription(e.target.value)}
                  placeholder="С днём рождения!"
                  maxLength={50}
                  className="mt-2"
                  rows={2}
                />
              </div>
            </div>
          )}

          {/* Заказ и производство (0052) */}
          {hasOrderInfo && (
            <Card className="card-hover p-4">
              <h3 className="font-display text-sm font-semibold mb-3 flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                Заказ и производство
              </h3>
              <div className="space-y-2.5 text-sm">
                {product.minOrderQty != null && product.minOrderQty > 1 && (
                  <div className="flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-primary/70" aria-hidden />
                    <span>
                      Минимальный заказ — <span className="font-medium">от {product.minOrderQty} шт.</span>
                    </span>
                  </div>
                )}
                {productionTime != null && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary/70" aria-hidden />
                    <span>
                      Изготовление — <span className="font-medium">{formatProductionTime(productionTime)}</span>
                    </span>
                  </div>
                )}
                {(product.customOrderAvailable === true || unavailable) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {product.customOrderAvailable === true && (
                      <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary">
                        Индивидуальный заказ
                      </Badge>
                    )}
                    {unavailable && (
                      <Badge className="border border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                        Временно недоступен
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Quantity & price */}
          <Card className="p-4 bg-primary/5 border-primary/20">
            <div className="flex items-center justify-between mb-3">
              <Label className="font-medium">Количество</Label>
              <div className="flex items-center gap-2 border border-border rounded-md bg-background">
                <button
                  onClick={() => setQuantity(Math.max(minOrderQty, quantity - 1))}
                  className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-l-md"
                  aria-label="Уменьшить количество"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="font-medium w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-r-md"
                  aria-label="Увеличить количество"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Итого:</div>
                <div className="font-display text-2xl font-bold text-primary">
                  {formatCurrency(finalPrice * quantity)}
                </div>
                {product.oldPrice && (
                  <div className="text-xs text-muted-foreground line-through">
                    {formatCurrency((product.oldPrice + (finalPrice - product.price)) * quantity)}
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div className="flex items-center gap-1 justify-end">
                  <Truck className="h-3 w-3" />
                  {deliveryCost === 0 ? "Бесплатно" : formatCurrency(deliveryCost)}
                </div>
                <div>от {formatCurrency(3000)} — бесплатно</div>
              </div>
            </div>
          </Card>

          {/* Actions */}
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Button
                size="lg"
                onClick={handleAddToCart}
                disabled={unavailable}
                aria-disabled={unavailable}
                className="flex-1 bg-primary"
              >
                <ShoppingCart className="h-5 w-5 mr-2" />
                В корзину
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => toggleFavorite(product.id)}
                className={isFavorite ? "border-primary text-primary" : ""}
                aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
              >
                <Heart className={`h-5 w-5 ${isFavorite ? "fill-primary" : ""}`} />
              </Button>
              <Button size="lg" variant="outline" aria-label="Поделиться">
                <Share2 className="h-5 w-5" />
              </Button>
            </div>
            {unavailable && (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                Товар временно недоступен для заказа — напишите кондитеру, чтобы уточнить сроки.
              </p>
            )}
          </div>

          {/* Trust */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Эскроу 24ч
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Check className="h-4 w-4 text-primary" />
              Верификация
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Truck className="h-4 w-4 text-blue-600" />
              Доставка
            </div>
          </div>

          {/* Payment & Installment options */}
          {(() => {
            const opts = getProductPaymentOptions(product, confectioner);
            return (
              <Card className="p-4 bg-gradient-to-br from-rose-50/50 to-amber-50/30 border-rose-200">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  Способы оплаты
                </h3>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {opts.card && (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
                      💳 Картой
                    </Badge>
                  )}
                  {opts.sbp && (
                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 text-[10px]">
                      ⚡ СБП
                    </Badge>
                  )}
                  {opts.cash && (
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                      💵 Наличными
                    </Badge>
                  )}
                  {opts.split && (
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
                      🔀 Сплит
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">
                    🛡️ Эскроу
                  </Badge>
                </div>

                {/* Installment plans */}
                {opts.installment && opts.installments.length > 0 && (
                  <div className="pt-3 border-t border-rose-200">
                    <div className="text-xs font-semibold text-rose-800 mb-2 flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Доступна рассрочка от {confectioner?.businessName}
                    </div>
                    <div className="space-y-2">
                      {opts.installments.map((plan) => {
                        const calc = calculateInstallmentPayment(finalPrice, plan);
                        const provider = INSTALLMENT_PROVIDERS[plan.provider];
                        return (
                          <div
                            key={plan.id}
                            className="p-2.5 bg-card border border-rose-200 rounded-lg text-xs"
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-base">{provider?.icon || "📅"}</span>
                                <div>
                                  <div className="font-semibold text-sm">{plan.name}</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {provider?.label}
                                  </div>
                                </div>
                              </div>
                              {plan.interestRate === 0 ? (
                                <Badge className="bg-emerald-500 text-white text-[10px]">
                                  0% переплаты
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px]">
                                  +{plan.interestRate}% переплата
                                </Badge>
                              )}
                            </div>
                            {plan.description && (
                              <p className="text-[10px] text-muted-foreground mb-2">
                                {plan.description}
                              </p>
                            )}
                            <div className="grid grid-cols-3 gap-2 text-[10px]">
                              {calc.downPayment > 0 && (
                                <div>
                                  <div className="text-muted-foreground">Первый взнос</div>
                                  <div className="font-semibold">{formatCurrency(calc.downPayment)}</div>
                                  <div className="text-muted-foreground">({plan.downPaymentPercent}%)</div>
                                </div>
                              )}
                              <div>
                                <div className="text-muted-foreground">Ежемесячно</div>
                                <div className="font-semibold text-primary">{formatCurrency(calc.monthlyPayment)}</div>
                                <div className="text-muted-foreground">{plan.months} мес</div>
                              </div>
                              <div>
                                <div className="text-muted-foreground">Всего</div>
                                <div className="font-semibold">{formatCurrency(calc.totalToPay)}</div>
                                {calc.overpayment > 0 && (
                                  <div className="text-muted-foreground">+{formatCurrency(calc.overpayment)}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
            );
          })()}
        </div>
      </div>

      {/* Tabs: Reviews / Description / Delivery */}
      <Tabs defaultValue="reviews" className="mt-12">
        <TabsList>
          <TabsTrigger value="reviews">Отзывы ({product.reviewsCount})</TabsTrigger>
          <TabsTrigger value="description">Описание</TabsTrigger>
          <TabsTrigger value="delivery">Доставка и оплата</TabsTrigger>
        </TabsList>

        <TabsContent value="reviews" className="mt-6">
          {product.reviewsCount > 0 || liveReviews.length > 0 ? (
            <Card className="p-6 max-w-3xl">
              <div className="text-center">
                <div className="font-display text-4xl font-bold">
                  {product.rating.toFixed(1)}
                </div>
                <div className="flex justify-center gap-0.5 my-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-4 w-4 ${
                        i < Math.round(product.rating)
                          ? "fill-amber-400 text-amber-400"
                          : "text-border"
                      }`}
                    />
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">
                  На основе {product.reviewsCount}{" "}
                  {product.reviewsCount === 1
                    ? "отзыва"
                    : product.reviewsCount < 5
                      ? "отзывов"
                      : "отзывов"}
                </div>
              </div>
              <Separator className="my-4" />
              {/* pay4: распределение оценок раньше было захардкожено
                  (78/15/5/2%) — убрано до подключения реальной агрегации */}
              {liveReviews.length > 0 ? (
                // live-отзывы из GET /api/products/[id] (approved + профили)
                <ProductReviewsList reviews={liveReviews} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Подробные отзывы покупателей появятся здесь после подключения
                  публичного отображения отзывов.
                </p>
              )}
            </Card>
          ) : (
            <Card className="p-6 max-w-3xl text-center">
              <Cake className="h-10 w-10 text-muted-foreground/30 mx-auto" aria-hidden />
              <p className="text-sm text-muted-foreground mt-3">
                У этого товара пока нет отзывов.
              </p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="description" className="mt-6">
          <Card className="p-6 max-w-3xl">
            <h3 className="font-display font-semibold mb-3">Подробное описание</h3>
            <p className="text-muted-foreground leading-relaxed mb-4">
              {product.description}
            </p>
            {product.tags && (
              <div className="flex flex-wrap gap-2">
                {product.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    #{tag}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="delivery" className="mt-6">
          <Card className="p-6 max-w-3xl space-y-4">
            <div>
              <h3 className="font-display font-semibold mb-2 flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                Доставка
              </h3>
              <ul className="text-sm text-muted-foreground space-y-1 ml-7 list-disc">
                <li>По Москве — от 300 ₽, бесплатно при заказе от 3 000 ₽</li>
                <li>По России — СДЭК, Boxberry, рассчитывается при оформлении</li>
                <li>Самовывоз — бесплатно (адрес в карточке кондитера)</li>
                <li>Экспресс-доставка по Москве — 600 ₽ (3 часа)</li>
              </ul>
            </div>
            <Separator />
            <div>
              <h3 className="font-display font-semibold mb-2 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                Безопасная оплата
              </h3>
              <ul className="text-sm text-muted-foreground space-y-1 ml-7 list-disc">
                <li>Эскроу-счёт: средства холдируются 24 часа после доставки</li>
                <li>Принимаем: Visa, Mastercard, Мир, СБП</li>
                <li>Платёжный шлюз YooKassa</li>
                <li>Возврат средств при обоснованной претензии</li>
              </ul>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* === Срезы торта по начинкам (новый тренд) === */}
      {product.fillings && product.fillings.length > 0 && (
        <ProductSliceGallery
          productId={product.id}
          fillings={product.fillings}
        />
      )}

      {/* Cross-sell: bundles, decor, similar */}
      <CrossSellBlock product={product} />

      {/* Video reviews */}
      <VideoReviewsSection productId={product.id} />

      {/* Similar products */}
      {similarProducts.length > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-xl font-bold mb-4">Похожие товары</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {similarProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
