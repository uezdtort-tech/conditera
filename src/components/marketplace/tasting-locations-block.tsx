"use client";

import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin, Clock, Phone, Utensils, Coffee, Store, Hotel,
  ShoppingBag, Building2, Check, Navigation, ExternalLink,
} from "lucide-react";

const TYPE_ICONS: Record<string, typeof Utensils> = {
  restaurant: Utensils,
  cafe: Coffee,
  bakery: ShoppingBag,
  coffee_shop: Coffee,
  hotel: Hotel,
  shop: Store,
  food_court: Utensils,
  canteen: Utensils,
};

const TYPE_LABELS: Record<string, string> = {
  restaurant: "Ресторан",
  cafe: "Кафе",
  bakery: "Пекарня",
  coffee_shop: "Кофейня",
  hotel: "Отель",
  shop: "Магазин",
  food_court: "Фуд-корт",
  canteen: "Столовая",
};

export function TastingLocationsBlock({ confectionerId, confectionerName }: {
  confectionerId: string;
  confectionerName?: string;
}) {
  const allLocations = useAppStore((s) => s.tastingLocations);
  const locations = allLocations.filter(
    (tl) => tl.confectionerId === confectionerId && tl.status === "active"
  );

  if (locations.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Utensils className="h-5 w-5 text-primary" />
        <h3 className="font-semibold text-lg">Где попробовать</h3>
        <Badge variant="secondary" className="ml-auto">{locations.length}</Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Продукцию {confectionerName || "кондитера"} можно попробовать в следующих заведениях:
      </p>

      <div className="space-y-3">
        {locations.map((loc) => {
          const Icon = TYPE_ICONS[loc.type] || Store;
          const typeLabel = loc.typeLabel || TYPE_LABELS[loc.type] || "Заведение";
          return (
            <div
              key={loc.id}
              className="flex gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:shadow-md transition group"
            >
              {/* Фото */}
              {loc.photo && (
                <div className="w-20 h-20 rounded-lg overflow-hidden shrink-0">
                  <img src={loc.photo} alt={loc.establishmentName} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                </div>
              )}

              {/* Контент */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <h4 className="font-medium text-sm">{loc.establishmentName}</h4>
                  <Badge variant="outline" className="text-[10px]">{typeLabel}</Badge>
                  {loc.verified && (
                    <Badge className="bg-emerald-500 text-white text-[10px]">
                      <Check className="h-2.5 w-2.5 mr-0.5" />Проверено
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{loc.description}</p>

                {/* Доступные товары */}
                {loc.availableProducts.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {loc.availableProducts.slice(0, 3).map((p) => (
                      <Badge key={p} variant="secondary" className="text-[9px]">{p}</Badge>
                    ))}
                    {loc.availableProducts.length > 3 && (
                      <Badge variant="outline" className="text-[9px]">+{loc.availableProducts.length - 3}</Badge>
                    )}
                  </div>
                )}

                {/* Детали */}
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {loc.city}, {loc.address}
                  </span>
                  {loc.workingHours && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {loc.workingHours}
                    </span>
                  )}
                  {loc.contactPhone && (
                    <span className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {loc.contactPhone}
                    </span>
                  )}
                  {loc.averageCheck && (
                    <span className="flex items-center gap-1">
                      💰 Средний чек: ~{loc.averageCheck} ₽
                    </span>
                  )}
                </div>
              </div>

              {/* Действия */}
              <div className="flex flex-col gap-1 shrink-0">
                {loc.lat && loc.lng && (
                  <a
                    href={`https://yandex.ru/maps/?pt=${loc.lng},${loc.lat}&z=16&l=map`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary hover:bg-primary/20 transition"
                    title="Открыть на карте"
                  >
                    <Navigation className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
