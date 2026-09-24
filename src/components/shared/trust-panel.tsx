"use client";

/**
 * TrustPanel — панель доверия (раздел 10, 62).
 *
 * Показывает badges доверия: verified, rating, eco, local, response time.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Star, Leaf, MapPin, Clock, Award } from "lucide-react";

export interface TrustData {
  verified?: boolean;
  rating?: number;
  reviewsCount?: number;
  isLocal?: boolean;
  distanceKm?: number;
  responseTime?: string;
  trustLevel?: string;
  ecoScore?: number;
  ordersCount?: number;
}

interface TrustPanelProps {
  data: TrustData;
  className?: string;
}

export function TrustPanel({ data, className }: TrustPanelProps): React.JSX.Element {
  const badges: Array<{ icon: typeof ShieldCheck; label: string; color?: string }> = [];

  if (data.verified) badges.push({ icon: ShieldCheck, label: "Проверен", color: "text-primary" });
  if (data.trustLevel === "MASTER") badges.push({ icon: Award, label: "Мастер", color: "text-amber-600" });
  if (data.trustLevel === "EXPERT") badges.push({ icon: Award, label: "Эксперт", color: "text-purple-600" });
  if (data.isLocal) badges.push({ icon: MapPin, label: "Локальный", color: "text-blue-600" });
  if (data.ecoScore !== undefined && data.ecoScore >= 70) badges.push({ icon: Leaf, label: "Eco", color: "text-green-600" });

  if (badges.length === 0 && data.rating === undefined) return <></>;

  return (
    <Card className={`p-3 ${className || ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {data.rating !== undefined && (
          <Badge variant="secondary" className="text-xs gap-1">
            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            {data.rating.toFixed(1)}
            {data.reviewsCount !== undefined && ` (${data.reviewsCount})`}
          </Badge>
        )}
        {badges.map((b, i) => {
          const Icon = b.icon;
          return (
            <Badge key={i} variant="outline" className={`text-xs gap-1 ${b.color || ""}`}>
              <Icon className="h-3 w-3" />
              {b.label}
            </Badge>
          );
        })}
        {data.responseTime && (
          <Badge variant="outline" className="text-xs gap-1">
            <Clock className="h-3 w-3" />
            {data.responseTime}
          </Badge>
        )}
        {data.ordersCount !== undefined && data.ordersCount > 0 && (
          <Badge variant="outline" className="text-xs">
            {data.ordersCount} заказов
          </Badge>
        )}
      </div>
    </Card>
  );
}
