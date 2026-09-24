"use client";

import { useAppStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, Check, MapPin, Truck, Navigation, Building2, User as UserIcon } from "lucide-react";
import {
  TRUST_LEVELS,
  TARIFFS,
  LEGAL_STATUS_INFO,
  calculateDistance,
} from "@/lib/finance";
import type { Confectioner } from "@/lib/types";

export function ConfectionerCard({ confectioner }: { confectioner: Confectioner }) {
  const navigate = useAppStore((s) => s.navigate);
  const userLocation = useAppStore((s) => s.userLocation);

  const trust = TRUST_LEVELS[confectioner.trustLevel] ?? TRUST_LEVELS.NEW;
  const legalInfo = LEGAL_STATUS_INFO[confectioner.legalInfo.status];

  // Расчёт расстояния от пользователя
  const distance =
    userLocation?.lat &&
    userLocation?.lng &&
    confectioner.location.lat &&
    confectioner.location.lng
      ? calculateDistance(
          userLocation.lat,
          userLocation.lng,
          confectioner.location.lat,
          confectioner.location.lng
        )
      : null;

  const inZone =
    distance !== null && confectioner.location.serviceRadiusKm
      ? distance <= confectioner.location.serviceRadiusKm
      : null;

  return (
    <Card
      onClick={() => navigate("confectioner-profile", { id: confectioner.id })}
      className="group cursor-pointer overflow-hidden hover:shadow-lg hover:border-primary/40 transition-all p-0"
    >
      {/* Cover */}
      <div className="relative h-24 bg-gradient-to-br from-primary/10 via-accent to-primary/5 overflow-hidden">
        {confectioner.cover && (
          <img
            src={confectioner.cover}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-500" decoding="async" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
        {/* Distance badge */}
        {distance !== null && (
          <Badge
            className={`absolute top-2 right-2 text-[10px] ${
              inZone
                ? "bg-emerald-500 text-white"
                : "bg-amber-500 text-white"
            }`}
          >
            <Navigation className="h-2.5 w-2.5 mr-0.5" />
            {distance < 1 ? "рядом" : `${distance} км`}
          </Badge>
        )}
      </div>

      <div className="px-4 pb-4 -mt-10 space-y-3">
        {/* Avatar */}
        <div className="flex items-end justify-between">
          <Avatar className="h-16 w-16 border-4 border-card shadow-sm">
            <AvatarImage src={confectioner.avatar} alt={confectioner.businessName} />
            <AvatarFallback className="bg-primary/10 text-primary">
              {confectioner.businessName.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          {confectioner.verified && (
            <Badge className="mb-1 bg-primary/10 text-primary border-primary/20">
              <Check className="h-3 w-3 mr-1" />
              Верифицирован
            </Badge>
          )}
        </div>

        {/* Name */}
        <div>
          <h3 className="font-display font-semibold text-base group-hover:text-primary transition-colors line-clamp-1">
            {confectioner.businessName}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <MapPin className="h-3 w-3" />
            {confectioner.city}
            {confectioner.location.district && (
              <span className="text-[10px]">• {confectioner.location.district}</span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground line-clamp-2">
          {confectioner.description}
        </p>

        {/* Specializations */}
        <div className="flex flex-wrap gap-1">
          {confectioner.specialization.slice(0, 3).map((spec) => (
            <Badge key={spec} variant="secondary" className="text-[10px] font-normal">
              {spec}
            </Badge>
          ))}
        </div>

        {/* Legal status + delivery zone */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${legalInfo.color}`}>
            {legalInfo.icon} {legalInfo.shortLabel}
          </Badge>
          {confectioner.location.serviceRadiusKm && (
            <Badge variant="outline" className="text-[10px]">
              <Truck className="h-2.5 w-2.5 mr-0.5" />
              {confectioner.location.serviceRadiusKm} км
            </Badge>
          )}
          {confectioner.selfPickup && (
            <Badge variant="outline" className="text-[10px]">
              Самовывоз
            </Badge>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t">
          <div className="text-center">
            <div className="flex items-center justify-center gap-0.5 text-sm font-semibold">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {confectioner.rating.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {confectioner.reviewsCount} отзывов
            </div>
          </div>
          <div className="text-center border-x">
            <div className="text-sm font-semibold">{confectioner.ordersCount}</div>
            <div className="text-[10px] text-muted-foreground">заказов</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold">{confectioner.followersCount}</div>
            <div className="text-[10px] text-muted-foreground">подписчиков</div>
          </div>
        </div>

        {/* Trust level */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Badge variant="outline" className={`text-[10px] ${trust.color}`}>
            {trust.label}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {TARIFFS[confectioner.tariff].name}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
