"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  X,
  Sparkles,
  MapPin,
  Tag,
  Truck,
  Gift,
  Calendar,
  Copy,
  Check,
  ChevronRight,
} from "lucide-react";
import { PROMOTION_TYPE_INFO } from "@/lib/mock-data-extra";
import { formatCurrency, formatDate } from "@/lib/finance";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { Promotion } from "@/lib/types";

export function PromoPopup() {
  const promotions = useAppStore((s) => s.promotions);
  const userCity = useAppStore((s) => s.userCity);
  const userLocation = useAppStore((s) => s.userLocation);
  const promoPopupShown = useAppStore((s) => s.promoPopupShown);
  const showPromoPopup = useAppStore((s) => s.showPromoPopup);
  const dismissPromoPopup = useAppStore((s) => s.dismissPromoPopup);
  const promoPopupDismissed = useAppStore((s) => s.promoPopupDismissed);
  const navigate = useAppStore((s) => s.navigate);
  const setCartOpen = useAppStore((s) => s.setCartOpen);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [adminEnabled, setAdminEnabled] = useState<boolean | null>(null);

  // Проверяем — включён ли промо-попап админом?
  useEffect(() => {
    fetch("/api/settings/promo-popup")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setAdminEnabled(data.enabled);
        else setAdminEnabled(false); // по умолчанию выключен
      })
      .catch(() => setAdminEnabled(false));
  }, []);

  // Поиск подходящей акции для региона пользователя
  const activePromo: Promotion | null = userCity
    ? promotions.find(
        (p) =>
          p.isPromoted &&
          p.status === "active" &&
          !promoPopupDismissed.includes(p.id) &&
          (p.cities?.some((c) => c === userCity) ||
            p.regions?.some(
              (r) =>
                userLocation?.region?.includes(r) ||
                r.includes(userCity || "") ||
                r === "Вся Россия"
            ))
      ) || null
    : null;

  // Автопоказ через 5 секунд — ТОЛЬКО если админ включил
  useEffect(() => {
    if (adminEnabled === null) return; // ещё не загрузилось
    if (!adminEnabled) return; // админ выключил
    if (promoPopupShown) return;
    if (!activePromo) return;
    const timer = setTimeout(() => {
      showPromoPopup();
    }, 5000);
    return () => clearTimeout(timer);
  }, [promoPopupShown, activePromo, showPromoPopup, adminEnabled]);

  const isOpen = promoPopupShown && !!activePromo;

  if (!activePromo) return null;

  const typeInfo = PROMOTION_TYPE_INFO[activePromo.type];

  const handleCopyCode = () => {
    if (!activePromo.promoCode) return;
    navigator.clipboard.writeText(activePromo.promoCode);
    setCopiedCode(activePromo.promoCode);
    toast.success("Промокод скопирован!", {
      description: activePromo.promoCode,
    });
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleClose = () => {
    dismissPromoPopup(activePromo.id);
  };

  const handleGoToPromotion = () => {
    navigate("confectioner-profile", { id: activePromo.confectionerId });
    dismissPromoPopup(activePromo.id);
  };

  const handleViewAll = () => {
    navigate("promotions");
    dismissPromoPopup(activePromo.id);
  };

  const daysLeft = Math.ceil(
    (new Date(activePromo.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
        <DialogTitle className="sr-only">
          Спецпредложение: {activePromo.title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Рекламная акция от кондитера {activePromo.confectionerName}
        </DialogDescription>

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 z-20 h-8 w-8 rounded-full bg-black/30 backdrop-blur text-white hover:bg-black/50 flex items-center justify-center"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Image */}
        <div className="relative aspect-[2/1] bg-muted overflow-hidden">
          {activePromo.image && (
            <img
              src={activePromo.image}
              alt={activePromo.title}
              className="w-full h-full object-cover" loading="lazy" decoding="async" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

          {/* Promoted badge */}
          <Badge className="absolute top-3 left-3 bg-amber-500 text-white">
            <Sparkles className="h-3 w-3 mr-1" />
            Реклама
          </Badge>

          {/* Title overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
            <Badge className={`mb-2 ${typeInfo.color}`}>
              {typeInfo.label}
            </Badge>
            <h2 className="font-display font-bold text-xl lg:text-2xl drop-shadow">
              {activePromo.title}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-sm opacity-90">
              <MapPin className="h-3.5 w-3.5" />
              {activePromo.confectionerName} • {activePromo.cities?.[0] || "Россия"}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Value */}
          {activePromo.value && (
            <div className="text-center bg-primary/5 rounded-lg p-4">
              <div className="text-xs text-muted-foreground mb-1">Ваша выгода</div>
              <div className="font-display font-bold text-4xl text-primary">
                {activePromo.type === "discount_percent" ||
                activePromo.type === "early_booking" ||
                activePromo.type === "holiday" ||
                activePromo.type === "happy_hours" ||
                activePromo.type === "first_order"
                  ? `-${activePromo.value}%`
                  : activePromo.type === "discount_fixed"
                  ? `-${formatCurrency(activePromo.value)}`
                  : `×${activePromo.value}`}
              </div>
              {activePromo.minOrderAmount && (
                <div className="text-xs text-muted-foreground mt-1">
                  при заказе от {formatCurrency(activePromo.minOrderAmount)}
                </div>
              )}
            </div>
          )}

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            {activePromo.description}
          </p>

          {/* Promo code */}
          {activePromo.promoCode && (
            <button
              onClick={handleCopyCode}
              className="w-full flex items-center justify-between p-3 border-2 border-dashed border-primary/40 rounded-lg bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <div className="text-xs text-muted-foreground">Промокод</div>
                  <div className="font-mono font-bold text-lg text-primary">
                    {activePromo.promoCode}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-primary">
                {copiedCode === activePromo.promoCode ? (
                  <>
                    <Check className="h-4 w-4" />
                    Скопировано
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Копировать
                  </>
                )}
              </div>
            </button>
          )}

          {/* Footer info */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Действует до {formatDate(activePromo.endDate)}
            </span>
            {daysLeft >= 0 && (
              <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                Осталось {daysLeft} дн.
              </Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <Button onClick={handleGoToPromotion} className="flex-1">
              Перейти к кондитеру
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button variant="outline" onClick={handleViewAll} className="flex-1">
              Все акции
            </Button>
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-muted-foreground text-center">
            Реклама • {activePromo.confectionerName} • Показано на основе вашего региона ({userCity})
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
