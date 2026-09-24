"use client";

/**
 * CompareDrawer — выдвижная панель сравнения товаров (раздел 17, 62).
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, GitCompare, Check, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/finance";

export interface CompareItem {
  id: string;
  title: string;
  price: number;
  rating?: number;
  servings?: number;
  dietary?: string[];
  imageUrl?: string;
  deliveryTime?: string;
}

interface CompareDrawerProps {
  items: CompareItem[];
  onRemove: (id: string) => void;
  onClose: () => void;
}

export function CompareDrawer({ items, onRemove, onClose }: CompareDrawerProps): React.JSX.Element {
  if (items.length === 0) return <></>;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">Сравнение ({items.length})</span>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {items.map((item) => (
                  <th key={item.id} className="p-2 min-w-120 text-left">
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="font-medium line-clamp-2">{item.title}</div>
                        <div className="text-primary font-bold mt-1">{formatCurrency(item.price)}</div>
                      </div>
                      <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => onRemove(item.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {items.map((item) => (
                  <td key={item.id} className="p-2">
                    {item.rating !== undefined ? `⭐ ${item.rating.toFixed(1)}` : "—"}
                  </td>
                ))}
              </tr>
              <tr>
                {items.map((item) => (
                  <td key={item.id} className="p-2">{item.servings ? `${item.servings} порц.` : "—"}</td>
                ))}
              </tr>
              <tr>
                {items.map((item) => (
                  <td key={item.id} className="p-2">
                    {item.dietary && item.dietary.length > 0
                      ? item.dietary.join(", ")
                      : <Minus className="h-3 w-3 text-muted-foreground" />}
                  </td>
                ))}
              </tr>
              <tr>
                {items.map((item) => (
                  <td key={item.id} className="p-2">{item.deliveryTime || "—"}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
