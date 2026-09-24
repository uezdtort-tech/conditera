"use client";

/**
 * LiveServicesHydrator — гидрация витрины услуг live-данными из БД.
 *
 * Монтируется в оболочке приложения (app/page.tsx + route-fallback.tsx).
 * Тянет активные объявления через useLiveServices() (публичный /api/services)
 * и замещает mock-услуги в store. Если БД пуста/недоступна — витрина остаётся
 * на mock-данных (тот же dual-mode, что у LiveProductsHydrator).
 *
 * Ничего не рендерит (returns null).
 */

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { useLiveServices } from "@/lib/supabase/use-marketplace";

export function LiveServicesHydrator() {
  const { data } = useLiveServices();
  const setLiveServiceProducts = useAppStore((s) => s.setLiveServiceProducts);

  useEffect(() => {
    // data — стабильная ссылка на результат react-query (staleTime 60с):
    // эффект сработает только на новый fetch, цикла нет
    if (data && data.length > 0) {
      setLiveServiceProducts(data);
    }
  }, [data, setLiveServiceProducts]);

  return null;
}
