"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FillingSlicePreview } from "@/components/cake-slice/cake-slice-visualizer";
import {
  CAKE_BUILDER_OPTIONS,
  MOCK_CONFECTIONERS,
} from "@/lib/mock-data";
import { formatCurrency, calculateDelivery } from "@/lib/finance";
import { calculateRegionalPriceSync } from "@/lib/regional-pricing";
import Image from "next/image";
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
  Heart,
  X,
  PartyPopper,
  Percent,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import type { CakeBuilderState } from "@/lib/types";

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

export function CakeBuilderDialog() {
  const cakeBuilderOpen = useAppStore((s) => s.cakeBuilderOpen);
  const setCakeBuilderOpen = useAppStore((s) => s.setCakeBuilderOpen);
  const cakeBuilder = useAppStore((s) => s.cakeBuilder);
  const updateCakeBuilder = useAppStore((s) => s.updateCakeBuilder);
  const resetCakeBuilder = useAppStore((s) => s.resetCakeBuilder);
  const navigate = useAppStore((s) => s.navigate);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const setAuthModalOpen = useAppStore((s) => s.setAuthModalOpen);
  const confectioners = useAppStore((s) => s.confectioners);
  const negotiations = useAppStore((s) => s.negotiations);
  const user = useAppStore((s) => s.user);

  const [submitted, setSubmitted] = useState(false);
  const [selectedConfectioners, setSelectedConfectioners] = useState<string[]>([]);
  const [requestDiscount, setRequestDiscount] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountComment, setDiscountComment] = useState("");

  const step = cakeBuilder.step;
  // Выбранный тип изделия — определяет метаданные для расчёта цены
  const productTypeMeta = CAKE_BUILDER_OPTIONS.productTypes.find(
    (p) => p.id === cakeBuilder.productType
  );

  const calculatePrice = () => {
    // Базовая цена зависит от типа изделия
    const pt = productTypeMeta;
    if (!pt) return 1500; // дефолт для торта

    // Базовая цена за единицу или за всё изделие
    let unitPrice = pt.priceBase;

    const base = CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === cakeBuilder.base);
    if (base) unitPrice += base.priceBase;
    const filling = CAKE_BUILDER_OPTIONS.fillings.find((f) => f.id === cakeBuilder.filling);
    if (filling) unitPrice += filling.price;
    const coating = CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === cakeBuilder.coating);
    if (coating) unitPrice += coating.price;
    cakeBuilder.decorations.forEach((decId) => {
      const dec = CAKE_BUILDER_OPTIONS.decorations.find((d) => d.id === decId);
      if (dec) unitPrice += dec.price;
    });

    // Расчёт итоговой цены в зависимости от типа
    // Для "порция" изделий (торт, чизкейк, тарт, муссовый торт) — на порции
    // Для "шт" изделий (капкейки, макаронс, etc.) — на количество штук
    if (pt.unit === "порция") {
      const servings = cakeBuilder.servings || pt.defaultServings || 8;
      const extraServings = Math.max(0, servings - (pt.minServings || 4));
      return unitPrice + extraServings * 180;
    } else {
      // "шт" — цена за штуку × количество
      const quantity = cakeBuilder.quantity || pt.defaultQuantity || 1;
      return unitPrice * quantity;
    }
  };

  const canProceed = () => {
    // Шаг 0 — выбор типа изделия (обязателен)
    // Шаги 1..8 — как раньше, но сдвинуты на +1
    switch (step) {
      case 0:
        return !!cakeBuilder.productType;
      case 1:
        return !!cakeBuilder.eventType;
      case 2:
        return !!cakeBuilder.base;
      case 3:
        return !!cakeBuilder.filling;
      case 4:
        return !!cakeBuilder.coating;
      case 5:
        return true;
      case 6:
        return true;
      case 7:
        return !!cakeBuilder.city && !!cakeBuilder.deliveryDate && !!cakeBuilder.deliveryType;
      case 8:
        return selectedConfectioners.length > 0;
      default:
        return true;
    }
  };

  // Кондитеры в выбранном городе
  const availableConfectioners = confectioners.filter((c) => {
    if (!cakeBuilder.city) return true;
    const cityMatch = c.city === cakeBuilder.city;
    const deliveryCities = (c.location as { deliveryCities?: string[] })?.deliveryCities;
    const servesCity = deliveryCities?.includes(cakeBuilder.city);
    return cityMatch || servesCity || c.city === "Москва"; // fallback
  });

  const toggleConfectioner = (id: string) => {
    setSelectedConfectioners((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleNext = () => {
    if (!canProceed()) {
      toast.error("Заполните обязательные поля");
      return;
    }
    if (step < 8) {
      updateCakeBuilder({ step: step + 1 });
    } else {
      // submit — отправка запросов выбранным кондитерам
      if (!isAuthenticated) {
        setCakeBuilderOpen(false);
        setAuthModalOpen(true);
        toast.info("Войдите, чтобы отправить запрос кондитерам");
        return;
      }

      // Создаём negotiation для каждого выбранного кондитера
      const newNegotiations = selectedConfectioners.map((confId) => {
        const conf = confectioners.find((c) => c.id === confId);
        return {
          id: `neg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          inquiryId: `inq_${Date.now()}`,
          customerId: user?.id || "guest",
          customerName: user?.name || "Гость",
          customerAvatar: user?.avatar,
          confectionerId: confId,
          confectionerName: conf?.businessName || "Кондитер",
          confectionerAvatar: conf?.avatar,
          originalRequest: {
            productType: cakeBuilder.productType || "cake",
            productTypeLabel: productTypeMeta?.label || "Торт",
            eventType: cakeBuilder.eventType || "",
            base: cakeBuilder.base || "",
            filling: cakeBuilder.filling || "",
            coating: cakeBuilder.coating || "",
            decorations: cakeBuilder.decorations || [],
            dietary: cakeBuilder.dietary || [],
            servings: cakeBuilder.servings || productTypeMeta?.defaultServings || 8,
            quantity: cakeBuilder.quantity || productTypeMeta?.defaultQuantity || 1,
            city: cakeBuilder.city || "",
            deliveryDate: cakeBuilder.deliveryDate || "",
            deliveryType: cakeBuilder.deliveryType || "delivery",
            inscription: cakeBuilder.inscription || "",
            comment: cakeBuilder.comment || "",
            estimatedPrice: regionalPrice + deliveryCost,
          },
          // Запрос скидки
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

      // Добавляем negotiations в store
      useAppStore.setState({ negotiations: [...negotiations, ...newNegotiations] });

      setSubmitted(true);
      toast.success(
        `Запрос отправлен ${selectedConfectioners.length} кондитер(ам)!`,
        {
          description: requestDiscount && discountPercent > 0
            ? `Запрошена скидка ${discountPercent}%. Ответы придут в течение 48 часов.`
            : "Кондитеры предложат цену в течение 48 часов. Согласование — в личном кабинете.",
        }
      );
    }
  };

  const handleBack = () => {
    if (step > 0) updateCakeBuilder({ step: step - 1 });
  };

  const handleClose = () => {
    setCakeBuilderOpen(false);
    setTimeout(() => {
      resetCakeBuilder();
      setSubmitted(false);
    }, 300);
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
  // Региональная цена — учитывает конъюнктуру рынка по локации.
  // Москва дороже (×1.4), Казань дешевле (×0.9), регионы по таблице BASE_CITY_PRICING.
  // Если есть достаточно предложений кондитеров в городе (≥5) — будет использован
  // динамический множитель из реальных цен, иначе — базовый из таблицы.
  const regionalResult = calculateRegionalPriceSync(estimatedPrice, cakeBuilder.city || "");
  const regionalPrice = regionalResult.price;
  const deliveryCost = cakeBuilder.deliveryType === "delivery" ? calculateDelivery(regionalPrice).cost : 0;

  return (
    <Dialog open={cakeBuilderOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] w-[calc(100%-2rem)] sm:w-[calc(100%-4rem)] p-0 overflow-hidden gap-0 flex flex-col" showCloseButton={false}
      >
        <DialogTitle className="sr-only">
          {productTypeMeta ? `Конструктор: ${productTypeMeta.label}` : "Конструктор десертов"}
        </DialogTitle>
        {/* Фон конструктора */}
        <Image
          src="/builder-bg.png"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 56rem"
          quality={70}
          className="object-cover rounded-lg pointer-events-none"
        />
        {/* Полупрозрачный слой для читаемости */}
        <div className="absolute inset-0 bg-background/90 rounded-lg pointer-events-none" />
        {/* Header */}
        <div className="relative z-10 px-6 py-4 border-b bg-gradient-to-r from-primary/10 via-accent/20 to-primary/10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                <Cake className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h2 className="font-display font-bold text-lg flex items-center gap-2">
                  {productTypeMeta ? `Конструктор: ${productTypeMeta.label}` : "Конструктор десертов"}
                  <Badge variant="secondary" className="text-[10px]">
                    Шаг {step + 1} / 9
                  </Badge>
                </h2>
                <p className="text-xs text-muted-foreground">
                  {STEP_LABELS[step]}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="h-8 w-8 rounded-full hover:bg-accent flex items-center justify-center"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-4 flex gap-1">
            {STEP_LABELS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-border"
                }`}
              />
            ))}
          </div>
        </div>

        {submitted ? (
          /* Success screen */
          <div className="relative z-10 p-8 text-center space-y-6 max-h-[70vh] overflow-y-auto">
            <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <PartyPopper className="h-10 w-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold mb-2">
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

            {/* Выбранные кондитеры */}
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

            <div className="bg-card border border-border rounded-lg p-4 text-left max-w-md mx-auto space-y-2">
              <div className="font-semibold mb-2">Ваш запрос:</div>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-muted-foreground">Изделие:</span>{" "}
                  {productTypeMeta?.label || "Торт"}
                  {productTypeMeta?.unit === "порция" && cakeBuilder.servings
                    ? ` (${cakeBuilder.servings} порц.)`
                    : productTypeMeta?.unit === "шт" && cakeBuilder.quantity
                    ? ` (${cakeBuilder.quantity} шт)`
                    : ""}
                </div>
                <div>
                  <span className="text-muted-foreground">Мероприятие:</span>{" "}
                  {CAKE_BUILDER_OPTIONS.eventTypes.find((e) => e.id === cakeBuilder.eventType)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Основа:</span>{" "}
                  {CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === cakeBuilder.base)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Начинка:</span>{" "}
                  {CAKE_BUILDER_OPTIONS.fillings.find((f) => f.id === cakeBuilder.filling)?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Покрытие:</span>{" "}
                  {CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === cakeBuilder.coating)?.label}
                </div>
                {cakeBuilder.decorations.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">Декор:</span>{" "}
                    {cakeBuilder.decorations
                      .map((d) => CAKE_BUILDER_OPTIONS.decorations.find((o) => o.id === d)?.label)
                      .join(", ")}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Город:</span> {cakeBuilder.city}
                </div>
                <div>
                  <span className="text-muted-foreground">Дата:</span> {cakeBuilder.deliveryDate}
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between font-semibold">
                  <span>Оценка стоимости:</span>
                  <span className="text-primary">
                    ~{formatCurrency(regionalPrice + deliveryCost)}
                    {regionalResult.multiplier !== 1.0 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({regionalResult.multiplier > 1 ? "+" : ""}{Math.round((regionalResult.multiplier - 1) * 100)}% регион)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-center">
              <Button onClick={handleClose} variant="outline">
                Закрыть
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
          </div>
        ) : (
          <>
            {/* Body — step content */}
            <div className="relative z-10 flex-1 overflow-y-auto p-6 max-h-[60vh]">
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
                            // Сбросить релевантные поля при смене типа
                            base: undefined,
                            filling: undefined,
                            coating: undefined,
                            decorations: [],
                            dietary: [],
                            servings: opt.defaultServings,
                            quantity: opt.defaultQuantity,
                          });
                          // Автопереход к следующему шагу
                          setTimeout(() => updateCakeBuilder({ step: 1 }), 100);
                        }}
                      >
                        <div className="text-3xl mb-2">{opt.icon}</div>
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {opt.description}
                        </div>
                        <div className="text-xs text-muted-foreground/70 mt-1">
                          от {formatCurrency(opt.priceBase)} / {opt.unit}
                        </div>
                      </OptionCard>
                    ))}
                  </div>
                </StepContainer>
              )}

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
                      >
                        <div className="text-3xl mb-2">{opt.icon}</div>
                        <div className="font-medium text-sm">{opt.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {opt.description}
                        </div>
                      </OptionCard>
                    ))}
                  </div>
                </StepContainer>
              )}

              {step === 2 && (
                <StepContainer
                  title="Выберите основу"
                  subtitle="Это определит текстуру и вкус вашего торта"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {CAKE_BUILDER_OPTIONS.bases.map((opt) => (
                      <OptionCard
                        key={opt.id}
                        selected={cakeBuilder.base === opt.id}
                        onClick={() => updateCakeBuilder({ base: opt.id as CakeBuilderState["base"] })}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium">{opt.label}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
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
                </StepContainer>
              )}

              {step === 3 && (
                <StepContainer
                  title="Начинка"
                  subtitle="Выберите любимую начинку"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {CAKE_BUILDER_OPTIONS.fillings.map((opt) => (
                      <OptionCard
                        key={opt.id}
                        selected={cakeBuilder.filling === opt.id}
                        onClick={() => updateCakeBuilder({ filling: opt.id })}
                      >
                        <div className="flex items-center gap-3">
                          <FillingSlicePreview fillingName={opt.label} size={56} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium">{opt.label}</div>
                            {opt.price > 0 && (
                              <Badge variant="secondary" className="text-[10px] mt-0.5">
                                +{formatCurrency(opt.price)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </OptionCard>
                    ))}
                  </div>
                </StepContainer>
              )}

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
                        {!cakeBuilder.deliveryDate && (
                          <p className="text-xs text-muted-foreground">
                            Например: 2026-07-15
                          </p>
                        )}
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
                              <div className="text-xs text-muted-foreground">
                                Бесплатно
                              </div>
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

              {step === 8 && (
                <StepContainer
                  title="Выберите кондитеров"
                  subtitle={`Выберите одного или нескольких кондитеров в городе ${cakeBuilder.city || "—"} для отправки запроса. Каждый получит ваш проект торта и предложит свою цену.`}
                >
                  <div className="space-y-4 max-w-2xl">
                    {/* Сводка заказа (компактная) с превью среза */}
                    <div className="bg-card border border-border rounded-lg p-3 space-y-2 text-sm">
                      {cakeBuilder.filling && (
                        <div className="flex gap-3 items-center pb-2 border-b">
                          <FillingSlicePreview
                            fillingName={CAKE_BUILDER_OPTIONS.fillings.find((f) => f.id === cakeBuilder.filling)?.label || ""}
                            size={64}
                          />
                          <div>
                            <div className="text-xs text-muted-foreground">Срез выбранной начинки</div>
                            <div className="font-medium">
                              {CAKE_BUILDER_OPTIONS.fillings.find((f) => f.id === cakeBuilder.filling)?.label}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span><strong>Мероприятие:</strong> {CAKE_BUILDER_OPTIONS.eventTypes.find((e) => e.id === cakeBuilder.eventType)?.label}</span>
                        <span><strong>Основа:</strong> {CAKE_BUILDER_OPTIONS.bases.find((b) => b.id === cakeBuilder.base)?.label}</span>
                        <span><strong>Начинка:</strong> {CAKE_BUILDER_OPTIONS.fillings.find((f) => f.id === cakeBuilder.filling)?.label}</span>
                        <span><strong>Покрытие:</strong> {CAKE_BUILDER_OPTIONS.coatings.find((c) => c.id === cakeBuilder.coating)?.label}</span>
                        {cakeBuilder.servings && <span><strong>Порций:</strong> {cakeBuilder.servings}</span>}
                        <span><strong>Дата:</strong> {cakeBuilder.deliveryDate}</span>
                      </div>
                      {cakeBuilder.inscription && <span><strong>Надпись:</strong> {cakeBuilder.inscription}</span>}
                      {cakeBuilder.comment && <span><strong>Комментарий:</strong> {cakeBuilder.comment}</span>}
                      <div className="pt-2 border-t mt-2">
                        <span className="text-muted-foreground">Оценочная стоимость: </span>
                        <strong className="text-primary">~{formatCurrency(regionalPrice + deliveryCost)}</strong>
                      </div>
                    </div>

                    {/* Надпись и комментарий (если ещё не заполнены) */}
                    <div className="space-y-1.5">
                      <Label>Надпись на торте (опционально)</Label>
                      <Input
                        value={cakeBuilder.inscription || ""}
                        onChange={(e) => updateCakeBuilder({ inscription: e.target.value })}
                        placeholder="С днём рождения, Маша!"
                        maxLength={50}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Комментарий кондитеру (опционально)</Label>
                      <Textarea
                        value={cakeBuilder.comment || ""}
                        onChange={(e) => updateCakeBuilder({ comment: e.target.value })}
                        placeholder="Особые пожелания, цветовое решение, аллергии..."
                        rows={2}
                      />
                    </div>

                    {/* Запрос скидки */}
                    <div className="border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg p-3 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requestDiscount}
                          onChange={(e) => setRequestDiscount(e.target.checked)}
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
                              onChange={(e) => setDiscountPercent(parseInt(e.target.value))}
                              className="flex-1"
                            />
                            <Badge className="bg-amber-100 text-amber-700 min-w-[50px] justify-center">
                              {discountPercent}%
                            </Badge>
                          </div>
                          <Input
                            value={discountComment}
                            onChange={(e) => setDiscountComment(e.target.value)}
                            placeholder="Комментарий к запросу скидки (опционально)..."
                            className="text-sm"
                          />
                          <p className="text-xs text-muted-foreground">
                            Кондитеры увидят ваш запрос скидки и могут предложить скидку или отказаться.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Список кондитеров с мультивыбором */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="font-semibold">
                          Кондитеры в г. {cakeBuilder.city || "—"} ({availableConfectioners.length})
                        </Label>
                        <Badge variant="outline" className="text-xs">
                          Выбрано: {selectedConfectioners.length}
                        </Badge>
                      </div>
                      {availableConfectioners.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          В вашем городе пока нет кондитеров. Выберите другой город на шаге 7.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto">
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
                                  className="w-10 h-10 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
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
                                  {conf.specialization && conf.specialization.length > 0 && (
                                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                                      {conf.specialization.join(" · ")}
                                    </div>
                                  )}
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

                    {/* Price estimate */}
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Оценочная стоимость</span>
                        <Badge className="bg-primary/10 text-primary text-xs">Предварительно</Badge>
                      </div>
                      <div className="font-display text-xl font-bold text-primary mt-1">
                        ~{formatCurrency(regionalPrice + deliveryCost)}
                    {regionalResult.multiplier !== 1.0 && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({regionalResult.multiplier > 1 ? "+" : ""}{Math.round((regionalResult.multiplier - 1) * 100)}% регион)
                      </span>
                    )}
                        {requestDiscount && discountPercent > 0 && (
                          <span className="text-sm text-amber-600 ml-2">
                            (со скидкой {discountPercent}%: ~{formatCurrency(Math.round((regionalPrice + deliveryCost) * (1 - discountPercent / 100)))})
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Финальную цену предложат кондитеры. Согласование — в личном кабинете после ответа.
                      </p>
                    </div>
                  </div>
                </StepContainer>
              )}
            </div>

            {/* Footer */}
            <div className="relative z-10 border-t p-4 flex items-center justify-between shrink-0 bg-card/90 backdrop-blur">
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
        <h3 className="font-display text-xl font-bold">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-lg border-2 transition-all ${
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/40 hover:bg-accent/40"
      }`}
    >
      <div className="relative">
        {selected && (
          <div className="absolute top-0 right-0 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
            <Check className="h-3 w-3 text-primary-foreground" />
          </div>
        )}
        {children}
      </div>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm gap-2">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
