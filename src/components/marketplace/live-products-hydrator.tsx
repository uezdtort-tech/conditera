"use client";

/**
 * LiveProductsHydrator — гидрация витрины магазина live-данными из БД.
 *
 * Монтируется в оболочке приложения (app/page.tsx + route-fallback.tsx).
 * Тянет опубликованные товары через useLiveProducts() (публичный /api/products)
 * и замещает mock-товары в store. Если БД пуста/недоступна — витрина остаётся
 * на mock-данных (тот же dual-mode, что у бегущей строки кондитеров).
 *
 * Ничего не рендерит (returns null).
 */

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { useLiveProducts } from "@/lib/supabase/use-marketplace";

export function LiveProductsHydrator() {
  const { data } = useLiveProducts();
  const setLiveProducts = useAppStore((s) => s.setLiveProducts);

  useEffect(() => {
    // data — стабильная ссылка на результат react-query (staleTime 60с):
    // эффект сработает только на новый fetch, цикла нет
    if (data && data.length > 0) {
      setLiveProducts(data);
    }
  }, [data, setLiveProducts]);

  return null;
}
