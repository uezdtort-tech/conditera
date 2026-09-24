"use client";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Skeleton карточки товара
export function ProductCardSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <Skeleton className="aspect-square w-full" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <div className="flex justify-between items-center pt-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </div>
    </Card>
  );
}

// Skeleton сетки карточек
export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

// Skeleton карточки кондитера
export function ConfectionerCardSkeleton() {
  return (
    <Card className="overflow-hidden p-0">
      <Skeleton className="h-24 w-full" />
      <div className="px-4 pb-4 -mt-10 space-y-2">
        <div className="flex items-end justify-between">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <div className="grid grid-cols-3 gap-2 pt-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      </div>
    </Card>
  );
}

// Skeleton для строки списка
export function ListItemSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 border border-border rounded">
      <Skeleton className="h-12 w-12 rounded" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2 w-3/4" />
      </div>
      <Skeleton className="h-6 w-16" />
    </div>
  );
}
