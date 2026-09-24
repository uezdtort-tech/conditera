/**
 * confectioner-slug-page.tsx — клиентская обёртка SEO-роута /confectioners/[slug].
 *
 * Server component загружает кондитера из БД по slug и передаёт готовые данные.
 * Обёртка гидратирует Zustand store (setConfectioners + navigate), после чего
 * рендерит обычный ConfectionerProfilePage — все интерактивные фичи профиля
 * (портфолио, контакты, SimpleX, follow) работают как в SPA-навигации.
 */
"use client";

import { useEffect } from "react";
import type { Confectioner } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { ConfectionerProfilePage } from "@/components/pages/confectioner-profile-page";

export function ConfectionerSlugPage({ confectioner }: { confectioner: Confectioner }) {
  const setConfectioners = useAppStore((s) => s.setConfectioners);
  const navigate = useAppStore((s) => s.navigate);

  useEffect(() => {
    // Пушим профиль в store — ConfectionerProfilePage ищет кондитера в store
    // по nav.params.id. Если профиль уже в store (SPA-переход) — не трогаем.
    const store = useAppStore.getState();
    const exists = store.confectioners.some((c) => c.id === confectioner.id);
    if (!exists) {
      setConfectioners([confectioner, ...store.confectioners]);
    }
    store.navigate("confectioner-profile", { id: confectioner.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confectioner.id]);

  return <ConfectionerProfilePage />;
}
