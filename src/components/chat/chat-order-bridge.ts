"use client";

/**
 * chat-order-bridge.ts — мост «кнопка в карточке заказа → ChatWidget».
 *
 * ChatWidget смонтирован глобально (dashboard/page.tsx) и принимает проп
 * initialOrderId (реализация order-комнат — p1-b). Чтобы карточка заказа
 * в кабинете клиента могла передать orderId в этот глобальный инстанс,
 * используется window-событие (store.ts намеренно не расширяется):
 *
 *   openChatForOrder("...") — dispatch из карточки заказа;
 *   useChatOrderBridge()    — подписка в dashboard/page.tsx → initialOrderId.
 */

import { useEffect, useState } from "react";

export const CHAT_ORDER_EVENT = "cd:chat-open-order";

export function openChatForOrder(orderId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<string>(CHAT_ORDER_EVENT, { detail: orderId })
  );
}

/** Подписка страницы на запросы «открыть чат по заказу N». */
export function useChatOrderBridge(): string | null {
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail) setOrderId(detail);
    }
    window.addEventListener(CHAT_ORDER_EVENT, onEvent);
    return () => window.removeEventListener(CHAT_ORDER_EVENT, onEvent);
  }, []);

  return orderId;
}
