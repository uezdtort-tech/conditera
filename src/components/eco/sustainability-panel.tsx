"use client";

/**
 * SustainabilityPanel — панель устойчивости (раздел 22-25, 62).
 *
 * НЕ просто "🌱 Eco 92", а конкретная информация:
 *   - расстояние до кондитера
 *   - самовывоз (без доставки)
 *   - сезонные ягоды
 *   - многоразовая упаковка
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Leaf, Truck, Package, MapPin } from "lucide-react";

export interface EcoData {
  distanceKm?: number;
  hasPickup?: boolean;
  seasonalIngredients?: boolean;
  reusablePackaging?: boolean;
  localSourcing?: boolean;
  ecoScore?: number; // 0-100
}

interface SustainabilityPanelProps {
  data: EcoData;
  className?: string;
}

export function SustainabilityPanel({ data, className }: SustainabilityPanelProps): React.JSX.Element {
  const attributes: Array<{ icon: typeof Leaf; label: string; value?: string }> = [];

  if (data.distanceKm !== undefined) {
    attributes.push({
      icon: MapPin,
      label: "Расстояние до кондитера",
      value: data.distanceKm < 10 ? `${data.distanceKm} км — локальный` : `${data.distanceKm} км`,
    });
  }

  if (data.hasPickup) {
    attributes.push({
      icon: Truck,
      label: "Самовывоз доступен",
      value: "без доставки",
    });
  }

  if (data.seasonalIngredients) {
    attributes.push({
      icon: Leaf,
      label: "Сезонные ингредиенты",
      value: "свежие ягоды по сезону",
    });
  }

  if (data.reusablePackaging) {
    attributes.push({
      icon: Package,
      label: "Многоразовая упаковка",
      value: "возвратная тара",
    });
  }

  if (attributes.length === 0) return <></>;

  return (
    <Card className={`p-4 border-eco/30 bg-eco-light/30 ${className || ""}`}>
      <div className="flex items-center gap-2 mb-3">
        <Leaf className="h-4 w-4 text-eco" />
        <h4 className="font-medium text-sm text-eco">Устойчивый выбор</h4>
        {data.ecoScore !== undefined && data.ecoScore >= 70 && (
          <Badge className="bg-eco/10 text-eco text-[10px]">
            Рекомендуем
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {attributes.map((attr, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <attr.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium">{attr.label}</span>
            {attr.value && (
              <span className="text-muted-foreground">· {attr.value}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
