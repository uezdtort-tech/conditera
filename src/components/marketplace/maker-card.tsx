"use client";

/**
 * MakerCard — карточка кондитера (раздел 11, 62).
 *
 * Показывает: avatar, businessName, rating, reviews, specialization,
 * city, response time, trust badges, delivery info.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, MapPin, Clock, ShieldCheck, Cake, TrendingUp } from "lucide-react";
import { formatCurrency } from "@/lib/finance";

export interface MakerData {
  id: string;
  businessName: string;
  avatar?: string;
  city?: string;
  rating?: number;
  reviewsCount?: number;
  ordersCount?: number;
  specialization?: string[];
  verified?: boolean;
  trustLevel?: "NEW" | "VERIFIED" | "MASTER" | "EXPERT";
  responseTime?: string;
  minOrder?: number;
  deliveryCities?: string[];
}

interface MakerCardProps {
  maker: MakerData;
  onClick?: () => void;
  compact?: boolean;
}

const TRUST_LABELS: Record<string, string> = {
  NEW: "Новичок",
  VERIFIED: "Проверен",
  MASTER: "Мастер",
  EXPERT: "Эксперт",
};

export function MakerCard({ maker, onClick, compact }: MakerCardProps): React.JSX.Element {
  return (
    <Card
      className={`p-4 hover:shadow-md transition-shadow cursor-pointer ${compact ? "max-w-xs" : ""}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-14 w-14 shrink-0">
          {maker.avatar && <AvatarImage src={maker.avatar} alt={maker.businessName} />}
          <AvatarFallback>{maker.businessName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{maker.businessName}</h3>
            {maker.verified && (
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            )}
          </div>

          {maker.city && (
            <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="h-3 w-3" />
              {maker.city}
            </div>
          )}

          <div className="flex items-center gap-3 mt-1.5 text-xs">
            {maker.rating !== undefined && (
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {maker.rating.toFixed(1)}
                {maker.reviewsCount !== undefined && (
                  <span className="text-muted-foreground">({maker.reviewsCount})</span>
                )}
              </span>
            )}
            {maker.ordersCount !== undefined && (
              <span className="text-muted-foreground">{maker.ordersCount} заказов</span>
            )}
            {maker.responseTime && (
              <span className="text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {maker.responseTime}
              </span>
            )}
          </div>
        </div>
      </div>

      {maker.specialization && maker.specialization.length > 0 && !compact && (
        <div className="flex flex-wrap gap-1 mt-3">
          {maker.specialization.slice(0, 4).map((spec, i) => (
            <Badge key={i} variant="secondary" className="text-[10px]">
              {spec}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <div className="flex items-center gap-2">
          {maker.trustLevel && (
            <Badge variant="outline" className="text-[10px]">
              {TRUST_LABELS[maker.trustLevel] || maker.trustLevel}
            </Badge>
          )}
          {maker.minOrder !== undefined && maker.minOrder > 0 && (
            <span className="text-xs text-muted-foreground">
              от {formatCurrency(maker.minOrder)}
            </span>
          )}
        </div>
        <Cake className="h-4 w-4 text-muted-foreground" />
      </div>
    </Card>
  );
}
