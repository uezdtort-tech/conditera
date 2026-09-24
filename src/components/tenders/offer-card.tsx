"use client";

/**
 * OfferCard — карточка предложения кондитера на тендер (раздел 62).
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, Check, Trophy, Clock } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/finance";

export interface OfferData {
  id: string;
  confectionerName: string;
  confectionerAvatar?: string;
  confectionerRating?: number;
  confectionerVerified?: boolean;
  offerPrice: number;
  offerDescription?: string;
  proposedDeliveryDate?: string;
  status: string;
  isWinner?: boolean;
}

interface OfferCardProps {
  offer: OfferData;
  onAccept?: () => void;
  onDecline?: () => void;
  showActions?: boolean;
}

export function OfferCard({ offer, onAccept, onDecline, showActions = true }: OfferCardProps): React.JSX.Element {
  return (
    <Card className={`p-4 ${offer.isWinner ? "border-success/40 bg-success/5" : ""}`}>
      <div className="flex items-start gap-3">
        <Avatar className="h-10 w-10">
          {offer.confectionerAvatar && <AvatarImage src={offer.confectionerAvatar} />}
          <AvatarFallback>{offer.confectionerName.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{offer.confectionerName}</span>
            {offer.confectionerVerified && <Check className="h-3 w-3 text-primary" />}
            {offer.isWinner && (
              <Badge className="text-[9px] bg-success"><Trophy className="h-3 w-3 mr-1" /> Победитель</Badge>
            )}
          </div>
          {offer.confectionerRating !== undefined && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              {offer.confectionerRating.toFixed(1)}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="font-bold text-primary">{formatCurrency(offer.offerPrice)}</div>
          {offer.proposedDeliveryDate && (
            <div className="text-xs text-muted-foreground flex items-center gap-1 justify-end mt-0.5">
              <Clock className="h-3 w-3" />
              {formatDate(offer.proposedDeliveryDate)}
            </div>
          )}
        </div>
      </div>

      {offer.offerDescription && (
        <p className="text-sm text-muted-foreground mt-2 line-clamp-3">{offer.offerDescription}</p>
      )}

      {showActions && offer.status === "pending" && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" className="flex-1" onClick={onAccept}>
            <Check className="h-4 w-4 mr-1" /> Принять
          </Button>
          <Button size="sm" variant="outline" onClick={onDecline}>Отклонить</Button>
        </div>
      )}
    </Card>
  );
}
