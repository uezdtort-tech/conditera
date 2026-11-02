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
import { AuthModal } from "@/components/layout/auth-modal";
import { ChatWidget } from "@/components/chat/chat-widget";

export function ConfectionerSlugPage({ confectioner }: { confectioner: Confectioner }) {
  const setConfectioners = useAppStore((s) => s.setConfectioners);
  const navigate = useAppStore((s) => s.navigate);

  useEffect(() => {
    // Пушим профиль в store — ConfectionerProfilePage ищет кондитера в store
    // по nav.params.id. Апсертим SSR-данные (authoritative для этого slug):
    // store при холодной загрузке сидирован MOCK_CONFECTIONERS с теми же id,
    // но фейковым userId ("u0") — прежний guard "уже есть — не трогаем"
    // оставлял мок, и «Написать» падало: POST /api/chat/rooms → 400
    // «peerId должен быть UUID». Замена записи с тем же id безопасна —
    // данные из server component (revalidate 60) всегда актуальнее мока.
    const store = useAppStore.getState();
    setConfectioners([confectioner, ...store.confectioners.filter((c) => c.id !== confectioner.id)]);
    store.navigate("confectioner-profile", { id: confectioner.id });
  }, [confectioner.id]);

  // AuthModal + ChatWidget — те же инстансы, что в SPA-shell (src/app/page.tsx).
  // Первопричина: slug-роут рендерит профиль БЕЗ shell, где смонтированы эти
  // глобальные виджеты — «Написать» у гостя вызывал setAuthModalOpen(true),
  // но слушателей не было (мёртвый клик); у аутентифицированного тем же
  // страдал setChatOpen(true). Монтируем те же компоненты на этом дереве —
  // состояние по-прежнему одно (Zustand store), второй системы нет.
  return (
    <>
      <ConfectionerProfilePage />
      <AuthModal />
      <ChatWidget />
    </>
  );
}
