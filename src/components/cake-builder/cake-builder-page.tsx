"use client";

/**
 * CakeBuilderPage — полноценная страница конструктора тортов.
 *
 * Заменяет бывший модальный диалог на отдельную страницу /cake-builder
 * с двухколоночной раскладкой:
 *   • Левая колонка — шаги мастера (тип → событие → основа → начинка → ...)
 *   • Правая колонка (sticky) — живое резюме заказа с превью среза торта
 *
 * Модальные окна:
 *   • OptionDetailModal — просмотр детальной карточки элемента (начинка, декор, и т.д.)
 *   • AdditionalConditionsModal — надпись на торте, комментарий, запрос скидки
 *
 * Навигация: Header → navigate("cake-builder") → эта страница
 */

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from "@/components/ui/dialog";
import { FillingSlicePreview } from "@/components/cake-slice/cake-slice-visualizer";
import {
  CAKE_BUILDER_OPTIONS,
  MOCK_CONFECTIONERS,
} from "@/lib/mock-data";
import { formatCurrency, calculateDelivery } from "@/lib/finance";
import { calculateRegionalPriceSync } from "@/lib/regional-pricing";
import {
  Cake,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  MapPin,
  Calendar,
  Truck,
  User,
  X,
  PartyPopper,
  Percent,
  Eye,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useState, useMemo, useEffect } from "react";
import type { CakeBuilderState } from "@/lib/types";

// Тип для начинки из БД (40+ начинок, добавляются кондитерами, модерация админом)
interface DbFilling {
  id: string;
  name: string;
  description: string | null;
  base_sponge: string;
  flavor_group: string;
  dietary_tags: string[];
  price_multiplier: number;
  is_seasonal: boolean;
  season_months: number[];
  color_code: string;
  is_active: boolean;
  sort_order: number;
  status: string;
  created_by: string | null;
  created_by_name: string | null;
  usage_count: number;
}

// Группы вкуса для отображения
const FLAVOR_GROUPS: Record<string, { label: string; icon: string }> = {
  berry: { label: "Ягодные", icon: "🫐" },
  fruit: { label: "Фруктовые", icon: "🍑" },
  chocolate: { label: "Шоколадные", icon: "🍫" },
  caramel: { label: "Карамельные", icon: "🍯" },
  nut: { label: "Ореховые", icon: "🥜" },
  cream: { label: "Кремовые", icon: "🥛" },
  mousse: { label: "Муссовые", icon: "🍮" },
  classic: { label: "Классические", icon: "🎂" },
};

const STEP_LABELS = [
  "Тип изделия",
  "Мероприятие",
  "Основа",
  "Начинка",
  "Покрытие",
  "Декор",
  "Диета",
  "Доставка",
  "Резюме",
];

// Тип для детальной карточки опции
interface OptionDetail {
  title: string;
  description: string;
  price?: number;
  priceLabel?: string;
  icon?: string;
  category: string;
  fillingName?: string; // для FillingSlicePreview
}

