"use client";

/**
 * CartSyncHydrator — единая точка старта клиентской синхронизации серверной
 * корзины (src/lib/cart-sync.ts). Монтируется среди глобальных overlays
 * (src/app/page.tsx): один экземпляр на приложение, идемпотентен.
 */

import { useEffect } from "react";
import { startCartSync } from "@/lib/cart-sync";

export function CartSyncHydrator() {
  useEffect(() => {
    startCartSync();
  }, []);
  return null;
}
