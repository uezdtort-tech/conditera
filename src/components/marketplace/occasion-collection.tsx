"use client";

/**
 * OccasionCollection — подборки по событиям (раздел 42, 62).
 *
 * "Торты на свадьбу", "Детские торты", "Корпоратив" и т.д.
 */

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export interface OccasionItem {
  id: string;
  title: string;
  emoji: string;
  description: string;
  itemCount?: number;
  priceFrom?: number;
  imageUrl?: string;
}

interface OccasionCollectionProps {
  occasions: OccasionItem[];
  onSelect?: (id: string) => void;
}

export function OccasionCollection({ occasions, onSelect }: OccasionCollectionProps): React.JSX.Element {
  if (occasions.length === 0) return <></>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-bold text-lg">Подборки по случаю</h3>
        <Button variant="ghost" size="sm" className="text-xs">Все подборки <ArrowRight className="h-3 w-3 ml-1" /></Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {occasions.map((occasion) => (
          <Card
            key={occasion.id}
            className="relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow group"
            onClick={() => onSelect?.(occasion.id)}
          >
            <div className="aspect-4/3 bg-gradient-to-br from-primary/10 via-accent/10 to-primary/5 flex items-center justify-center">
              {occasion.imageUrl ? (
                <img src={occasion.imageUrl} alt={occasion.title} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <span className="text-4xl">{occasion.emoji}</span>
              )}
            </div>

            <div className="p-3">
              <h4 className="font-medium text-sm">{occasion.title}</h4>
              <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{occasion.description}</p>

              <div className="flex items-center justify-between mt-2">
                {occasion.itemCount !== undefined && (
                  <Badge variant="secondary" className="text-[10px]">{occasion.itemCount} товаров</Badge>
                )}
                {occasion.priceFrom !== undefined && (
                  <span className="text-xs text-muted-foreground">от {occasion.priceFrom} ₽</span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