export function CakeBuilderPage() {
  const cakeBuilder = useAppStore((s) => s.cakeBuilder);
  const updateCakeBuilder = useAppStore((s) => s.updateCakeBuilder);
  const resetCakeBuilder = useAppStore((s) => s.resetCakeBuilder);
  const navigate = useAppStore((s) => s.navigate);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const confectioners = useAppStore((s) => s.confectioners);

  const [submitted, setSubmitted] = useState(false);
  const [selectedConfectioners, setSelectedConfectioners] = useState<string[]>([]);
  const [requestDiscount, setRequestDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountComment, setDiscountComment] = useState("");
  const [detailModal, setDetailModal] = useState<OptionDetail | null>(null);
  const [showConditionsModal, setShowConditionsModal] = useState(false);

  // Начинки загружаются из БД (45+ начинок, добавляются кондитерами)
  const [dbFillings, setDbFillings] = useState<DbFilling[]>([]);
  const [fillingsLoading, setFillingsLoading] = useState(false);
  const [activeFlavorGroup, setActiveFlavorGroup] = useState<string>("all");

  // Загрузка начинок из API при монтировании
  useEffect(() => {
    loadFillings();
  }, []);

  const loadFillings = async () => {
    setFillingsLoading(true);
    try {
      const res = await fetch("/api/fillings/list?status=APPROVED&limit=200");
      if (res.ok) {
        const data = await res.json();
        setDbFillings(data.fillings || []);
      }
    } catch (err) {
      console.error("[cake-builder] Failed to load fillings:", err);
    } finally {
      setFillingsLoading(false);
    }
  };

  // Fallback на CAKE_BUILDER_OPTIONS.fillings если API недоступен
  const fillings = dbFillings.length > 0
    ? dbFillings.map(f => ({
        id: f.id,
        label: f.name,
        price: Math.round((f.price_multiplier - 1) * 1000), // 1.0→0, 1.3→300
        description: f.description || "",
        flavorGroup: f.flavor_group,
        colorCode: f.color_code,
        isSeasonal: f.is_seasonal,
      }))
    : CAKE_BUILDER_OPTIONS.fillings.map(f => ({
        ...f,
        description: "",
        flavorGroup: "cream",
        colorCode: "#F5DEB3",
        isSeasonal: false,
      }));

  // Фильтрация начинок по группе вкуса
  const filteredFillings = activeFlavorGroup === "all"
    ? fillings
    : fillings.filter(f => f.flavorGroup === activeFlavorGroup);

  // Получить список уникальных групп вкуса, которые есть в данных
  const availableFlavorGroups = useMemo(() => {
    const groups = new Set(fillings.map(f => f.flavorGroup));
    return Array.from(groups)
      .map(g => ({ id: g, ...FLAVOR_GROUPS[g] }))
      .filter(g => g.label);
  }, [fillings]);

  const step = cakeBuilder.step;
  const productTypeMeta = CAKE_BUILDER_OPTIONS.productTypes.find(
    (p) => p.id === cakeBuilder.productType
  );

  const calculatePrice = () => {
    const pt = productTypeMeta;
    if (!pt) return 1500;
    let unitPrice = pt.priceBase;
    const base = CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === cakeBuilder.base);
    if (base) unitPrice += base.priceBase;
    const filling = fillings.find((f) => f.id === cakeBuilder.filling);
    if (filling) unitPrice += filling.price;
    const coating = CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === cakeBuilder.coating);
    if (coating) unitPrice += coating.price;
    cakeBuilder.decorations.forEach((decId) => {
      const dec = CAKE_BUILDER_OPTIONS.decorations.find((d) => d.id === decId);
      if (dec) unitPrice += dec.price;
    });
    if (pt.unit === "порция") {
      const servings = cakeBuilder.servings || pt.defaultServings || 8;
      const extraServings = Math.max(0, servings - (pt.minServings || 4));
      return unitPrice + extraServings * 180;
    } else {
      const quantity = cakeBuilder.quantity || pt.defaultQuantity || 1;
      return unitPrice * quantity;
    }
  };

  const canProceed = () => {
    switch (step) {
      case 0: return !!cakeBuilder.productType;
      case 1: return !!cakeBuilder.eventType;
      case 2: return !!cakeBuilder.base;
      case 3: return !!cakeBuilder.filling;
      case 4: return !!cakeBuilder.coating;
      case 5: return true;
      case 6: return true;
      case 7: return !!cakeBuilder.city && !!cakeBuilder.deliveryDate && !!cakeBuilder.deliveryType;
      case 8: return selectedConfectioners.length > 0;
      default: return true;
    }
  };

  const availableConfectioners = useMemo(() => {
    return confectioners.filter((c) => {
      if (!cakeBuilder.city) return true;
      const cityMatch = c.city === cakeBuilder.city;
      const deliveryCities = (c.location as { deliveryCities?: string[] })?.deliveryCities;
      const servesCity = deliveryCities?.includes(cakeBuilder.city);
      return cityMatch || servesCity || c.city === "Москва";
    });
  }, [confectioners, cakeBuilder.city]);

  const toggleConfectioner = (id: string) => {
    setSelectedConfectioners((prev) => {
      if (prev.includes(id)) {
        return prev.filter((c) => c !== id);
      }
      // Максимум 5 кондитеров
      if (prev.length >= 5) {
        toast.error("Максимум 5 кондитеров на запрос", {
          description: "Снимите выбор с другого кондитера, чтобы добавить этого.",
        });
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleNext = async () => {
    if (!canProceed()) {
      toast.error("Заполните обязательные поля");
      return;
    }
    if (step < 8) {
      updateCakeBuilder({ step: step + 1 });
    } else {
      if (!isAuthenticated) {
        setAuthModalOpen(true);
        toast.info("Войдите, чтобы отправить запрос кондитерам");
        return;
      }
      // Отправить запрос цен через API
      const quoteBody = {
        product_type: cakeBuilder.productType,
        product_type_label: productTypeMeta?.label,
        event_type: cakeBuilder.eventType,
        base: cakeBuilder.base,
        filling: cakeBuilder.filling,
        filling_id: cakeBuilder.filling,
        coating: cakeBuilder.coating,
        decorations: cakeBuilder.decorations || [],
        dietary: cakeBuilder.dietary || [],
        servings: cakeBuilder.servings || productTypeMeta?.defaultServings || 8,
        quantity: cakeBuilder.quantity,
        tiers: cakeBuilder.tiers || 1,
        shape: cakeBuilder.shape,
        inscription: cakeBuilder.inscription,
        comment: cakeBuilder.comment,
        city: cakeBuilder.city || "",
        delivery_date: cakeBuilder.deliveryDate,
        delivery_type: cakeBuilder.deliveryType || "delivery",
        address: cakeBuilder.address,
        discount_requested: requestDiscount,
        discount_percent: requestDiscount ? discountPercent : 0,
        discount_comment: requestDiscount ? discountComment : undefined,
        estimated_price: regionalPrice + deliveryCost,
        estimated_delivery_cost: deliveryCost,
        confectioner_ids: selectedConfectioners,
      };

      try {
        const res = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(quoteBody),
        });
        if (res.ok) {
          const data = await res.json();
          setSubmitted(true);
          toast.success(
            `Запрос отправлен ${selectedConfectioners.length} кондитер(ам)!`,
            {
              description: requestDiscount && discountPercent > 0
                ? `Запрошена скидка ${discountPercent}%. Ответы придут в течение 48 часов.`
                : "Кондитеры предложат цену в течение 48 часов. Согласование — в личном кабинете.",
            }
          );
        } else {
          // Fallback: сохранить в store если API недоступен
          const newNegotiations = selectedConfectioners.map((confId) => {
            const conf = confectioners.find((c) => c.id === confId);
            return {
              id: `neg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              inquiryId: `inq_${Date.now()}`,
              customerId: "u_new",
              customerName: "Покупатель",
              confectionerId: confId,
              confectionerName: conf?.businessName || "Кондитер",
              confectionerAvatar: conf?.avatar,
              originalRequest: {
                eventType: cakeBuilder.eventType || "",
                base: cakeBuilder.base || "",
                filling: cakeBuilder.filling || "",
                coating: cakeBuilder.coating || "",
                decorations: cakeBuilder.decorations || [],
                servings: cakeBuilder.servings || productTypeMeta?.defaultServings || 8,
                city: cakeBuilder.city || "",
                deliveryDate: cakeBuilder.deliveryDate || "",
                deliveryType: cakeBuilder.deliveryType || "delivery",
                comment: cakeBuilder.comment || "",
                estimatedPrice: regionalPrice + deliveryCost,
              },
              discountRequested: requestDiscount,
              discountPercent: requestDiscount ? discountPercent : 0,
              discountComment: requestDiscount ? discountComment : "",
              quotedItems: [],
              quotedTotal: 0,
              quotedDeliveryCost: 0,
              quotedPrepTime: "",
              status: "pending_confectioner" as const,
              revisions: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            };
          });
          useAppStore.setState({ negotiations: [...useAppStore.getState().negotiations, ...newNegotiations] });
          setSubmitted(true);
          toast.success(`Запрос отправлен ${selectedConfectioners.length} кондитер(ам)!`);
        }
      } catch (err) {
        console.error("[cake-builder] quote submit error:", err);
        toast.error("Ошибка отправки запроса. Попробуйте ещё раз.");
      }
    }
  };

  const handleBack = () => {
    if (step > 0) updateCakeBuilder({ step: step - 1 });
    else navigate("home");
  };

  const handleClose = () => {
    resetCakeBuilder();
    setSubmitted(false);
    setSelectedConfectioners([]);
    navigate("home");
  };

  const toggleDecoration = (id: string) => {
    const decorations = cakeBuilder.decorations.includes(id)
      ? cakeBuilder.decorations.filter((d) => d !== id)
      : [...cakeBuilder.decorations, id];
    updateCakeBuilder({ decorations });
  };

  const toggleDietary = (id: string) => {
    const dietary = cakeBuilder.dietary.includes(id)
      ? cakeBuilder.dietary.filter((d) => d !== id)
      : [...cakeBuilder.dietary, id];
    updateCakeBuilder({ dietary });
  };

  const estimatedPrice = calculatePrice();
  const regionalResult = calculateRegionalPriceSync(estimatedPrice, cakeBuilder.city || "");
  const regionalPrice = regionalResult.price;
  const deliveryCost = cakeBuilder.deliveryType === "delivery" ? calculateDelivery(regionalPrice).cost : 0;

  // ===== SUCCESS SCREEN =====
  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-8 lg:py-12 max-w-3xl">
        <Card className="p-8 lg:p-12 text-center space-y-6">
          <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
            <PartyPopper className="h-10 w-10 text-emerald-600" />
          </div>
          <div>
            <h2 className="font-display text-2xl lg:text-3xl font-bold mb-2">
              Запрос отправлен {selectedConfectioners.length} кондитер(ам)!
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Каждый кондитер получил ваш проект «{productTypeMeta?.label || "торт"}»
              {requestDiscount && discountPercent > 0 && (
                <> с запросом скидки {discountPercent}%</>
              )}. Ожидайте предложений с ценой в течение 48 часов.
              Согласование и оплата — в личном кабинете.
            </p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4 max-w-md mx-auto">
            <div className="font-semibold mb-2 text-sm">Кому отправлено:</div>
            <div className="space-y-2">
              {selectedConfectioners.map((id) => {
                const conf = confectioners.find((c) => c.id === id);
                if (!conf) return null;
                return (
                  <div key={id} className="flex items-center gap-2 text-sm">
                    <img src={conf.avatar} alt="" className="w-6 h-6 rounded-full" loading="lazy" decoding="async" />
                    <span>{conf.businessName}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">
                      ⏳ Ожидает ответа
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 justify-center">
            <Button onClick={handleClose} variant="outline">
              На главную
            </Button>
            <Button
              onClick={() => {
                handleClose();
                navigate("dashboard-customer", { tab: "negotiations" });
              }}
            >
              Перейти к согласованию
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <div className="container mx-auto px-4 py-6 lg:py-8 max-w-7xl">
        {/* ===== HEADER ===== */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Назад
            </Button>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-full bg-primary flex items-center justify-center">
                <Cake className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-display text-lg lg:text-xl font-bold flex items-center gap-2">
                  {productTypeMeta ? `Конструктор: ${productTypeMeta.label}` : "Конструктор десертов"}
                  <Badge variant="secondary" className="text-[10px]">
                    Шаг {step + 1} / 9
                  </Badge>
                </h1>
                <p className="text-xs text-muted-foreground">
                  {STEP_LABELS[step]}
                </p>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* ===== PROGRESS BAR ===== */}
        <div className="mb-6 flex gap-1">
          {STEP_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => i <= step && updateCakeBuilder({ step: i })}
              className={`h-1.5 flex-1 rounded-full transition-all ${
                i === step ? "bg-primary" : i < step ? "bg-primary/60" : "bg-border"
              }`}
              title={label}
            />
          ))}
        </div>

        {/* ===== TWO-COLUMN LAYOUT ===== */}
        <div className="grid lg:grid-cols-[1fr_340px] gap-6">
          {/* ===== LEFT: STEP CONTENT ===== */}
          <div className="min-h-[500px]">
            {/* Step 0: Product Type */}
            {step === 0 && (
              <StepContainer
                title="Что будем создавать?"
                subtitle="Выберите тип кондитерского изделия — торт, капкейки, макаронс и др."
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CAKE_BUILDER_OPTIONS.productTypes.map((opt) => (
                    <OptionCard
                      key={opt.id}
                      selected={cakeBuilder.productType === opt.id}
                      onClick={() => {
                        updateCakeBuilder({
                          productType: opt.id as CakeBuilderState["productType"],
                          base: undefined,
                          filling: undefined,
                          coating: undefined,
                          decorations: [],
                          dietary: [],
                          servings: opt.defaultServings,
                          quantity: opt.defaultQuantity,
                        });
                        setTimeout(() => updateCakeBuilder({ step: 1 }), 100);
                      }}
                      onDetail={() => setDetailModal({
                        title: opt.label,
                        description: opt.description,
                        price: opt.priceBase,
                        priceLabel: `от ${formatCurrency(opt.priceBase)} / ${opt.unit}`,
                        icon: opt.icon,
                        category: "Тип изделия",
                      })}
                    >
                      <div className="text-3xl mb-2">{opt.icon}</div>
                      <div className="font-medium text-sm">{opt.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {opt.description}
                      </div>
                      <div className="text-xs text-primary font-medium mt-1">
                        от {formatCurrency(opt.priceBase)} / {opt.unit}
                      </div>
                    </OptionCard>
                  ))}
                </div>
              </StepContainer>
            )}

            {/* Step 1: Event Type */}
            {step === 1 && (
              <StepContainer
                title="Какое мероприятие?"
                subtitle="Выберите тип события, чтобы мы подобрали подходящий торт"
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CAKE_BUILDER_OPTIONS.eventTypes.map((opt) => (
                    <OptionCard
                      key={opt.id}
                      selected={cakeBuilder.eventType === opt.id}
                      onClick={() => updateCakeBuilder({ eventType: opt.id as CakeBuilderState["eventType"] })}
                      onDetail={() => setDetailModal({
                        title: opt.label,
                        description: opt.description,
                        icon: opt.icon,
                        category: "Мероприятие",
                      })}
                    >
                      <div className="text-3xl mb-2">{opt.icon}</div>
                      <div className="font-medium text-sm">{opt.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {opt.description}
                      </div>
                    </OptionCard>
                  ))}
                </div>
              </StepContainer>
            )}

            {/* Step 2: Base — filtered by product type */}
            {step === 2 && (
              <StepContainer
                title="Выберите основу"
                subtitle={
                  (productTypeMeta as { applicableBases?: string[] })?.applicableBases?.length === 0
                    ? `Для «${productTypeMeta?.label}» основа не требуется — перейдите к следующему шагу`
                    : `Это определит текстуру и вкус вашего ${productTypeMeta?.label?.toLowerCase() || "торта"}`
                }
              >
                {(() => {
                  // Filter bases by product type — only show applicable bases
                  const applicableBases = (productTypeMeta as { applicableBases?: string[] })?.applicableBases || [];
                  const filteredBases = applicableBases.length > 0
                    ? CAKE_BUILDER_OPTIONS.bases.filter(b => applicableBases.includes(b.id))
                    : CAKE_BUILDER_OPTIONS.bases;

                  if (filteredBases.length === 0) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <Cake className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p>Для «{productTypeMeta?.label}» выбор основы не требуется.</p>
                        <p className="text-sm mt-1">Нажмите «Далее» чтобы продолжить.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredBases.map((opt) => (
                        <OptionCard
                          key={opt.id}
                          selected={cakeBuilder.base === opt.id}
                          onClick={() => updateCakeBuilder({ base: opt.id as CakeBuilderState["base"] })}
                          onDetail={() => setDetailModal({
                            title: opt.label,
                            description: opt.description,
                            price: opt.priceBase,
                            priceLabel: opt.priceBase > 0 ? `+${formatCurrency(opt.priceBase)}` : "Включено в базу",
                            category: "Основа",
                          })}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="font-medium">{opt.label}</div>
                              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {opt.description}
                              </div>
                            </div>
                            {opt.priceBase > 0 && (
                              <Badge variant="secondary" className="text-[10px]">
                                +{formatCurrency(opt.priceBase)}
                              </Badge>
                            )}
                          </div>
                        </OptionCard>
                      ))}
                    </div>
                  );
                })()}
              </StepContainer>
            )}

            {/* Step 2.5: Tiers & Shape (only for cakes with hasTiers or hasShape) */}
            {step === 2.5 && (
              <StepContainer
                title="Ярусы и форма"
                subtitle="Выберите количество ярусов и форму изделия"
              >
                <div className="space-y-6">
                  {/* Tiers selection */}
                  {(productTypeMeta as { hasTiers?: boolean })?.hasTiers && (
                    <div>
                      <Label className="font-semibold text-sm mb-3 block">Количество ярусов</Label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {CAKE_BUILDER_OPTIONS.tiers.map((tier) => {
                          const isSelected = cakeBuilder.tiers === tier.id;
                          return (
                            <button
                              key={tier.id}
                              onClick={() => updateCakeBuilder({ tiers: tier.id })}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                isSelected
                                  ? "border-primary bg-primary/5 shadow-sm"
                                  : "border-border hover:border-primary/40"
                              }`}
                            >
                              <div className="font-display text-lg font-bold">{tier.label}</div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {tier.minGuests}-{tier.maxGuests} гостей
                              </div>
                              <div className="text-xs text-primary mt-1">
                                ~{tier.recommendedWeight} кг
                              </div>
                              {tier.priceModifier > 0 && (
                                <Badge variant="secondary" className="text-[10px] mt-2">
                                  +{formatCurrency(tier.priceModifier)}
                                </Badge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {/* Recommendation based on servings */}
                      {cakeBuilder.servings && (
                        <div className="mt-3 p-3 bg-primary/5 rounded-lg text-sm">
                          <span className="text-muted-foreground">Рекомендация для {cakeBuilder.servings} гостей: </span>
                          <span className="font-medium text-primary">
                            {(() => {
                              const recommended = CAKE_BUILDER_OPTIONS.tiers.find(
                                t => cakeBuilder.servings! >= t.minGuests && cakeBuilder.servings! <= t.maxGuests
                              );
                              return recommended ? recommended.label : "3+ ярусов";
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Shape selection */}
                  {(productTypeMeta as { hasShape?: boolean })?.hasShape && (
                    <div>
                      <Label className="font-semibold text-sm mb-3 block">Форма изделия</Label>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {CAKE_BUILDER_OPTIONS.shapes.map((shape) => {
                          const isSelected = cakeBuilder.shape === shape.id;
                          return (
                            <button
                              key={shape.id}
                              onClick={() => updateCakeBuilder({ shape: shape.id } as Partial<CakeBuilderState>)}
                              className={`p-4 rounded-lg border-2 transition-all text-center ${
                                isSelected
                                  ? "border-primary bg-primary/5 shadow-sm"
                                  : "border-border hover:border-primary/40"
                              }`}
                            >
                              <div className="text-3xl mb-2">{shape.icon}</div>
                              <div className="font-medium text-sm">{shape.label}</div>
                              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                                {shape.description}
                              </div>
                              {shape.priceModifier > 0 && (
                                <Badge variant="secondary" className="text-[10px] mt-1">
                                  +{formatCurrency(shape.priceModifier)}
                                </Badge>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </StepContainer>
            )}

            {/* Step 3: Filling */}
            {step === 3 && (
              <StepContainer
                title="Начинка"
                subtitle={`${fillings.length} начинок — выберите любимую. Кликните ℹ️ для описания.`}
              >
                {/* Фильтр по группам вкуса */}
                {availableFlavorGroups.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      onClick={() => setActiveFlavorGroup("all")}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        activeFlavorGroup === "all"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted hover:bg-muted/70 text-muted-foreground"
                      }`}
                    >
                      Все ({fillings.length})
                    </button>
                    {availableFlavorGroups.map(g => (
                      <button
                        key={g.id}
                        onClick={() => setActiveFlavorGroup(g.id)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                          activeFlavorGroup === g.id
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted hover:bg-muted/70 text-muted-foreground"
                        }`}
                      >
                        {g.icon} {g.label} ({fillings.filter(f => f.flavorGroup === g.id).length})
                      </button>
                    ))}
                  </div>
                )}

                {fillingsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Загрузка начинок...
                  </div>
                ) : filteredFillings.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Начинки не найдены. Попробуйте другую категорию.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {filteredFillings.map((opt) => (
                      <OptionCard
                        key={opt.id}
                        selected={cakeBuilder.filling === opt.id}
                        onClick={() => updateCakeBuilder({ filling: opt.id })}
                        onDetail={() => setDetailModal({
                          title: opt.label,
                          description: opt.description || "Начинка для торта. Подробное описание будет добавлено позже.",
                          price: opt.price,
                          priceLabel: opt.price > 0 ? `+${formatCurrency(opt.price)}` : "Включено в базу",
                          category: "Начинка",
                          fillingName: opt.label,
                        })}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-xs"
                            style={{ backgroundColor: opt.colorCode + "33", border: `2px solid ${opt.colorCode}` }}
                          >
                            <span className="text-lg">{(FLAVOR_GROUPS as Record<string, { label: string; icon: string }>)[opt.flavorGroup]?.icon || "🎂"}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{opt.label}</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {opt.price > 0 && (
                                <Badge variant="secondary" className="text-[10px]">
                                  +{formatCurrency(opt.price)}
                                </Badge>
                              )}
                              {opt.isSeasonal && (
                                <Badge className="text-[10px] bg-amber-100 text-amber-700">сезон</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </OptionCard>
                    ))}
                  </div>
                )}
              </StepContainer>
            )}

            {/* Step 4: Coating */}
            {step === 4 && (
              <StepContainer
                title="Покрытие"
                subtitle="Внешний вид изделия"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {CAKE_BUILDER_OPTIONS.coatings.map((opt) => (
                    <OptionCard
                      key={opt.id}
                      selected={cakeBuilder.coating === opt.id}
                      onClick={() => updateCakeBuilder({ coating: opt.id })}
                      onDetail={() => setDetailModal({
                        title: opt.label,
                        description: (opt as { description?: string }).description || "Покрытие торта — внешний вид и текстура. Выберите подходящий вариант.",
                        price: opt.price,
                        priceLabel: opt.price > 0 ? `+${formatCurrency(opt.price)}` : "Включено в базу",
                        category: "Покрытие",
                      })}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{opt.label}</div>
                        {opt.price > 0 && (
                          <Badge variant="secondary" className="text-[10px]">
                            +{formatCurrency(opt.price)}
                          </Badge>
                        )}
                      </div>
                    </OptionCard>
                  ))}
                </div>
              </StepContainer>
            )}

            {/* Step 5: Decorations */}
            {step === 5 && (
              <StepContainer
                title="Декор"
                subtitle="Можно выбрать несколько вариантов (опционально)"
              >
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {CAKE_BUILDER_OPTIONS.decorations.map((opt) => (
                    <OptionCard
                      key={opt.id}
                      selected={cakeBuilder.decorations.includes(opt.id)}
                      onClick={() => toggleDecoration(opt.id)}
                      onDetail={() => setDetailModal({
                        title: opt.label,
                        description: (opt as { description?: string }).description || "Элемент декора для украшения торта. Можно выбрать несколько вариантов.",
                        price: opt.price,
                        priceLabel: `+${formatCurrency(opt.price)}`,
                        category: "Декор",
                      })}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">{opt.label}</div>
                        <Badge variant="secondary" className="text-[10px]">
                          +{formatCurrency(opt.price)}
                        </Badge>
                      </div>
                    </OptionCard>
                  ))}
                </div>
              </StepContainer>
            )}

            {/* Step 6: Dietary */}
            {step === 6 && (
              <StepContainer
                title="Диетические предпочтения"
                subtitle="Учтём особые требования (опционально)"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {CAKE_BUILDER_OPTIONS.dietary.map((opt) => (
                    <OptionCard
                      key={opt.id}
                      selected={cakeBuilder.dietary.includes(opt.id)}
                      onClick={() => toggleDietary(opt.id)}
                      onDetail={() => setDetailModal({
                        title: opt.label,
                        description: opt.description || "Диетическое ограничение.",
                        category: "Диета",
                      })}
                    >
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {opt.description}
                        </div>
                      </div>
                    </OptionCard>
                  ))}
                </div>
              </StepContainer>
            )}

            {/* Step 7: Delivery */}
            {step === 7 && (
              <StepContainer
                title="Доставка"
                subtitle="Где и когда вам нужен торт?"
              >
                <div className="space-y-4 max-w-2xl">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>
                        <MapPin className="h-3.5 w-3.5 inline mr-1" />
                        Город
                      </Label>
                      <Input
                        value={cakeBuilder.city || ""}
                        onChange={(e) => updateCakeBuilder({ city: e.target.value })}
                        placeholder="Москва"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>
                        <Calendar className="h-3.5 w-3.5 inline mr-1" />
                        Дата доставки
                      </Label>
                      <Input
                        type="date"
                        value={cakeBuilder.deliveryDate || ""}
                        onChange={(e) => updateCakeBuilder({ deliveryDate: e.target.value })}
                        placeholder="Выберите дату"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Способ получения</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <OptionCard
                        selected={cakeBuilder.deliveryType === "delivery"}
                        onClick={() => updateCakeBuilder({ deliveryType: "delivery" })}
                      >
                        <div className="flex items-center gap-2">
                          <Truck className="h-5 w-5 text-primary" />
                          <div>
                            <div className="font-medium text-sm">Доставка</div>
                            <div className="text-xs text-muted-foreground">
                              {deliveryCost === 0 ? "Бесплатно" : formatCurrency(deliveryCost)}
                            </div>
                          </div>
                        </div>
                      </OptionCard>
                      <OptionCard
                        selected={cakeBuilder.deliveryType === "pickup"}
                        onClick={() => updateCakeBuilder({ deliveryType: "pickup" })}
                      >
                        <div className="flex items-center gap-2">
                          <User className="h-5 w-5 text-primary" />
                          <div>
                            <div className="font-medium text-sm">Самовывоз</div>
                            <div className="text-xs text-muted-foreground">Бесплатно</div>
                          </div>
                        </div>
                      </OptionCard>
                    </div>
                  </div>
                  {cakeBuilder.deliveryType === "delivery" && (
                    <div className="space-y-1.5">
                      <Label>Адрес доставки</Label>
                      <Input
                        value={cakeBuilder.address || ""}
                        onChange={(e) => updateCakeBuilder({ address: e.target.value })}
                        placeholder="ул. Тверская, д. 12, кв. 45"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Количество порций</Label>
                    <Input
                      type="number"
                      min={2}
                      max={200}
                      value={cakeBuilder.servings || ""}
                      onChange={(e) =>
                        updateCakeBuilder({ servings: parseInt(e.target.value) || undefined })
                      }
                      placeholder="10"
                    />
                    <p className="text-xs text-muted-foreground">
                      Базовая цена рассчитана на 8 порций. Дополнительно: +180 ₽/порция
                    </p>
                  </div>
                </div>
              </StepContainer>
            )}

            {/* Step 8: Summary & Confectioners */}
            {step === 8 && (
              <StepContainer
                title="Выберите кондитеров"
                subtitle={`Выберите одного или нескольких кондитеров в городе ${cakeBuilder.city || "—"} для отправки запроса.`}
              >
                <div className="space-y-4">
                  {/* Additional conditions button */}
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowConditionsModal(true)}
                    >
                      <Sparkles className="h-4 w-4 mr-1" />
                      Дополнительные условия
                      {(cakeBuilder.inscription || cakeBuilder.comment || requestDiscount) && (
                        <Badge className="ml-2 text-[10px]" variant="secondary">
                          заполнено
                        </Badge>
                      )}
                    </Button>
                  </div>

                  {/* Confectioner list */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="font-semibold">
                        Кондитеры в г. {cakeBuilder.city || "—"} ({availableConfectioners.length})
                      </Label>
                      <Badge variant="outline" className={`text-xs ${selectedConfectioners.length >= 5 ? "bg-amber-50 text-amber-700" : ""}`}>
                        Выбрано: {selectedConfectioners.length} / 5
                      </Badge>
                    </div>
                    {availableConfectioners.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        В вашем городе пока нет кондитеров. Выберите другой город на шаге 7.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                        {availableConfectioners.map((conf) => {
                          const isSelected = selectedConfectioners.includes(conf.id);
                          return (
                            <button
                              key={conf.id}
                              onClick={() => toggleConfectioner(conf.id)}
                              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                                isSelected
                                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                  : "border-border hover:border-primary/30"
                              }`}
                            >
                              <img
                                src={conf.avatar}
                                alt=""
                                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                                loading="lazy"
                                decoding="async"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm truncate">{conf.businessName}</span>
                                  {conf.verified && (
                                    <Badge className="text-[9px] bg-primary">✓</Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground flex items-center gap-2">
                                  <span>⭐ {conf.rating.toFixed(1)} ({conf.reviewsCount})</span>
                                  <span>· {conf.ordersCount} заказов</span>
                                  <span>· {conf.city}</span>
                                </div>
                              </div>
                              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                isSelected ? "border-primary bg-primary" : "border-border"
                              }`}>
                                {isSelected && <Check className="h-3 w-3 text-white" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </StepContainer>
            )}
          </div>

          {/* ===== RIGHT: LIVE SUMMARY (sticky) ===== */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <Card className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="font-display font-bold">Ваш заказ</h3>
                </div>

                {/* Filling preview */}
                {cakeBuilder.filling && (
                  <div className="flex gap-3 items-center pb-3 border-b">
                    <FillingSlicePreview
                      fillingName={fillings.find((f) => f.id === cakeBuilder.filling)?.label || ""}
                      size={64}
                    />
                    <div>
                      <div className="text-xs text-muted-foreground">Срез торта</div>
                      <div className="font-medium text-sm">
                        {fillings.find((f) => f.id === cakeBuilder.filling)?.label}
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-2 text-sm">
                  <SummaryRow label="Изделие" value={productTypeMeta?.label} />
                  <SummaryRow label="Мероприятие" value={CAKE_BUILDER_OPTIONS.eventTypes.find((e) => e.id === cakeBuilder.eventType)?.label} />
                  <SummaryRow label="Основа" value={CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === cakeBuilder.base)?.label} />
                  <SummaryRow label="Начинка" value={fillings.find((f) => f.id === cakeBuilder.filling)?.label} />
                  <SummaryRow label="Покрытие" value={CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === cakeBuilder.coating)?.label} />
                  {cakeBuilder.decorations.length > 0 && (
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground shrink-0">Декор:</span>
                      <span className="font-medium text-right text-xs">
                        {cakeBuilder.decorations
                          .map((d) => CAKE_BUILDER_OPTIONS.decorations.find((o) => o.id === d)?.label)
                          .join(", ")}
                      </span>
                    </div>
                  )}
                  <SummaryRow label="Город" value={cakeBuilder.city} />
                  <SummaryRow label="Дата" value={cakeBuilder.deliveryDate} />
                  {cakeBuilder.servings && <SummaryRow label="Порций" value={String(cakeBuilder.servings)} />}
                  {cakeBuilder.inscription && <SummaryRow label="Надпись" value={cakeBuilder.inscription} />}
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Оценка:</span>
                    <span className="font-bold text-primary text-lg">
                      ~{formatCurrency(regionalPrice + deliveryCost)}
                    </span>
                  </div>
                  {regionalResult.multiplier !== 1.0 && (
                    <div className="text-xs text-muted-foreground text-right">
                      ({regionalResult.multiplier > 1 ? "+" : ""}{Math.round((regionalResult.multiplier - 1) * 100)}% регион)
                    </div>
                  )}
                  {requestDiscount && discountPercent > 0 && (
                    <div className="text-xs text-amber-600 text-right">
                      Со скидкой {discountPercent}%: ~{formatCurrency(Math.round((regionalPrice + deliveryCost) * (1 - discountPercent / 100)))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Финальную цену предложат кондитеры.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>

        {/* ===== FOOTER NAVIGATION ===== */}
        <div className="mt-6 flex items-center justify-between border-t pt-4">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={step === 0}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
          <div className="text-sm text-muted-foreground hidden sm:block">
            {step === 8
              ? selectedConfectioners.length > 0
                ? `Отправить ${selectedConfectioners.length} кондитер(ам)`
                : "Выберите кондитеров"
              : `Шаг ${step + 1} из 9`}
          </div>
          <Button onClick={handleNext} disabled={!canProceed()}>
            {step === 8 ? (
              <>
                <Sparkles className="h-4 w-4 mr-1" />
                Отправить запрос{selectedConfectioners.length > 0 ? ` (${selectedConfectioners.length})` : ""}
              </>
            ) : (
              <>
                Далее
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ===== MODAL: Option Detail ===== */}
      <OptionDetailModal
        detail={detailModal}
        onClose={() => setDetailModal(null)}
      />

      {/* ===== MODAL: Additional Conditions ===== */}
      <AdditionalConditionsModal
        open={showConditionsModal}
        onClose={() => setShowConditionsModal(false)}
        inscription={cakeBuilder.inscription || ""}
        onInscriptionChange={(v) => updateCakeBuilder({ inscription: v })}
        comment={cakeBuilder.comment || ""}
        onCommentChange={(v) => updateCakeBuilder({ comment: v })}
        requestDiscount={requestDiscount}
        onRequestDiscountChange={setRequestDiscount}
        discountPercent={discountPercent}
        onDiscountPercentChange={setDiscountPercent}
        discountComment={discountComment}
        onDiscountCommentChange={setDiscountComment}
        estimatedPrice={regionalPrice + deliveryCost}
      />
    </div>
  );
}

// ===== Helper Components =====

function StepContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-xl lg:text-2xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  onDetail,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  onDetail?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative text-left p-4 rounded-lg border-2 transition-all ${
      selected
        ? "border-primary bg-primary/5 shadow-sm"
        : "border-border hover:border-primary/40 hover:bg-accent/40"
    }`}>
      <button onClick={onClick} className="w-full text-left">
        <div className="relative">
          {selected && (
            <div className="absolute top-0 right-0 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          )}
          {children}
        </div>
      </button>
      {onDetail && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDetail();
          }}
          className="absolute bottom-2 right-2 text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5"
          title="Подробнее"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

// ===== Option Detail Modal =====

function OptionDetailModal({
  detail,
  onClose,
}: {
  detail: OptionDetail | null;
  onClose: () => void;
}) {
  if (!detail) return null;

  return (
    <Dialog open={!!detail} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="secondary" className="text-[10px]">{detail.category}</Badge>
          </div>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            {detail.icon && <span className="text-2xl">{detail.icon}</span>}
            {detail.title}
          </DialogTitle>
          {detail.priceLabel && (
            <DialogDescription className="text-primary font-medium">
              {detail.priceLabel}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Filling slice preview (for filling options) */}
        {detail.fillingName && (
          <div className="flex justify-center py-4">
            <FillingSlicePreview fillingName={detail.fillingName} size={120} />
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {detail.description}
          </p>
          {detail.price !== undefined && detail.price > 0 && (
            <div className="flex items-center justify-between p-3 bg-primary/5 rounded-lg">
              <span className="text-sm font-medium">Доплата к базовой цене:</span>
              <span className="text-primary font-bold">+{formatCurrency(detail.price)}</span>
            </div>
          )}
        </div>

        <Button onClick={onClose} className="w-full">
          Понятно
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ===== Additional Conditions Modal =====

function AdditionalConditionsModal({
  open,
  onClose,
  inscription,
  onInscriptionChange,
  comment,
  onCommentChange,
  requestDiscount,
  onRequestDiscountChange,
  discountPercent,
  onDiscountPercentChange,
  discountComment,
  onDiscountCommentChange,
  estimatedPrice,
}: {
  open: boolean;
  onClose: () => void;
  inscription: string;
  onInscriptionChange: (v: string) => void;
  comment: string;
  onCommentChange: (v: string) => void;
  requestDiscount: boolean;
  onRequestDiscountChange: (v: boolean) => void;
  discountPercent: number;
  onDiscountPercentChange: (v: number) => void;
  discountComment: string;
  onDiscountCommentChange: (v: string) => void;
  estimatedPrice: number;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Дополнительные условия
          </DialogTitle>
          <DialogDescription>
            Надпись на торте, комментарий кондитеру, запрос скидки
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Inscription */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Надпись на торте (опционально)</Label>
            <Input
              value={inscription}
              onChange={(e) => onInscriptionChange(e.target.value)}
              placeholder="С днём рождения, Маша!"
              maxLength={50}
            />
            <p className="text-xs text-muted-foreground">Максимум 50 символов</p>
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Комментарий кондитеру (опционально)</Label>
            <Textarea
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="Особые пожелания, цветовое решение, аллергии..."
              rows={3}
            />
          </div>

          {/* Discount request */}
          <div className="border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg p-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requestDiscount}
                onChange={(e) => onRequestDiscountChange(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm font-medium flex items-center gap-1">
                <Percent className="h-4 w-4 text-amber-600" />
                Запросить скидку
              </span>
            </label>
            {requestDiscount && (
              <div className="space-y-2 pl-6">
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Скидка %:</Label>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={discountPercent}
                    onChange={(e) => onDiscountPercentChange(parseInt(e.target.value))}
                    className="flex-1"
                  />
                  <Badge className="bg-amber-100 text-amber-700 min-w-[50px] justify-center">
                    {discountPercent}%
                  </Badge>
                </div>
                <Input
                  value={discountComment}
                  onChange={(e) => onDiscountCommentChange(e.target.value)}
                  placeholder="Комментарий к запросу скидки (опционально)..."
                  className="text-sm"
                />
                <div className="text-xs text-muted-foreground">
                  Цена со скидкой:{" "}
                  <span className="text-amber-600 font-medium">
                    ~{formatCurrency(Math.round(estimatedPrice * (1 - discountPercent / 100)))}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Кондитеры увидят ваш запрос скидки и могут предложить скидку или отказаться.
                </p>
              </div>
            )}
          </div>
        </div>

        <Button onClick={onClose} className="w-full">
          Сохранить
        </Button>
      </DialogContent>
    </Dialog>
  );
}
