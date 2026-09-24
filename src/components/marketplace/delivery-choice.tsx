"use client";

/**
 * DeliveryChoice — выбор способа доставки (раздел 62).
 *
 * Курьер / Самовывоз / ПВЗ с расчётом стоимости.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Truck, Store, MapPin, Clock, Check } from "lucide-react";
import { formatCurrency } from "@/lib/finance";

export interface DeliveryOption {
  type: "delivery" | "pickup" | "pickup_point";
  label: string;
  price: number;
  estimatedTime?: string;
  address?: string;
  distance?: number;
  isFree?: boolean;
}

interface DeliveryChoiceProps {
  options: DeliveryOption[];
  selected?: string;
  onSelect: (type: string) => void;
  address?: string;
  onAddressChange?: (address: string) => void;
}

const OPTION_ICONS: Record<string, typeof Truck> = {
  delivery: Truck,
  pickup: Store,
  pickup_point: MapPin,
};

export function DeliveryChoice({ options, selected, onSelect, address, onAddressChange }: DeliveryChoiceProps): React.JSX.Element {
  return (
    <Card className="p-4 space-y-3">
      <h4 className="font-medium text-sm">Способ получения</h4>

      <div className="space-y-2">
        {options.map((option) => {
          const Icon = OPTION_ICONS[option.type] || Truck;
          const isSelected = selected === option.type;

          return (
            <button
              key={option.type}
              onClick={() => onSelect(option.type)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left ${
                isSelected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "border-border hover:border-primary/30"
              }`}
            >
              <Icon className="h-5 w-5 shrink-0 text-primary" />

              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{option.label}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  {option.estimatedTime && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {option.estimatedTime}
                    </span>
                  )}
                  {option.address && <span>· {option.address}</span>}
                  {option.distance !== undefined && <span>· {option.distance} км</span>}
                </div>
              </div>

              <div className="text-right shrink-0">
                {option.isFree ? (
                  <Badge variant="secondary" className="text-success text-[10px]">Бесплатно</Badge>
                ) : (
                  <span className="font-medium text-sm">{formatCurrency(option.price)}</span>
                )}
              </div>

              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                isSelected ? "border-primary bg-primary" : "border-border"
              }`}>
                {isSelected && <Check className="h-3 w-3 text-white" />}
              </div>
            </button>
          );
        })}
      </div>

      {selected === "delivery" && onAddressChange && (
        <div className="pt-2 border-t">
          <Label className="text-xs">Адрес доставки</Label>
          <Input
            placeholder="г. Москва, ул. Тверская, д. 12, кв. 45"
            value={address || ""}
            onChange={(e) => onAddressChange(e.target.value)}
            className="mt-1 text-sm"
          />
        </div>
      )}
    </Card>
  );
}
